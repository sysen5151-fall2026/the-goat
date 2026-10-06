/**
 * Basemap configuration for MapLibre GL.
 *
 * Provider is chosen by NEXT_PUBLIC_MAP_PROVIDER ("geoapify" | "maptiler" | "openfreemap").
 * If the chosen provider has no key, we fall back to OpenFreeMap, which needs no key,
 * so the map keeps working when a quota runs out or a key is missing.
 *
 * Keys live in .env.local (git-ignored). Restrict both keys to your domains in the
 * provider dashboards, because browser keys are visible to anyone using the app.
 */
export type MapProvider = "geoapify" | "maptiler" | "openfreemap";

const geoapifyKey = process.env.NEXT_PUBLIC_GEOAPIFY_KEY ?? "";
const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";
const requested = (process.env.NEXT_PUBLIC_MAP_PROVIDER ?? "geoapify") as MapProvider;

function resolveProvider(): MapProvider {
  if (requested === "geoapify" && geoapifyKey) return "geoapify";
  if (requested === "maptiler" && maptilerKey) return "maptiler";
  if (requested === "openfreemap") return "openfreemap";
  if (geoapifyKey) return "geoapify";
  if (maptilerKey) return "maptiler";
  return "openfreemap";
}

export const mapProvider = resolveProvider();

export const mapStyleUrl: Record<MapProvider, string> = {
  // Light, low-contrast styles that sit well under the Wayly paper palette.
  geoapify: `https://maps.geoapify.com/v1/styles/positron/style.json?apiKey=${geoapifyKey}`,
  maptiler: `https://api.maptiler.com/maps/dataviz/style.json?key=${maptilerKey}`,
  openfreemap: "https://tiles.openfreemap.org/styles/positron",
};

export const mapAttribution: Record<MapProvider, string> = {
  geoapify: 'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a>',
  maptiler: "",
  openfreemap: '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>',
};

export const fallbackStyleUrl = mapStyleUrl.openfreemap;

/** Figma "Wayly NYC / Mobile app v2" map colors, applied on top of the provider style. */
export const mapPalette = {
  background: "#f5f0e6",
  water: "#cfe3ea",
  park: "#d9e8d2",
  route: "#0d2940",
  routeCasing: "#ffffff",
};
