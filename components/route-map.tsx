"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { ErrorEvent as MapErrorEvent, LngLatLike, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { fallbackStyleUrl, mapAttribution, mapPalette, mapProvider, mapStyleUrl } from "@/lib/map-config";
import type { NycPlace } from "@/lib/nyc-types";

type RouteMapProps = {
  places: NycPlace[];
  /** Road-following route as [lng, lat] pairs (from Geoapify). Falls back to straight lines. */
  route?: [number, number][];
  className?: string;
  activeIndex?: number;
  /** Extra space (px) kept clear at the bottom, e.g. for an overlapping bottom sheet. */
  bottomInset?: number;
  /** Extra space (px) kept clear at the top, e.g. for floating header buttons. */
  topInset?: number;
};

const ROUTE_SOURCE = "wayly-route";

// Worker files are copied to /public/maplibre by scripts/copy-maplibre-worker.mjs (pre-dev / pre-build).
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

/** Nudge the provider style toward the Wayly palette (paper land, soft water, sage parks). */
function applyWaylyPalette(map: MapLibreMap) {
  const style = map.getStyle() as StyleSpecification | undefined;
  for (const layer of style?.layers ?? []) {
    const id = layer.id.toLowerCase();
    try {
      if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", mapPalette.background);
      else if (layer.type === "fill" && /water|ocean|river|lake/.test(id)) map.setPaintProperty(layer.id, "fill-color", mapPalette.water);
      else if (layer.type === "fill" && /park|grass|wood|forest|green|garden|pitch|cemetery/.test(id)) map.setPaintProperty(layer.id, "fill-color", mapPalette.park);
    } catch {
      // Some provider layers use expressions we should not override; skip them.
    }
  }
}

function pinElement(index: number, active: boolean) {
  // MapLibre writes its own transform on the marker element, so the rotated pin lives in a child.
  const element = document.createElement("div");
  element.className = "wayly-marker";
  element.innerHTML = `<div class="wayly-pin${active ? " is-active" : ""}"><span>${index + 1}</span></div>`;
  return element;
}

export function RouteMap({ places, route, className, activeIndex, bottomInset = 40, topInset = 40 }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let usedFallback = false;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyleUrl[mapProvider],
      center: [-73.9855, 40.758],
      zoom: 11.5,
      attributionControl: false,
      cooperativeGestures: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: mapAttribution[mapProvider] || undefined }), "bottom-left");

    // If the provider style fails (bad key, quota exceeded), switch to the keyless basemap once.
    map.on("error", (event: MapErrorEvent) => {
      const status = (event.error as { status?: number } | undefined)?.status;
      if (!usedFallback && !map.isStyleLoaded() && (status === 401 || status === 403 || status === 429)) {
        usedFallback = true;
        map.setStyle(fallbackStyleUrl);
      }
    });

    const lineCoordinates: [number, number][] = route && route.length > 1 ? route : places.map((place) => [place.longitude, place.latitude]);

    const drawRoute = () => {
      applyWaylyPalette(map);
      if (map.getSource(ROUTE_SOURCE) || lineCoordinates.length < 2) return;
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: lineCoordinates } } });
      map.addLayer({ id: "wayly-route-casing", type: "line", source: ROUTE_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": mapPalette.routeCasing, "line-width": 8, "line-opacity": 0.95 } });
      map.addLayer({ id: "wayly-route-line", type: "line", source: ROUTE_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": mapPalette.route, "line-width": 4 } });
    };
    // style.load fires again after a fallback setStyle, so the route is redrawn.
    map.on("style.load", drawRoute);

    places.forEach((place, index) => {
      new maplibregl.Marker({ element: pinElement(index, index === activeIndex), anchor: "bottom", offset: [0, -6] })
        .setLngLat([place.longitude, place.latitude])
        .setPopup(new maplibregl.Popup({ offset: 28, closeButton: false }).setHTML(`<strong>${index + 1}. ${escapeHtml(place.name)}</strong><br/><span>${escapeHtml(place.neighborhood)}</span>`))
        .addTo(map);
    });

    const boundsPoints: LngLatLike[] = [...lineCoordinates, ...places.map((place) => [place.longitude, place.latitude] as [number, number])];
    if (boundsPoints.length > 1) {
      const bounds = boundsPoints.reduce((box, point) => box.extend(point), new maplibregl.LngLatBounds(boundsPoints[0], boundsPoints[0]));
      map.fitBounds(bounds, { padding: { top: topInset + 40, bottom: bottomInset + 20, left: 40, right: 40 }, maxZoom: 15, duration: 0 });
    } else if (places[0]) {
      map.jumpTo({ center: [places[0].longitude, places[0].latitude], zoom: 14 });
    }

    return () => {
      map.remove();
    };
  }, [places, route, activeIndex, bottomInset, topInset]);

  return <div ref={containerRef} className={className ?? "h-[300px] overflow-hidden rounded-2xl bg-sage"} aria-label="NYC itinerary map" />;
}
