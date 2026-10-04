import { errors, handle, json, parseJson } from "@/lib/api";
import { estimateDrivingRoute } from "@/lib/geocode";
import { routeEstimateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const POST = handle(async (req) => {
  const input = await parseJson(req, routeEstimateSchema);
  const route = await estimateDrivingRoute(input);
  if (!route) {
    throw errors.validation(
      {
        route: "We couldn't map a driving route for every address. Choose a suggested address or check the spelling, then try again.",
      },
      "Route unavailable",
    );
  }
  return json({ route });
});
