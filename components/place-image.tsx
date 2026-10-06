"use client";

import { useEffect, useState } from "react";
import { Building2, Landmark, Leaf, MapPin, Palette, Utensils, Waves } from "lucide-react";
import type { NycPlace } from "@/lib/nyc-types";

/**
 * Place photo with a fallback chain, so no stop renders an empty box:
 *   1. place.imageUrl (curated photo or an OSM `image` tag)
 *   2. lead image of place.wikipediaTitle (Wikipedia pageimages API, CORS-enabled)
 *   3. a local category illustration (no network)
 * Wikipedia lookups are cached per title for the page session.
 */

type Resolved = { src: string; creditUrl: string } | null;
const wikiCache = new Map<string, Promise<Resolved>>();

function wikiImage(title: string, width: number): Promise<Resolved> {
  const key = `${title}|${width}`;
  const hit = wikiCache.get(key);
  if (hit) return hit;
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=${width}&titles=${encodeURIComponent(title)}`;
  const promise = fetch(url)
    .then((response) => (response.ok ? response.json() as Promise<{ query?: { pages?: Record<string, { title?: string; thumbnail?: { source?: string } }> } }> : null))
    .then((payload) => {
      const page = Object.values(payload?.query?.pages ?? {})[0];
      const thumb = page?.thumbnail?.source;
      // Skip logos/diagrams some articles use as their lead image; the category art reads better.
      const src = thumb && !/(\.svg|logo)/i.test(thumb) ? thumb : undefined;
      return src ? { src, creditUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent((page.title ?? title).replace(/ /g, "_"))}` } : null;
    })
    .catch(() => null);
  wikiCache.set(key, promise);
  return promise;
}

const categoryArt: Record<string, { icon: typeof MapPin; from: string; to: string }> = {
  landmark: { icon: Landmark, from: "#185e56", to: "#8fc1a9" },
  museum: { icon: Palette, from: "#0d2940", to: "#5e7c8a" },
  architecture: { icon: Building2, from: "#5e7c8a", to: "#c9d7cc" },
  park: { icon: Leaf, from: "#3f7d4f", to: "#b9d8b0" },
  waterfront: { icon: Waves, from: "#1f5f7a", to: "#9fd0dc" },
  food: { icon: Utensils, from: "#c66230", to: "#e2be8c" },
};

export function CategoryArt({ category, className = "" }: { category?: string; className?: string }) {
  const art = categoryArt[category ?? ""] ?? { icon: MapPin, from: "#185e56", to: "#e3f0ea" };
  const Icon = art.icon;
  return <span aria-hidden="true" className={`relative grid size-full place-items-center overflow-hidden ${className}`} style={{ background: `linear-gradient(135deg, ${art.from}, ${art.to})` }}>
    <span className="absolute -right-6 -top-6 size-24 rounded-full bg-white/10" />
    <span className="absolute -bottom-8 -left-4 size-20 rounded-full bg-white/10" />
    <Icon className="relative size-[38%] max-h-14 max-w-14 text-white/90" strokeWidth={1.6} />
  </span>;
}

/**
 * Full-size Wikimedia Commons originals are often several MB. Serve them through
 * Special:FilePath?width=…, which redirects to a cached thumbnail of that width.
 */
export function sizedImageUrl(url: string, width: number) {
  const match = url.match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)$/);
  return match ? `https://commons.wikimedia.org/wiki/Special:FilePath/${match[1]}?width=${width}` : url;
}

export function usePlaceImage(place: Pick<NycPlace, "imageUrl" | "imageCreditUrl" | "wikipediaTitle"> | undefined, width = 640) {
  const direct = place?.imageUrl ? { src: sizedImageUrl(place.imageUrl, width), creditUrl: place.imageCreditUrl || place.imageUrl } : null;
  const [directFailed, setDirectFailed] = useState(false);
  const [wiki, setWiki] = useState<{ title: string; value: Resolved } | null>(null);
  const [wikiFailed, setWikiFailed] = useState(false);
  const title = place?.wikipediaTitle;
  const needWiki = Boolean(title) && (!direct || directFailed);

  useEffect(() => {
    if (!needWiki || !title || wiki?.title === title) return;
    let live = true;
    void wikiImage(title, width).then((value) => { if (live) setWiki({ title, value }); });
    return () => { live = false; };
  }, [needWiki, title, width, wiki?.title]);

  const resolved = direct && !directFailed ? direct : needWiki && wiki?.title === title && !wikiFailed ? wiki?.value ?? null : null;
  const pending = needWiki && wiki?.title !== title;
  const onError = () => { if (direct && !directFailed) setDirectFailed(true); else setWikiFailed(true); };
  return { image: resolved, pending, onError };
}

export function PlaceImage({ place, alt = "", width = 640, className = "", imgClassName = "" }: { place: NycPlace; alt?: string; width?: number; className?: string; imgClassName?: string }) {
  return <PlaceImageView state={usePlaceImage(place, width)} category={place.interests[0]} alt={alt} className={className} imgClassName={imgClassName} />;
}

export function PlaceImageView({ state, category, alt = "", className = "", imgClassName = "" }: { state: ReturnType<typeof usePlaceImage>; category?: string; alt?: string; className?: string; imgClassName?: string }) {
  const { image, pending, onError } = state;
  return <span className={`block overflow-hidden bg-sage ${className}`}>
    {image
      ? <img key={image.src} src={image.src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={onError} className={`absolute inset-0 size-full object-cover text-transparent ${imgClassName}`} />
      : pending ? <span className="absolute inset-0 animate-pulse bg-sage" /> : <span className="absolute inset-0"><CategoryArt category={category} /></span>}
  </span>;
}
