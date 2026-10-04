import { logger } from "@/lib/logger";

export type GeoPoint = { lat: number; lng: number; label: string };
export type AddressSuggestion = GeoPoint & { id: string; detail: string };
export type RouteRequest = {
  pickupAddress: string;
  dropoffAddress: string;
  additionalStops?: { address: string }[];
  optimizeStops?: boolean;
};
export type DrivingRoute = {
  distanceKm: number;
  durationSeconds: number;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  stops: GeoPoint[];
  geometry: { lat: number; lng: number }[];
  /** Input waypoint indexes in the order the route will visit them. */
  waypointOrder: number[];
  optimized: boolean;
  optimizationAttempted: boolean;
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
const OSRM = "https://router.project-osrm.org";
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

type OsrmRoute = {
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: [number, number][] };
};

type OsrmResponse = {
  code?: string;
  routes?: OsrmRoute[];
  trips?: OsrmRoute[];
  waypoints?: { waypoint_index?: number }[];
};

type RoutePlan = { route: OsrmRoute; waypointOrder: number[]; geometry: { lat: number; lng: number }[] };

async function requestOsrmPlan(
  service: "route" | "trip",
  points: GeoPoint[],
): Promise<RoutePlan | null> {
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(";");
  const url = new URL(`${OSRM}/${service}/v1/driving/${coordinates}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");
  if (service === "route") {
    url.searchParams.set("alternatives", "false");
  } else {
    // Keep the pickup and final delivery fixed; OSRM reorders only the middle stops.
    url.searchParams.set("roundtrip", "false");
    url.searchParams.set("source", "first");
    url.searchParams.set("destination", "last");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Loadline/2.0 (road route estimate)", Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as OsrmResponse;
    const route = service === "trip" ? payload.trips?.[0] : payload.routes?.[0];
    if (payload.code !== "Ok" || !route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
      return null;
    }

    let waypointOrder = points.map((_, index) => index);
    if (service === "trip") {
      const ordered = new Array<number>(points.length);
      for (let inputIndex = 0; inputIndex < (payload.waypoints?.length ?? 0); inputIndex++) {
        const routeIndex = payload.waypoints?.[inputIndex]?.waypoint_index;
        if (!Number.isInteger(routeIndex) || routeIndex! < 0 || routeIndex! >= points.length || ordered[routeIndex!] !== undefined) {
          return null;
        }
        ordered[routeIndex!] = inputIndex;
      }
      if (ordered.filter((index) => Number.isInteger(index)).length !== points.length || ordered[0] !== 0 || ordered.at(-1) !== points.length - 1) {
        return null;
      }
      waypointOrder = ordered;
    }

    const geometry = (route.geometry?.coordinates ?? []).flatMap(([lng, lat]) =>
      Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [],
    );
    if (geometry.length < 2) return null;
    return { route, waypointOrder, geometry };
  } catch (error) {
    logger.debug("route.osrm.request.failed", { service, stops: points.length, error });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildDrivingRoute(
  plan: RoutePlan,
  inputPoints: GeoPoint[],
  optimized: boolean,
  optimizationAttempted: boolean,
): DrivingRoute {
  const orderedPoints = plan.waypointOrder.map((index) => inputPoints[index]);
  return {
    distanceKm: Math.max(0.1, Math.round(((plan.route.distance ?? 0) / 1000) * 10) / 10),
    durationSeconds: Math.max(0, Math.round(plan.route.duration ?? 0)),
    pickup: orderedPoints[0],
    dropoff: orderedPoints[orderedPoints.length - 1],
    stops: orderedPoints.slice(1, -1),
    geometry: plan.geometry,
    waypointOrder: plan.waypointOrder,
    optimized,
    optimizationAttempted,
  };
}

/**
 * Geocode the full journey, optionally apply OSRM's small-route trip heuristic,
 * then calculate the driving route. Optimization always keeps pickup and final
 * delivery fixed; if the trip service is unavailable, the entered order is used.
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
  const optimizationAttempted = Boolean(input.optimizeStops && (input.additionalStops?.length ?? 0) >= 2);

  if (optimizationAttempted) {
    const optimizedPlan = await requestOsrmPlan("trip", points);
    if (optimizedPlan) return buildDrivingRoute(optimizedPlan, points, true, true);
    logger.debug("route.osrm.optimization.unavailable", { stopCount: input.additionalStops?.length ?? 0 });
  }

  const fixedOrderPlan = await requestOsrmPlan("route", points);
  if (!fixedOrderPlan) {
    logger.warn("route.osrm.failed", { stops: points.length });
    return null;
  }
  return buildDrivingRoute(fixedOrderPlan, points, false, optimizationAttempted);
}
