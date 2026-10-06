"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { RouteMap as RouteMapComponent } from "@/components/route-map";

const RouteMap = dynamic(() => import("@/components/route-map").then((module) => module.RouteMap), {
  ssr: false,
  loading: () => <div className="flex h-full min-h-[300px] w-full items-center justify-center bg-sage text-sm text-muted-ink">Loading map…</div>,
});

export function RouteMapClient(props: ComponentProps<typeof RouteMapComponent>) {
  return <RouteMap {...props} />;
}
