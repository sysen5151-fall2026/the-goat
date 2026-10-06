import type { NycPlace } from "@/lib/nyc-types";

type Point = Pick<NycPlace, "latitude" | "longitude">;

/** Straight-line (haversine) distance in km. */
export function distanceKm(a: Point, b: Point) {
  const radiusKm = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const start = (a.latitude * Math.PI) / 180;
  const end = (b.latitude * Math.PI) / 180;
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(start) * Math.cos(end) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function resolvePlanDurationHours(request: { durationHours?: number; duration: "half_day" | "full_day" }) {
  return request.durationHours ?? (request.duration === "full_day" ? 10 : 6);
}
