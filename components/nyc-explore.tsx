"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bookmark, ChevronLeft, Clock3, ExternalLink, Heart, Info, MapPin, Search, ShieldCheck, UserRound, WalletCards } from "lucide-react";
import { PlaceImage, PlaceImageView, usePlaceImage } from "@/components/place-image";
import { publishedPlaces } from "@/lib/nyc-places";
import type { NycPlace, PlaceCategory } from "@/lib/nyc-types";

const categories: Array<{ value: PlaceCategory | "all"; label: string }> = [
  { value: "all", label: "All" }, { value: "landmark", label: "Landmarks" },
  { value: "museum", label: "Museums" }, { value: "park", label: "Parks" },
  { value: "waterfront", label: "Waterfront" }, { value: "food", label: "Food" },
  { value: "views", label: "Views" }, { value: "architecture", label: "Architecture" },
  { value: "history", label: "History" }, { value: "art", label: "Art" },
  { value: "science", label: "Science" }, { value: "performance", label: "Shows & music" },
  { value: "family", label: "Family" },
];

type ExploreProps = {
  favoriteIds: string[];
  favoritesOnly: boolean;
  selectedPlaceId: string | null;
  avatar: string | null;
  onSelectPlace: (id: string | null) => void;
  onToggleFavorite: (id: string) => void;
  onOpenFavorites: () => void;
  onShowAll: () => void;
  onProfile: () => void;
  onPlanAround: (place: NycPlace) => void;
};

