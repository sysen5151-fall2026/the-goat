import { NYC_POI_DATA_VERSION, placeById, publishedPlaces } from "@/lib/nyc-places";
import type { PlanRequest } from "@/lib/nyc-types";

/** Chapter 10 alternative: a separate localhost service supplies candidate IDs only. */
export async function queryLocalIndexIds(request: PlanRequest): Promise<ReadonlySet<string>> {
  const response = await fetch("http://127.0.0.1:3333/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cityCode: request.cityCode, interests: request.interests, intentText: request.intentText, dining: request.dining }),
    signal: AbortSignal.timeout(2000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Local index query failed.");
  const result = await response.json() as { dataVersionId?: string; catalogCount?: number; ids?: unknown };
  if (result.dataVersionId !== NYC_POI_DATA_VERSION || result.catalogCount !== publishedPlaces.length ||
      !Array.isArray(result.ids) || result.ids.some((id) => typeof id !== "string" || !placeById[id]))
    throw new Error("Local index catalog does not match the current published catalog.");
  return new Set(result.ids as string[]);
}
