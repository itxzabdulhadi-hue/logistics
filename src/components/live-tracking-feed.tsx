"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RouteMap } from "@/components/route-map";
import { Card, StatusBadge } from "@/components/ui";
import { STATUS_META } from "@/lib/booking-rules";
import { api } from "@/lib/client-api";
import type { Coordinate, TrackingSnapshot, TrackingSocketMessage } from "@/lib/tracking-types";

type ConnectionState = "connecting" | "live" | "syncing";

type Props = {
  snapshots: TrackingSnapshot[];
  title: string;
  description?: string;
  emptyMessage?: string;
};

function distanceKm(a: Coordinate, b: Coordinate) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function routeProgressAt(snapshot: TrackingSnapshot, point: Coordinate) {
  if (snapshot.route.length < 2) return 0;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < snapshot.route.length; index++) {
    const distance = distanceKm(point, snapshot.route[index]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  const total = snapshot.route.slice(1).reduce((sum, current, index) => sum + distanceKm(snapshot.route[index], current), 0);
  if (total <= 0) return 0;
  const travelled = snapshot.route.slice(1, nearestIndex + 1).reduce(
    (sum, current, index) => sum + distanceKm(snapshot.route[index], current),
    0,
  );
  return Math.max(0, Math.min(1, travelled / total));
}

function routeProgress(snapshot: TrackingSnapshot) {
  if (!snapshot.location) return 0;
  return routeProgressAt(snapshot, { lat: snapshot.location.latitude, lng: snapshot.location.longitude });
}

function progressPercent(snapshot: TrackingSnapshot) {
  switch (snapshot.status) {
    case "assigned":
      return 0;
    case "en_route_pickup":
      return 10;
    case "picked_up":
      return 25;
    case "in_transit":
      return 25 + Math.round(routeProgress(snapshot) * 70);
    case "delivered":
    case "completed":
      return 100;
    default:
      return 0;
  }
}

function etaText(snapshot: TrackingSnapshot, now: number | null) {
  if (snapshot.status === "delivered" || snapshot.status === "completed") return "Delivered";
  if (snapshot.status === "assigned") return "Waiting for trip start";
  if (snapshot.status === "en_route_pickup") {
    if (snapshot.estimatedDurationMinutes == null) return "After pickup";
    return `~${snapshot.estimatedDurationMinutes} min after pickup`;
  }
  if (snapshot.status !== "picked_up" && snapshot.status !== "in_transit") return "—";
  if (snapshot.estimatedDurationMinutes == null) return "Estimate unavailable";

  const fractionRemaining = snapshot.status === "in_transit" ? 1 - routeProgress(snapshot) : 1;
  const minutes = Math.max(1, Math.round(snapshot.estimatedDurationMinutes * fractionRemaining));
  if (now == null) return `~${minutes} min`;
  const eta = new Date(now + minutes * 60_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `~${minutes} min · ${eta}`;
}

type DeliveryStopStatus = "pending" | "arrived" | "completed" | "failed" | "cancelled";
type DeliveryStopView = {
  id: string;
  label: string;
  address: string;
  point: Coordinate | null;
  status: DeliveryStopStatus;
  completedAt?: string | null;
};

const STOP_STATUS_LABEL: Record<DeliveryStopStatus, string> = {
  pending: "Upcoming",
  arrived: "At stop",
  completed: "Completed",
  failed: "Not completed",
  cancelled: "Cancelled",
};

function deliveryStops(snapshot: TrackingSnapshot): DeliveryStopView[] {
  const terminalStopStatus: DeliveryStopStatus =
    snapshot.status === "failed" ? "failed" : snapshot.status === "cancelled" ? "cancelled" : "pending";
  return [
    ...snapshot.stops.map((stop, index) => ({
      id: `stop-${index}`,
      label: `Delivery stop ${index + 1}`,
      address: stop.address,
      point: { lat: stop.lat, lng: stop.lng },
      status: stop.status === "pending" && terminalStopStatus !== "pending" ? terminalStopStatus : stop.status,
      completedAt: stop.completedAt,
    })),
    {
      id: "dropoff",
      label: "Final delivery",
      address: snapshot.dropoffAddress,
      point: snapshot.dropoff,
      status: snapshot.status === "delivered" || snapshot.status === "completed"
        ? "completed"
        : terminalStopStatus,
    },
  ];
}

function stopEtaText(snapshot: TrackingSnapshot, stop: DeliveryStopView, now: number | null) {
  if (stop.status === "completed") {
    return stop.completedAt
      ? `Completed ${new Date(stop.completedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "Completed";
  }
  if (stop.status === "arrived") return "Driver at stop";
  if (stop.status === "failed" || stop.status === "cancelled") return "No ETA";
  if (snapshot.status === "assigned" || snapshot.status === "en_route_pickup") return "After pickup";
  if (!stop.point || snapshot.estimatedDurationMinutes == null || snapshot.route.length < 2) return "Estimate unavailable";

  const currentProgress = snapshot.location ? routeProgress(snapshot) : 0;
  const stopProgress = routeProgressAt(snapshot, stop.point);
  const remaining = Math.max(0, stopProgress - currentProgress);
  const minutes = Math.max(0, Math.round(snapshot.estimatedDurationMinutes * remaining));
  if (minutes === 0) return "Due now · update stop";
  if (now == null) return `~${minutes} min`;
  const eta = new Date(now + minutes * 60_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `~${minutes} min · ${eta}`;
}

function stopStatusClass(status: DeliveryStopStatus) {
  if (status === "completed") return "bg-emerald-100 text-emerald-800";
  if (status === "arrived") return "bg-blue-100 text-blue-800";
  if (status === "failed" || status === "cancelled") return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-700";
}

function mergeSnapshot(existing: TrackingSnapshot | undefined, incoming: TrackingSnapshot): TrackingSnapshot {
  if (!existing) return incoming;
  const keepExistingStatus = Date.parse(existing.updatedAt) > Date.parse(incoming.updatedAt);
  const keepExistingLocation =
    existing.location != null &&
    (incoming.location == null || Date.parse(existing.location.timestamp) > Date.parse(incoming.location.timestamp));
  return {
    ...incoming,
    ...(keepExistingStatus ? { status: existing.status, updatedAt: existing.updatedAt } : {}),
    location: keepExistingLocation ? existing.location : incoming.location,
  };
}

function mergeSnapshotList(current: TrackingSnapshot[], incoming: TrackingSnapshot[]) {
  const currentById = new Map(current.map((snapshot) => [snapshot.bookingId, snapshot]));
  return incoming.map((snapshot) => mergeSnapshot(currentById.get(snapshot.bookingId), snapshot));
}

function connectionLabel(state: ConnectionState) {
  if (state === "live") return "Live updates";
  if (state === "connecting") return "Connecting";
  return "Syncing · reconnecting";
}

export function LiveTrackingFeed({ snapshots: initialSnapshots, title, description, emptyMessage }: Props) {
  const [liveSnapshots, setLiveSnapshots] = useState(initialSnapshots);
  const snapshots = useMemo(() => mergeSnapshotList(liveSnapshots, initialSnapshots), [liveSnapshots, initialSnapshots]);
  const [connection, setConnectionState] = useState<ConnectionState>(initialSnapshots.length ? "connecting" : "syncing");
  const [now, setNow] = useState<number | null>(null);
  const connectionRef = useRef<ConnectionState>(initialSnapshots.length ? "connecting" : "syncing");
  const lastSyncAt = useRef(0);
  const bookingIdsKey = initialSnapshots.map((snapshot) => snapshot.bookingId).join(",");
  const bookingIds = useMemo(() => bookingIdsKey ? bookingIdsKey.split(",").map(Number) : [], [bookingIdsKey]);

  const setConnection = useCallback((next: ConnectionState) => {
    connectionRef.current = next;
    setConnectionState(next);
  }, []);

  useEffect(() => {
    const initialTimer = setTimeout(() => setNow(Date.now()), 0);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    if (!bookingIdsKey) return;

    let stopped = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let retryDelay = 1_000;

    async function syncSnapshots() {
      try {
        const result = await api<{ snapshots: TrackingSnapshot[] }>(
          `/api/tracking?bookingIds=${encodeURIComponent(bookingIdsKey)}`,
        );
        if (stopped) return;
        lastSyncAt.current = Date.now();
        setLiveSnapshots((current) => mergeSnapshotList(current, result.snapshots));
      } catch {
        if (!stopped) setConnection("syncing");
      }
    }

    function connect() {
      if (stopped) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const nextSocket = new WebSocket(`${protocol}//${window.location.host}/api/tracking/socket`);
      socket = nextSocket;

      nextSocket.addEventListener("open", () => {
        retryDelay = 1_000;
        setConnection("connecting");
        nextSocket.send(JSON.stringify({ type: "subscribe", bookingIds }));
        heartbeatTimer = setInterval(() => {
          if (nextSocket.readyState === WebSocket.OPEN) nextSocket.send(JSON.stringify({ type: "ping" }));
        }, 25_000);
        void syncSnapshots();
      });

      nextSocket.addEventListener("message", (messageEvent) => {
        let message: TrackingSocketMessage;
        try {
          message = JSON.parse(String(messageEvent.data)) as TrackingSocketMessage;
        } catch {
          return;
        }
        if (message.type === "ready" || message.type === "subscribed") {
          setConnection("live");
          return;
        }
        if (message.type === "error") {
          setConnection("syncing");
          return;
        }
        if (message.type === "tracking.location") {
          setLiveSnapshots((current) => current.map((snapshot) => {
            if (snapshot.bookingId !== message.bookingId) return snapshot;
            if (snapshot.location && Date.parse(snapshot.location.timestamp) >= Date.parse(message.location.timestamp)) return snapshot;
            return { ...snapshot, location: message.location };
          }));
          return;
        }
        if (message.type === "tracking.booking") {
          setLiveSnapshots((current) => current.map((snapshot) =>
            snapshot.bookingId === message.bookingId && Date.parse(message.updatedAt) >= Date.parse(snapshot.updatedAt)
              ? { ...snapshot, status: message.status, updatedAt: message.updatedAt }
              : snapshot,
          ));
          void syncSnapshots();
        }
      });

      nextSocket.addEventListener("error", () => setConnection("syncing"));
      nextSocket.addEventListener("close", () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
        if (stopped) return;
        setConnection("syncing");
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      });
    }

    connect();
    pollTimer = setInterval(() => {
      const interval = connectionRef.current === "live" ? 60_000 : 12_000;
      if (Date.now() - lastSyncAt.current >= interval) void syncSnapshots();
    }, 12_000);

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      socket?.close();
    };
  }, [bookingIds, bookingIdsKey, setConnection]);

  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${connection === "live" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
          {connectionLabel(connection)}
        </span>
      </div>

      {snapshots.length === 0 ? (
        <Card><p className="p-5 text-sm text-slate-500">{emptyMessage ?? "No active vehicles to track right now."}</p></Card>
      ) : (
        <div className={snapshots.length > 1 ? "grid gap-4 xl:grid-cols-2" : "space-y-4"}>
          {snapshots.map((snapshot) => {
            const percent = progressPercent(snapshot);
            const waypointPoints = [snapshot.pickup, ...snapshot.stops, snapshot.dropoff].filter(
              (point): point is Coordinate => point != null,
            );
            const destinations = deliveryStops(snapshot);
            const stale = snapshot.location != null && now != null && now - Date.parse(snapshot.location.receivedAt) > 90_000;
            return (
              <Card key={snapshot.bookingId} className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div>
                    <p className="font-semibold text-slate-900">{snapshot.reference}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {snapshot.driverName ?? "Driver assigned"}{snapshot.vehicleRegistration ? ` · ${snapshot.vehicleRegistration}` : ""}
                    </p>
                    {snapshot.routeOptimized && (
                      <span className="mt-2 inline-flex rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-semibold text-violet-800">
                        Optimized stop order
                      </span>
                    )}
                  </div>
                  <StatusBadge status={snapshot.status} />
                </div>

                <div className="p-4 sm:p-5">
                  {snapshot.route.length > 0 ? (
                    <RouteMap
                      geometry={snapshot.route}
                      waypoints={waypointPoints}
                      currentLocation={snapshot.location ? { lat: snapshot.location.latitude, lng: snapshot.location.longitude } : null}
                    />
                  ) : (
                    <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">Route coordinates are not available for this booking.</div>
                  )}

                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">Delivery stop ETAs</h3>
                      <p className="text-[11px] text-slate-500">Route-time estimates; not live traffic predictions</p>
                    </div>
                    <ol className="mt-3 divide-y divide-slate-100">
                      {destinations.map((stop, index) => (
                        <li key={stop.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                              {index + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-900">{stop.label}</p>
                              <p className="mt-0.5 truncate text-xs text-slate-500">{stop.address}</p>
                            </div>
                          </div>
                          <div className="ml-9 flex min-w-[150px] items-center justify-between gap-3 sm:ml-0 sm:justify-end">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${stopStatusClass(stop.status)}`}>
                              {STOP_STATUS_LABEL[stop.status]}
                            </span>
                            <span className="text-right text-xs font-semibold text-slate-700">
                              {stopEtaText(snapshot, stop, now)}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Delivery progress</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{STATUS_META[snapshot.status].description}</p>
                      <div
                        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"
                        role="progressbar"
                        aria-label={`Delivery progress for ${snapshot.reference}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                      >
                        <div className="h-full rounded-full bg-orange-500 transition-[width] duration-500" style={{ width: `${percent}%` }} />
                      </div>
                      <p className="mt-1 text-right text-[11px] font-medium text-slate-500">{percent}%</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Estimated delivery</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{etaText(snapshot, now)}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {snapshot.location
                          ? `${stale ? "Last GPS update" : "GPS updated"} ${new Date(snapshot.location.receivedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                          : "Waiting for the driver to share GPS"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:justify-between">
                    <span className="truncate"><b className="text-emerald-700">Pickup:</b> {snapshot.pickupAddress}</span>
                    <span className="truncate"><b className="text-orange-700">Delivery:</b> {snapshot.dropoffAddress}</span>
                  </div>
                  {stale && <p className="mt-2 text-xs font-medium text-amber-700">The last GPS fix is over 90 seconds old. The driver may have paused sharing or lost signal.</p>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