export function NycExplore({ favoriteIds, favoritesOnly, selectedPlaceId, avatar, onSelectPlace, onToggleFavorite, onOpenFavorites, onShowAll, onProfile, onPlanAround }: ExploreProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PlaceCategory | "all">("all");
  const selected = publishedPlaces.find((place) => place.id === selectedPlaceId);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return publishedPlaces.filter((place) => {
      if (favoritesOnly && !favoriteIds.includes(place.id)) return false;
      if (category !== "all" && !place.interests.includes(category)) return false;
      return !term || [place.name, place.neighborhood, ...place.interests, ...(place.aliases ?? []), ...(place.keywordTags ?? [])].some((value) => value.toLowerCase().includes(term));
    });
  }, [category, favoriteIds, favoritesOnly, query]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [selectedPlaceId]);
  if (selected) return <ExploreDetail place={selected} saved={favoriteIds.includes(selected.id)} onBack={() => onSelectPlace(null)} onToggleFavorite={() => onToggleFavorite(selected.id)} onPlanAround={() => onPlanAround(selected)} />;

  const featured = !favoritesOnly && !query && category === "all" ? publishedPlaces[0] : null;
  return <div className="pb-28">
    <header className="flex items-center justify-between px-5 pt-[max(18px,env(safe-area-inset-top))]">
      <div><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-rust">Wayly city guide</p><h1 className="mt-1 text-[29px] font-extrabold tracking-[-0.03em] text-ink">{favoritesOnly ? "Favorite places" : "Explore New York"}</h1></div>
      <button type="button" onClick={onProfile} aria-label="Open profile" className="grid size-10 place-items-center rounded-full bg-sel font-bold text-pine">{avatar ?? <UserRound className="size-5" />}</button>
    </header>

    <div className="mt-5 px-5">
      <label className="flex h-12 items-center gap-2.5 rounded-2xl border border-line bg-white px-3.5 shadow-card"><Search className="size-5 text-muted-ink" /><input aria-label="Search NYC places" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search places or neighborhoods" className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted-ink" /></label>
      <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">{categories.map((item) => <button key={item.value} type="button" onClick={() => setCategory(item.value)} aria-pressed={category === item.value} className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold ${category === item.value ? "bg-pine text-white" : "border border-line bg-white text-ink"}`}>{item.label}</button>)}</div>
    </div>

    {featured && <section className="mt-5 px-5"><div className="mb-2 flex items-center justify-between"><h2 className="text-[17px] font-extrabold text-ink">Start exploring</h2><button type="button" onClick={onOpenFavorites} className="flex items-center gap-1 text-xs font-bold text-pine"><Bookmark className="size-3.5" />Favorites ({favoriteIds.length})</button></div><button type="button" onClick={() => onSelectPlace(featured.id)} className="relative block h-44 w-full overflow-hidden rounded-[24px] text-left shadow-card"><PlaceImage place={featured} width={720} className="absolute inset-0" /><span className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/10 to-transparent" /><span className="absolute bottom-4 left-4 right-4 text-white"><strong className="block text-xl font-extrabold">{featured.name}</strong><span className="mt-1 flex items-center gap-1 text-xs font-medium text-white/85"><MapPin className="size-3.5" />{featured.neighborhood}<ArrowRight className="ml-auto size-4" /></span></span></button></section>}

    <section className="mt-6 px-5"><div className="mb-3 flex items-end justify-between gap-2"><div><h2 className="text-[18px] font-extrabold text-ink">{favoritesOnly ? "Saved on this device" : "Published places"}</h2><p className="mt-0.5 text-xs text-muted-ink">{filtered.length} {filtered.length === 1 ? "place" : "places"} · source-linked catalog</p></div>{favoritesOnly && <button type="button" onClick={onShowAll} className="text-xs font-bold text-pine">View all</button>}</div>
      {filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-line bg-white px-5 py-10 text-center"><Bookmark className="mx-auto size-6 text-pine" /><p className="mt-2 text-sm font-bold text-ink">{favoritesOnly && !query && category === "all" ? "No favorite places yet" : "No places found"}</p><p className="mt-1 text-xs text-muted-ink">{favoritesOnly ? "Tap the heart on a place to keep it here." : "Try another name or category."}</p></div>
        : <div className="grid grid-cols-2 gap-3">{filtered.map((place) => <article key={place.id} className="min-w-0 overflow-hidden rounded-[20px] border border-line bg-white shadow-card"><div className="relative"><button type="button" onClick={() => onSelectPlace(place.id)} aria-label={`View ${place.name}`} className="relative block aspect-[1.08] w-full overflow-hidden"><PlaceImage place={place} width={360} className="absolute inset-0" /></button><button type="button" onClick={() => onToggleFavorite(place.id)} aria-label={`${favoriteIds.includes(place.id) ? "Remove" : "Save"} ${place.name} ${favoriteIds.includes(place.id) ? "from" : "to"} favorites`} aria-pressed={favoriteIds.includes(place.id)} className="absolute right-2 top-2 grid size-9 place-items-center rounded-full bg-white/95 text-pine shadow-float"><Heart className="size-[18px]" fill={favoriteIds.includes(place.id) ? "currentColor" : "none"} /></button></div><button type="button" onClick={() => onSelectPlace(place.id)} className="block w-full px-3 pb-3 pt-2.5 text-left"><strong className="line-clamp-2 min-h-10 text-[13px] font-bold leading-5 text-ink">{place.name}</strong><span className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-ink"><MapPin className="size-3 shrink-0" />{place.neighborhood}</span><span className="mt-2 block text-[11px] font-bold text-pine">{place.planningAllowanceUsd ? `$${place.planningAllowanceUsd} planning allowance` : "Free planning allowance"}</span></button></article>)}</div>}
      <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-4 text-muted-ink"><Info className="mt-px size-3.5 shrink-0" />Catalog details are planning references. Check each source for current hours and prices.</p>
    </section>
  </div>;
}

function ExploreDetail({ place, saved, onBack, onToggleFavorite, onPlanAround }: { place: NycPlace; saved: boolean; onBack: () => void; onToggleFavorite: () => void; onPlanAround: () => void }) {
  const photo = usePlaceImage(place, 1000);
  return <div className="pb-32"><div className="relative h-[330px] overflow-hidden bg-sage"><PlaceImageView state={photo} category={place.interests[0]} alt={`${place.name} preview`} className="absolute inset-0" /><div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-ink/50 to-transparent" /><div className="absolute inset-x-4 top-[max(14px,env(safe-area-inset-top))] flex justify-between"><button type="button" onClick={onBack} aria-label="Back to places" className="grid size-10 place-items-center rounded-full bg-white/95 text-ink shadow-float"><ChevronLeft className="size-5" /></button><button type="button" onClick={onToggleFavorite} aria-label={saved ? "Remove from favorites" : "Save to favorites"} aria-pressed={saved} className="grid size-10 place-items-center rounded-full bg-white/95 text-pine shadow-float"><Heart className="size-5" fill={saved ? "currentColor" : "none"} /></button></div>{photo.image && <a href={photo.image.creditUrl} target="_blank" rel="noreferrer" className="absolute bottom-11 right-4 rounded-full bg-ink/60 px-2.5 py-1 text-[11px] font-semibold text-white">Image credit</a>}</div>
    <section className="relative -mt-7 rounded-t-[28px] bg-soft px-5 pb-6 pt-6 shadow-sheet"><p className="text-[11px] font-bold uppercase tracking-[0.1em] text-rust">{place.interests[0]} · NYC catalog</p><h1 className="mt-1 text-[27px] font-extrabold leading-8 tracking-[-0.03em] text-ink">{place.name}</h1><p className="mt-2 flex items-center gap-1.5 text-sm text-muted-ink"><MapPin className="size-4 text-pine" />{place.neighborhood}</p>
      <div className="mt-5 grid grid-cols-3 gap-2">{[{ icon: Clock3, value: `${place.suggestedMinutes} min`, label: "Suggested visit" }, { icon: WalletCards, value: place.planningAllowanceUsd ? `$${place.planningAllowanceUsd}` : "Free", label: "Allowance" }, { icon: ShieldCheck, value: place.reviewedOn, label: "Source reviewed" }].map(({ icon: Icon, value, label }) => <div key={label} className="rounded-2xl border border-line bg-white px-2 py-3 text-center"><Icon className="mx-auto size-4 text-pine" /><strong className="mt-1.5 block truncate text-xs font-bold text-ink">{value}</strong><span className="mt-0.5 block text-[10px] text-muted-ink">{label}</span></div>)}</div>
      <div className="mt-5 space-y-3"><div className="rounded-2xl border border-line bg-white p-4"><h2 className="text-sm font-bold text-ink">Before you go</h2><p className="mt-2 text-xs leading-5 text-muted-ink">{place.accessNote}</p><p className="mt-2 text-xs leading-5 text-muted-ink">{place.priceNote}</p></div><a href={place.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4"><span className="grid size-9 place-items-center rounded-xl bg-sel text-pine"><ExternalLink className="size-4" /></span><span className="min-w-0 flex-1"><strong className="block text-sm font-bold text-ink">Open primary source</strong><span className="block truncate text-xs text-muted-ink">{place.sourceName}</span></span><ArrowRight className="size-4 text-pine" /></a></div>
      <p className="mt-4 text-center text-[11px] leading-4 text-muted-ink">Review your trip details before planning. A place is only selected if it fits the route and constraints.</p>
    </section><div className="fixed bottom-0 left-1/2 z-30 w-full max-w-[390px] -translate-x-1/2 border-t border-line bg-white/95 px-5 pb-[max(18px,env(safe-area-inset-bottom))] pt-3 backdrop-blur"><button type="button" onClick={onPlanAround} className="flex h-13 w-full items-center justify-center gap-2 rounded-[18px] bg-pine text-sm font-bold text-white shadow-cta"><ArrowRight className="size-4" />Plan with this place in mind</button></div>
  </div>;
}
