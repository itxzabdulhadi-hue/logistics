import { handle, json, parseQuery } from "@/lib/api";
import { addressAutocompleteQuerySchema } from "@/lib/validation";
import { suggestAddresses } from "@/lib/geocode";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const { q } = parseQuery(req, addressAutocompleteQuerySchema);
  const suggestions = await suggestAddresses(q);
  return json({ suggestions });
});
