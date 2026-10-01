import { errors, handle, json, parseJson } from "@/lib/api";
import { calculateQuote } from "@/lib/booking-rules";
import { estimateDistance } from "@/lib/geocode";
import { quoteSchema } from "@/lib/validation";
import { getVehicleType } from "@/services/fleet";

export const dynamic = "force-dynamic";

/**
 * Price estimate. Distance is geocoded from the addresses when not supplied;
 * if geocoding is unavailable the client is asked to provide a manual distance.
 */
export const POST = handle(async (req) => {
  const input = await parseJson(req, quoteSchema);
  const vehicleType = await getVehicleType(input.vehicleTypeId);
  if (!vehicleType || !vehicleType.active) {
    throw errors.validation({ vehicleTypeId: "This vehicle type is not available" });
  }

  let distanceKm = input.distanceKm;
  let distanceSource: "manual" | "geocoded" = "manual";
  let pickup: { lat: number; lng: number; label: string } | null = null;
  let dropoff: { lat: number; lng: number; label: string } | null = null;

  if (!distanceKm) {
    const estimate = await estimateDistance(input.pickupAddress, input.dropoffAddress);
    if (!estimate) {
      return json({
        quote: null,
        distanceSource: null,
        needsManualDistance: true,
        message:
          "We couldn't locate one of the addresses automatically. Enter the approximate trip distance to get a price.",
      });
    }
    distanceKm = estimate.distanceKm;
    distanceSource = "geocoded";
    pickup = estimate.pickup;
    dropoff = estimate.dropoff;
  }

  const quote = calculateQuote({
    vehicleType,
    distanceKm,
    requiresTailgate: input.requiresTailgate,
    requiresHandUnload: input.requiresHandUnload,
    isAsap: input.isAsap,
  });

  return json({
    quote,
    distanceSource,
    needsManualDistance: false,
    vehicleType: { id: vehicleType.id, name: vehicleType.name },
    pickup,
    dropoff,
  });
});
