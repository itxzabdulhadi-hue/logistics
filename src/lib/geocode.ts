import { logger } from "@/lib/logger";

export type GeoPoint = { lat: number; lng: number; label: string };

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const ROAD_FACTOR = 1.25; // straight-line → road distance heuristic

/** Best-effort geocoding via OpenStreetMap Nominatim. Returns null on any failure. */
export async function geocodeAddress(query: string): Promise<GeoPoint | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=au&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Loadline-Demo/1.0 (truck booking MVP)", Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    return { lat: Number(data[0].lat), lng: Number(data[0].lon), label: data[0].display_name };
  } catch (error) {
    logger.debug("geocode.failed", { query, error });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type DistanceEstimate = {
  distanceKm: number;
  pickup: GeoPoint;
  dropoff: GeoPoint;
};

/** Geocode both ends and estimate the road distance. Null if either address fails. */
export async function estimateDistance(
  pickupAddress: string,
  dropoffAddress: string,
): Promise<DistanceEstimate | null> {
  const [pickup, dropoff] = await Promise.all([
    geocodeAddress(pickupAddress),
    geocodeAddress(dropoffAddress),
  ]);
  if (!pickup || !dropoff) return null;
  const straight = haversineKm(pickup, dropoff);
  const distanceKm = Math.max(1, Math.round(straight * ROAD_FACTOR * 10) / 10);
  return { distanceKm, pickup, dropoff };
}
