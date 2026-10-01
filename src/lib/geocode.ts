import { logger } from "@/lib/logger";

export type GeoPoint = { lat: number; lng: number; label: string };
export type AddressSuggestion = GeoPoint & { id: string; detail: string };
export type RouteRequest = {
  pickupAddress: string;
  dropoffAddress: string;
  additionalStops?: { address: string }[];
};
export type DrivingRoute = {
  distanceKm: number;
  durationSeconds: number;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  stops: GeoPoint[];
  geometry: { lat: number; lng: number }[];
};

type PhotonProperties = {
  osm_type?: string;
  osm_id?: number;
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  suburb?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
};
type PhotonResponse = {
  features?: Array<{
    geometry?: { coordinates?: [number, number] };
    properties?: PhotonProperties;
  }>;
};

const PHOTON = "https://photon.komoot.io/api/";
const AUSTRALIA_BBOX = "113,-44,154,-10";
const OSRM = "https://router.project-osrm.org/route/v1/driving";
const ADDRESS_TIMEOUT_MS = 5_000;
const ROUTE_TIMEOUT_MS = 12_000;

function uniqueParts(parts: Array<string | undefined>) {
  const seen = new Set<string>();
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .filter((part) => {
      const normalized = part.toLocaleLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function formatPhotonAddress(properties: PhotonProperties) {
  const street = [properties.housenumber, properties.street].filter(Boolean).join(" ");
  const locality = properties.suburb ?? properties.city ?? properties.district ?? properties.county;
  return uniqueParts([
    street || properties.name,
    locality,
    properties.state,
    properties.postcode,
    properties.country,
  ]).join(", ");
}

async function photonSearch(query: string, limit: number): Promise<AddressSuggestion[]> {
  const normalized = query.trim();
  if (normalized.length < 3) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ADDRESS_TIMEOUT_MS);
  try {
    const url = new URL(PHOTON);
    url.searchParams.set("q", normalized);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("lang", "en");
    url.searchParams.set("bbox", AUSTRALIA_BBOX);
    const response = await fetch(url, {
      headers: { "User-Agent": "Loadline/2.0 (address lookup)", Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as PhotonResponse;
    return (payload.features ?? []).flatMap((feature, index) => {
      const coordinates = feature.geometry?.coordinates;
      const properties = feature.properties ?? {};
      if (!coordinates || coordinates.length < 2) return [];
      const [lng, lat] = coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      if (properties.countrycode && properties.countrycode.toLowerCase() !== "au") return [];

      const label = formatPhotonAddress(properties);
      if (!label) return [];
      const detail = uniqueParts([
        properties.suburb ?? properties.city ?? properties.district ?? properties.county,
        properties.state,
        properties.postcode,
      ]).join(" · ");
      return [{
        id: `${properties.osm_type ?? "place"}-${properties.osm_id ?? index}-${index}`,
        label,
        detail,
        lat,
        lng,
      }];
    });
  } catch (error) {
    logger.debug("geocode.photon.failed", { queryLength: normalized.length, error });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Australia-scoped Photon autocomplete results, proxied through our API. */
export async function suggestAddresses(query: string) {
  return photonSearch(query, 5);
}

/** Geocode an address through Photon; null means it could not be resolved. */
export async function geocodeAddress(query: string): Promise<GeoPoint | null> {
  const [first] = await photonSearch(query, 1);
  if (!first) return null;
  return { lat: first.lat, lng: first.lng, label: first.label };
}

/**
 * Resolve every stop, then ask OSRM for a real driving route through the full
 * sequence. The public routing endpoint is best-effort; quote creation fails
 * closed rather than silently pricing a straight-line approximation.
 */
export async function estimateDrivingRoute(input: RouteRequest): Promise<DrivingRoute | null> {
  const addresses = [
    input.pickupAddress,
    ...(input.additionalStops ?? []).map((stop) => stop.address),
    input.dropoffAddress,
  ];
  const resolved = await Promise.all(addresses.map((address) => geocodeAddress(address)));
  if (resolved.some((point) => point === null)) return null;
  const points = resolved as GeoPoint[];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
  try {
    const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(";");
    const url = `${OSRM}/${coordinates}?overview=full&geometries=geojson&steps=false&alternatives=false`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Loadline/2.0 (road route estimate)", Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      code?: string;
      routes?: Array<{
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: [number, number][] };
      }>;
    };
    const route = payload.routes?.[0];
    if (payload.code !== "Ok" || !route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
      return null;
    }

    const geometry = (route.geometry?.coordinates ?? []).flatMap(([lng, lat]) =>
      Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [],
    );
    if (geometry.length < 2) return null;

    return {
      distanceKm: Math.max(0.1, Math.round(((route.distance ?? 0) / 1000) * 10) / 10),
      durationSeconds: Math.max(0, Math.round(route.duration ?? 0)),
      pickup: points[0],
      dropoff: points[points.length - 1],
      stops: points.slice(1, -1),
      geometry,
    };
  } catch (error) {
    logger.warn("route.osrm.failed", { stops: points.length, error });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
