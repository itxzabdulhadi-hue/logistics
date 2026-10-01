import { errors, handle, json, parseJson } from "@/lib/api";
import { calculateQuote } from "@/lib/booking-rules";
import { estimateDrivingRoute } from "@/lib/geocode";
import { quoteSchema } from "@/lib/validation";
import { getPricingRules } from "@/services/pricing";
import { getVehicleType } from "@/services/fleet";

export const dynamic = "force-dynamic";

/** Recalculate an itemized quote from a routed journey and current server-side rates. */
export const POST = handle(async (req) => {
  const input = await parseJson(req, quoteSchema);
  const vehicleType = await getVehicleType(input.vehicleTypeId);
  if (!vehicleType || !vehicleType.active) {
    throw errors.validation({ vehicleTypeId: "This vehicle type is not available" });
  }

  const route = await estimateDrivingRoute(input);
  if (!route) {
    throw errors.validation(
      { route: "We couldn't map a driving route for every address. Choose a suggested address or check the spelling, then try again." },
      "Route unavailable",
    );
  }
  const pricingRules = await getPricingRules();
  const quote = calculateQuote({
    vehicleType,
    distanceKm: route.distanceKm,
    additionalStops: input.additionalStops.length,
    requiresTailgate: input.requiresTailgate,
    requiresHandUnload: input.requiresHandUnload,
    isAsap: input.isAsap,
    pricingRules,
  });

  return json({ quote, route, vehicleType: { id: vehicleType.id, name: vehicleType.name }, pricingRules });
});
