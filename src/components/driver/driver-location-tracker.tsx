"use client";

import { useEffect, useRef, useState } from "react";
import type { BookingStatus } from "@/db/schema";
import { Alert, Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/client-api";

const TRACKABLE_STATUSES: BookingStatus[] = ["en_route_pickup", "picked_up", "in_transit"];
const SEND_INTERVAL_MS = 10_000;

type LocationResponse = { accepted: boolean; location: { timestamp: string } };

export function DriverLocationTracker({ bookingId, status }: { bookingId: number; status: BookingStatus }) {
  const [sharing, setSharing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const sending = useRef(false);
  const lastSentAt = useRef(0);
  const canShare = TRACKABLE_STATUSES.includes(status);

  useEffect(() => {
    if (!canShare && watchId.current != null) {
      navigator.geolocation?.clearWatch(watchId.current);
      watchId.current = null;
      setSharing(false);
    }
  }, [canShare]);

  useEffect(() => () => {
    if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current);
  }, []);

  function stopSharing() {
    if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    setSharing(false);
    setError(null);
  }

  function startSharing() {
    setError(null);
    if (!canShare) return;
    if (!navigator.geolocation) {
      setError("This browser does not support location sharing.");
      return;
    }
    if (watchId.current != null) return;

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (sending.current || now - lastSentAt.current < SEND_INTERVAL_MS) return;
        sending.current = true;
        lastSentAt.current = now;
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        const body = {
          bookingId,
          latitude,
          longitude,
          timestamp: new Date(position.timestamp).toISOString(),
          accuracyMeters: accuracy,
          ...(heading != null && heading >= 0 ? { headingDegrees: heading } : {}),
          ...(speed != null && speed >= 0 ? { speedMetersPerSecond: speed } : {}),
        };

        void api<LocationResponse>("/api/driver/location", { method: "POST", body })
          .then((result) => {
            if (result.accepted) {
              setLastUpdate(result.location.timestamp);
              setError(null);
            }
          })
          .catch((requestError: unknown) => {
            setError(errorMessage(requestError, "Unable to send the GPS update."));
          })
          .finally(() => {
            sending.current = false;
          });
      },
      (geolocationError) => {
        if (geolocationError.code === geolocationError.PERMISSION_DENIED) {
          setError("Location permission is blocked. Allow location access in your browser settings, then try again.");
        } else if (geolocationError.code === geolocationError.POSITION_UNAVAILABLE) {
          setError("Your current location is unavailable. Check device location services and try again.");
        } else {
          setError("Location request timed out. Keep sharing on and move to an area with a clearer GPS signal.");
        }
        if (watchId.current != null) navigator.geolocation?.clearWatch(watchId.current);
        watchId.current = null;
        setSharing(false);
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    setSharing(true);
  }

  return (
    <div className="space-y-3 border-t border-slate-100 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Live location</p>
          <p className="mt-1 text-xs text-slate-500">
            {!canShare
              ? status === "assigned"
                ? "Start the trip to pickup before sharing GPS. You can stop sharing at any time."
                : "GPS sharing is available only while the trip is active; delivery has been reported."
              : sharing
                ? lastUpdate
                  ? `Sharing on this device · last sent ${new Date(lastUpdate).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                  : "Waiting for the first GPS fix…"
                : "Share your GPS so dispatch and the customer can follow this vehicle."}
          </p>
        </div>
        {sharing ? (
          <Button variant="secondary" size="sm" onClick={stopSharing}>Stop sharing</Button>
        ) : (
          <Button variant="dark" size="sm" disabled={!canShare} onClick={startSharing}>Share live location</Button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
