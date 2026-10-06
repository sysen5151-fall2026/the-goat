import rawPlaces from "@/data/nyc-poi-v1.json";
import type { ExpectedSpendSemantics, NycPlace } from "@/lib/nyc-types";

export const NYC_POI_DATA_VERSION = "nyc-poi-v1" as const;

function normalize(record: NycPlace): NycPlace {
  const expectedSpendSemantics: ExpectedSpendSemantics =
    record.expectedSpendSemantics ?? (record.planningAllowanceUsd === 0 ? "free" : "per_person_reference");
  return { ...record, expectedSpendSemantics, dataOrigin: record.dataOrigin ?? "curated" };
}

export const places = (rawPlaces as NycPlace[]).map(normalize);
export const nycPlaces = places;
export const publishedPlaces = places.filter((place) => place.published);
export const placeById = Object.fromEntries(
  publishedPlaces.map((place) => [place.id, place]),
) as Record<string, NycPlace>;

/** Primary category = first catalog interest (used for durations and labels). */
export function primaryCategory(place: NycPlace) {
  return place.interests[0] ?? "landmark";
}
