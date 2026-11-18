"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { CalendarDays, Compass, MapPin, MessageCircle, Route, Sparkles, WalletCards } from "lucide-react";
import { PlaceImage } from "@/components/place-image";
import { publishedPlaces } from "@/lib/nyc-places";

const KEY = "wayly-nyc-onboarding-v1";
const slides = [
  { eyebrow: "WELCOME TO WAYLY", title: "Your New York day starts here", description: "Explore the city, choose what you love, and turn a few ideas into a day that feels like yours." },
  { eyebrow: "EXPLORE", title: "Find places worth your time", description: "Browse New York favorites, save the spots you like, and bring them into your next plan." },
  { eyebrow: "PLAN", title: "Make the day your own", description: "Describe your day in one sentence — add #tags like #food or #views. Wayly builds a route with costs and sources, and Ask Wayly fine-tunes it." },
] as const;
const featured = publishedPlaces.filter((place) => place.interests.includes("landmark") || place.interests.includes("park")).slice(0, 2);

export function replayOnboarding() {
  try { window.localStorage.removeItem(KEY); } catch { /* The guide still opens after reload. */ }
  window.location.reload();
}

function readSeen(): boolean | null {
  try { return window.localStorage.getItem(KEY) === "done"; } catch { return false; }
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const seen = useSyncExternalStore(subscribe, readSeen, () => null);
  const [completed, setCompleted] = useState(false);
  if (seen === null) return <main className="min-h-dvh bg-soft" />;
  if (seen || completed) return <>{children}</>;
  return <Onboarding onComplete={() => { try { window.localStorage.setItem(KEY, "done"); } catch { /* Continue without storage. */ } setCompleted(true); }} />;
}

function Onboarding({ onComplete }: { onComplete: () => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const goTo = (index: number) => rail.current?.scrollTo({ left: rail.current.clientWidth * index, behavior: "smooth" });
  return <main className="min-h-dvh bg-[#ece6d9] text-ink">
    <div className="mx-auto flex min-h-dvh max-w-[390px] flex-col bg-soft shadow-[0_0_40px_rgba(13,41,64,0.08)]">
      <header className="flex items-center justify-between px-6 pt-[max(22px,env(safe-area-inset-top))]"><strong className="text-[19px] tracking-[0.05em]">WAYLY</strong><button type="button" onClick={onComplete} className="min-h-10 px-2 text-sm font-semibold text-muted-ink">Skip</button></header>
      <div ref={rail} aria-label="App introduction" onScroll={(event) => setPage(Math.min(slides.length - 1, Math.max(0, Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth))))} className="wayly-onboarding-rail flex flex-1 snap-x snap-mandatory overflow-x-auto scroll-smooth">
        {slides.map((slide, index) => <section key={slide.eyebrow} aria-label={`Introduction ${index + 1} of ${slides.length}`} className="flex w-full shrink-0 snap-center flex-col px-6">
          <div className="relative mt-4 h-[clamp(200px,36dvh,380px)] overflow-hidden rounded-[32px] bg-sel">
            {index === 0 && <><img src="/images/nyc-hero.jpg" alt="New York City skyline" className="size-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-ink/50 via-transparent to-transparent" /><span className="absolute bottom-5 left-5 flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-xs font-bold text-pine"><MapPin className="size-4" /> New York City</span></>}
            {index === 1 && <div className="flex size-full flex-col justify-center gap-2.5 bg-gradient-to-b from-sel to-paper p-4">{featured.map((place, cardIndex) => <div key={place.id} className={`flex items-center gap-3 rounded-[22px] bg-white p-2 shadow-card ${cardIndex ? "ml-6" : "mr-6"}`}><PlaceImage place={place} width={300} className="relative size-[68px] shrink-0 overflow-hidden rounded-2xl" /><span className="min-w-0"><strong className="line-clamp-2 text-xs">{place.name}</strong><small className="mt-1 block text-[10px] text-muted-ink">New York City</small><span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-pine"><Compass className="size-3" /> Explore place</span></span></div>)}<span className="mx-auto flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-pine shadow-card"><Sparkles className="size-4" /> Save your favorites</span></div>}
            {index === 2 && <div className="flex size-full flex-col justify-center bg-gradient-to-b from-sel to-paper p-3"><div className="rounded-[22px] bg-white p-3 shadow-card"><div className="flex items-center justify-between"><strong className="text-sm">A day made for you</strong><span className="rounded-full bg-sel px-2 py-1 text-[9px] font-bold text-pine">NYC PLAN</span></div><div className="mt-2 space-y-2">{[{ icon: Sparkles, title: "Say what you want", detail: "“Jazz in the Village #food”" }, { icon: Route, title: "Get an AI-checked route", detail: "Stops in a sensible order, costs shown" }, { icon: MessageCircle, title: "Ask Wayly to adjust", detail: "Swap a stop, shorten, re-budget" }].map(({ icon: Icon, title, detail }, row) => <div key={title} className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-sel text-pine"><Icon className="size-4" /></span><span className="flex-1"><strong className="block text-[11px]">{title}</strong><small className="text-[9px] text-muted-ink">{detail}</small></span>{row < 2 && <span className="text-pine">✓</span>}</div>)}</div><div className="mt-2 flex items-center gap-2 rounded-lg bg-pine px-2.5 py-2 text-[10px] font-semibold text-white"><CalendarDays className="size-3.5" /> Your itinerary is ready to explore</div></div></div>}
          </div>
          <p className="mt-5 text-[11px] font-extrabold tracking-[0.16em] text-pine">{slide.eyebrow}</p>
          <h1 className="mt-2 text-[28px] font-extrabold leading-[1.2] tracking-[-0.03em]">{slide.title}</h1>
          <p className="mt-2 text-[13px] leading-6 text-muted-ink">{slide.description}</p>
        </section>)}
      </div>
      <div className="px-6 pb-[max(16px,env(safe-area-inset-bottom))] pt-3"><div className="mb-3 flex justify-center gap-2" aria-label="Introduction pages">{slides.map((slide, index) => <button key={slide.eyebrow} type="button" onClick={() => goTo(index)} aria-label={`Go to page ${index + 1}`} aria-current={page === index ? "step" : undefined} className={`h-2 rounded-full transition-all ${page === index ? "w-8 bg-pine" : "w-2 bg-line"}`} />)}</div><button type="button" onClick={() => page === slides.length - 1 ? onComplete() : goTo(page + 1)} className="flex h-14 w-full items-center justify-center rounded-2xl bg-pine text-base font-bold text-white shadow-cta">{page === slides.length - 1 ? "Get started" : "Next"}</button></div>
    </div>
  </main>;
}
