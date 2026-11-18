"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Binoculars, Bookmark, Building2, CalendarDays, Car, ChartPie, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Clock3, Compass, Copy, Drama, ExternalLink, FileText, FlaskConical, Footprints, Hourglass, Info, Landmark, Leaf, Library, Loader2, LogOut, MapPin, MessageCircle, Minus, Navigation, Palette, Pencil, Plus, RefreshCw, Route, Search, Send, Share, ShieldCheck, SlidersHorizontal, Smile, Sparkles, Star, Tag, Train, Trash2, UserRound, Users, Utensils, WalletCards, Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RouteMapClient } from "@/components/route-map-client";
import { PlaceImage, PlaceImageView, usePlaceImage } from "@/components/place-image";
import { NycExplore } from "@/components/nyc-explore";
import { suggestReplacements } from "@/lib/nyc-replacements";
import { publishedPlaces } from "@/lib/nyc-places";
import { authFetch } from "@/lib/supabase-browser";
import { useSession, type SessionState } from "@/lib/use-session";
import { RequireAuth } from "@/components/auth/require-auth";
import { HashtagInput } from "@/components/hashtag-input";
import { AskWaylyScreen, type AskMessage } from "@/components/ask-wayly";
import type { AskAction } from "@/lib/nyc-ask";
import { effectiveInterests, parseHashtags } from "@/lib/nyc-hashtags";
import { OnboardingGate, replayOnboarding } from "@/components/onboarding-gate";
import type { IntentParse, Itinerary, ItineraryStop, NycPlace, PlaceCategory, PlanMode, PlanRequest, TransportSegment } from "@/lib/nyc-types";

/** Today's date in New York (YYYY-MM-DD), so the planner never defaults to a past day. */
function todayInNewYork() {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}

const initialRequest: PlanRequest = {
  cityCode: "nyc", date: todayInNewYork(), duration: "half_day", durationHours: 6,
  partySize: 2, totalBudgetUsd: 220, interests: ["landmark", "architecture", "museum"],
  intentText: "", transportPreference: "smart", walkingPreference: "balanced",
  dining: "no_preference", accessibility: false,
};

// Default-interest choices on the profile screen (the planner uses #tags in the request box instead).
const shortcuts: Array<{ label: string; category: PlaceCategory; icon: typeof MapPin }> = [
  { label: "Landmarks", category: "landmark", icon: Landmark }, { label: "Museums", category: "museum", icon: Library },
  { label: "Parks", category: "park", icon: Leaf }, { label: "Waterfront", category: "waterfront", icon: Waves },
  { label: "Food", category: "food", icon: Utensils }, { label: "Views", category: "views", icon: Binoculars },
  { label: "Architecture", category: "architecture", icon: Building2 }, { label: "History", category: "history", icon: Hourglass },
  { label: "Art", category: "art", icon: Palette }, { label: "Science", category: "science", icon: FlaskConical },
  { label: "Shows & music", category: "performance", icon: Drama }, { label: "Family", category: "family", icon: Smile },
];

const categoryLabel: Record<string, string> = { landmark: "Landmark", museum: "Museum", park: "Park", waterfront: "Waterfront", food: "Food", views: "Views", architecture: "Architecture", history: "History", art: "Art", science: "Science", performance: "Shows & music", family: "Family" };
const HERO_IMAGE = "/images/nyc-hero.jpg";
const BUDGET_SLIDER_MAX = 1000;
// Donut palette from the Figma budget card.
const chartColors = ["#185e56", "#c66230", "#8fc1a9", "#e2be8c", "#5e7c8a", "#0d2940"];

type Screen = "planner" | "explore" | "favorites" | "loading" | "itinerary" | "adjust" | "changed" | "conflict" | "error" | "profile" | "detail" | "costs" | "ask";
type Tab = "plan" | "itinerary" | "explore" | "ask" | "costs";
type SheetName = "city" | "preferences" | "transport" | "handoff" | "feedback" | "auth" | null;
type PreferenceKey = "transport" | "walking" | "dining" | "accessibility";
type AdjustmentAction = "replace" | "shorten" | "budget";
type TransportMode = "walk" | "public_transit" | "taxi";
type AuthReason = "plan" | "save";
type SavedPlan = { id: string; title: string; planMode: PlanMode | null; itinerary: Itinerary; createdAt: string };
type SavedPreferences = Pick<PlanRequest, "totalBudgetUsd" | "partySize" | "interests" | "transportPreference" | "walkingPreference" | "dining">;
/** What a guest was doing when sign-in interrupted them; resumed after they come back signed in. */
type PendingAction = { action: AuthReason; request: PlanRequest; itinerary?: Itinerary | null; mode?: PlanMode | null; intentParse?: IntentParse | null };
const PENDING_KEY = "wayly-nyc-pending";
function readPending(): PendingAction | null { try { const raw = window.sessionStorage.getItem(PENDING_KEY); window.sessionStorage.removeItem(PENDING_KEY); return raw ? JSON.parse(raw) as PendingAction : null; } catch { return null; } }
function writePending(value: PendingAction) { try { window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(value)); } catch { /* storage unavailable: the user just re-enters inputs */ } }
function readFavorites(key: string): string[] { if (typeof window === "undefined") return []; try { const saved = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown; return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string" && publishedPlaces.some((place) => place.id === id)) : []; } catch { return []; } }
function initialOf(session: SessionState) { if (session.status !== "authed") return null; return (session.user.displayName || session.user.email || "?").trim().charAt(0).toUpperCase(); }
type PlanResponse = { itinerary?: Itinerary | null; mode?: PlanMode; insufficiencyReason?: string; warning?: string; intentParse?: IntentParse; error?: { message?: string } };

const preferences: Record<PreferenceKey, { title: string; options: Array<{ value: string; label: string; note?: string }> }> = {
  transport: { title: "Getting around", options: [
    { value: "smart", label: "Smart recommendation", note: "Use walking for short links and transit for longer ones." },
    { value: "public_transit", label: "Public transit" }, { value: "taxi", label: "Taxi preferred" }, { value: "walk", label: "Walk preferred" },
  ] },
  walking: { title: "Walking pace", options: [{ value: "easy", label: "Easy" }, { value: "balanced", label: "Balanced" }, { value: "active", label: "Active" }] },
  dining: { title: "Dining preference", options: [{ value: "no_preference", label: "No preference" }, { value: "vegetarian", label: "Vegetarian-friendly" }, { value: "coffee", label: "Coffee stop" }, { value: "local", label: "Local food" }] },
  accessibility: { title: "Accessibility", options: [{ value: "false", label: "No specific accessibility request" }, { value: "true", label: "Prioritize accessibility", note: "Confirm venue accessibility directly before travel." }] },
};

function formatDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", weekday: "short" }).format(parsed);
}
function formatShortDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", weekday: "short" }).format(parsed);
}

function clampNumber(value: string, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function addMinutes(time: string, minutes: number) {
  const [hours, mins] = time.split(":").map(Number);
  const total = (hours * 60 + mins + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function hostname(url: string) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } }

function hoursFor(request: PlanRequest) { return request.durationHours ?? (request.duration === "full_day" ? 10 : 6); }
/** Per-mode line for the travel-mode sheet. Only the routed (recommended) mode has a measured time; the others never borrow it. */
const TRANSIT_FARE_USD = 2.9; // same per-person fare the router adds when it switches a leg to transit
function transportEstimate(mode: TransportMode, segment: TransportSegment, partySize: number) {
  const routed = segment.recommendedMode === mode;
  const time = `Estimated ${segment.estimatedMinutes.min}–${segment.estimatedMinutes.max} min`;
  const people = partySize === 1 ? "1 traveler" : `${partySize} travelers`;
  if (mode === "walk") return routed ? `${time} · $0` : "$0 · usually a longer walk — check in maps";
  if (mode === "public_transit") {
    const fare = routed && segment.estimatedCostUsd && segment.estimatedCostUsd.max > 0
      ? `$${segment.estimatedCostUsd.min.toFixed(2)}–$${segment.estimatedCostUsd.max.toFixed(2)}`
      : `~$${(TRANSIT_FARE_USD * partySize).toFixed(2)}`;
    return `${routed ? `${time} · ` : ""}${fare} for ${people}${routed ? "" : " · time depends on the line"}`;
  }
  return `${routed ? `${time} · ` : ""}Fare varies · confirm in your taxi app`;
}

function transportLabel(mode: TransportMode) { return mode === "walk" ? "Walk" : mode === "public_transit" ? "Public transit" : "Taxi"; }
function TransportIcon({ mode, className }: { mode: TransportMode; className?: string }) { const Icon = mode === "walk" ? Footprints : mode === "public_transit" ? Train : Car; return <Icon className={className} />; }
function preferenceText(request: PlanRequest, key: PreferenceKey) {
  if (key === "transport") return { smart: "Smart recommendation", public_transit: "Public transit", taxi: "Taxi preferred", walk: "Walk preferred" }[request.transportPreference];
  if (key === "walking") return { easy: "Easy", balanced: "Balanced", active: "Active" }[request.walkingPreference];
  if (key === "dining") return { no_preference: "No preference", vegetarian: "Vegetarian-friendly", coffee: "Coffee stop", local: "Local food" }[request.dining];
  return request.accessibility ? "Prioritized" : "Not selected";
}

/* ---------- Shared app chrome (Figma components: Status bar / Tab bar / buttons) ---------- */

function AppHeader({ onProfile, onBack, title }: { onProfile?: () => void; onBack?: () => void; title?: string }) {
  return <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between bg-soft/90 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur">
    {onBack ? <button type="button" onClick={onBack} aria-label="Go back" className="grid size-[42px] place-items-center rounded-full bg-white text-ink shadow-float"><ChevronLeft className="size-5" /></button> : <span className="text-[19px] font-extrabold tracking-[0.04em] text-ink">WAYLY</span>}
    {title ? <p className="text-sm font-bold text-ink">{title}</p> : null}
    {onProfile ? <button type="button" onClick={onProfile} aria-label="Open profile" className="grid size-[42px] place-items-center rounded-full bg-sel text-pine"><UserRound className="size-[18px]" /></button> : <span className="size-[42px]" />}
  </header>;
}

function FloatingButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} onClick={onClick} className="grid size-[42px] place-items-center rounded-full bg-white/95 text-ink shadow-float backdrop-blur">{children}</button>;
}

const tabs: Array<{ key: Tab; label: string; icon: typeof MapPin }> = [
  { key: "plan", label: "Plan", icon: MapPin },
  { key: "itinerary", label: "Itinerary", icon: CalendarDays },
  { key: "explore", label: "Explore", icon: Search },
  { key: "ask", label: "Ask Wayly", icon: MessageCircle },
  { key: "costs", label: "Costs", icon: ChartPie },
];

function BottomNav({ active, onNavigate }: { active: Tab | null; onNavigate: (tab: Tab) => void }) {
  return <nav aria-label="Primary navigation" className="fixed bottom-0 left-1/2 z-30 w-full max-w-[390px] -translate-x-1/2 border-t border-line bg-white/95 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
    <div className="mx-auto grid max-w-[390px] grid-cols-5 px-1">
      {tabs.map(({ key, label, icon: Icon }) => { const on = key === active; const featured = key === "explore"; return <button key={key} type="button" onClick={() => onNavigate(key)} aria-current={on ? "page" : undefined} className={`flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] ${on ? "font-bold text-pine" : "font-medium text-muted-ink"}`}>
        <span className={featured ? "-mt-5 grid size-11 place-items-center rounded-full bg-pine text-white shadow-cta" : `rounded-full px-2.5 py-[3px] ${on ? "bg-sel" : ""}`}><Icon className="size-[21px]" strokeWidth={2} /></span>{label}
      </button>; })}
    </div>
  </nav>;
}

function SectionCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-white ${className}`}>{children}</div>;
}

// Signed-in users only: guests (and anyone opening a shared link) go to /login first.
export default function Home() {
  return <OnboardingGate><RequireAuth><WaylyApp /></RequireAuth></OnboardingGate>;
}

function WaylyApp() {
  const [screen, setScreen] = useState<Screen>("planner");
  const [request, setRequest] = useState<PlanRequest>(initialRequest);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [previousItinerary, setPreviousItinerary] = useState<Itinerary | null>(null);
  const [mode, setMode] = useState<PlanMode | null>(null);
  const [intentParse, setIntentParse] = useState<IntentParse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [preferenceKey, setPreferenceKey] = useState<PreferenceKey>("transport");
  const [detailIndex, setDetailIndex] = useState(0);
  const [detailReturn, setDetailReturn] = useState<Screen>("itinerary");
  const [selectedSegment, setSelectedSegment] = useState<TransportSegment | null>(null);
  const [selectedTransport, setSelectedTransport] = useState<Record<string, TransportMode>>({});
  const [handoffProvider, setHandoffProvider] = useState<string | null>(null);
  const [adjustmentAction, setAdjustmentAction] = useState<AdjustmentAction>("replace");
  const [targetStopId, setTargetStopId] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [adjustmentBudget, setAdjustmentBudget] = useState(initialRequest.totalBudgetUsd);
  const [toast, setToast] = useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState({ satisfaction: 0, trust: 0, issueType: "", note: "" });
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [authReason, setAuthReason] = useState<AuthReason>("save");
  const [savedPlans, setSavedPlans] = useState<SavedPlan[] | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [savedItineraryId, setSavedItineraryId] = useState<string | null>(null);
  const [favoriteCache, setFavoriteCache] = useState<Record<string, string[]>>({});
  const [explorePlaceId, setExplorePlaceId] = useState<string | null>(null);
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null);
  const [planNudge, setPlanNudge] = useState<Tab | null>(null);
  const [askMessages, setAskMessages] = useState<AskMessage[]>([]);
  const { session, refresh: refreshSession, signOut } = useSession();
  const favoriteStorageKey = session.status === "authed" ? `wayly-nyc-favorites:${session.user.email ?? "unknown"}` : null;
  const favoriteIds = favoriteStorageKey ? favoriteCache[favoriteStorageKey] ?? readFavorites(favoriteStorageKey) : [];
  const avatar = avatarEmoji ?? initialOf(session);
  const resumedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const plannedPlaces = useMemo(() => itinerary?.stops.map((stop) => stop.place) ?? [], [itinerary]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [screen]);

  const showToast = (value: string) => { setToast(value); window.setTimeout(() => setToast((current) => current === value ? null : current), 3200); };
  const setDurationHours = (durationHours: number) => setRequest((current) => ({ ...current, durationHours, duration: durationHours > 7 ? "full_day" : "half_day" }));
  const askToSignIn = (reason: AuthReason, pending: PendingAction) => { writePending(pending); setAuthReason(reason); setSheet("auth"); };
  const generate = async (nextRequest = request, successScreen: "itinerary" | "changed" = "itinerary") => {
    // Planning can spend a paid AI call, so it needs an account whenever accounts are configured (the server enforces this too).
    if (session.status === "guest") { askToSignIn("plan", { action: "plan", request: nextRequest }); return; }
    controllerRef.current?.abort(); const controller = new AbortController(); controllerRef.current = controller; setMessage(null); setScreen("loading");
    try {
      const response = await authFetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextRequest), signal: controller.signal });
      const payload = await response.json() as PlanResponse;
      if (controller.signal.aborted) return;
      if (response.status === 401) { setScreen("planner"); askToSignIn("plan", { action: "plan", request: nextRequest }); return; }
      if (!response.ok) throw new Error(payload.error?.message ?? "The planning service is temporarily unavailable.");
      if (payload.itinerary && payload.mode && payload.mode !== "insufficient_information") { setItinerary(payload.itinerary); setSavedItineraryId(null); setMode(payload.mode); setIntentParse(payload.intentParse ?? null); setScreen(successScreen); if (payload.warning) showToast(payload.warning); return; }
      setMode("insufficient_information"); setMessage(payload.insufficiencyReason ?? "A reliable itinerary is not available for these constraints."); setScreen("conflict");
    } catch (error) { if (!controller.signal.aborted) { setMessage(error instanceof Error ? error.message : "The network is temporarily unavailable."); setScreen("error"); } }
    finally { if (controllerRef.current === controller) controllerRef.current = null; }
  };
  const savePlan = async (target = itinerary, targetMode = mode) => {
    if (!target) return;
    if (session.status === "disabled") { setAuthReason("save"); setSheet("auth"); return; }
    if (session.status !== "authed") { askToSignIn("save", { action: "save", request, itinerary: target, mode: targetMode, intentParse }); return; }
    if (savedItineraryId === target.id) { showToast("This plan is already in your profile."); return; }
    setSavingPlan(true);
    try {
      const response = await authFetch("/api/itineraries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itinerary: target, planMode: targetMode === "insufficient_information" ? null : targetMode }) });
      const payload = await response.json() as { itinerary?: SavedPlan; error?: { message?: string } };
      if (!response.ok || !payload.itinerary) throw new Error(payload.error?.message ?? "This plan couldn't be saved.");
      setSavedItineraryId(target.id); setSavedPlans((current) => current ? [payload.itinerary as SavedPlan, ...current] : current);
      showToast("Saved to your profile.");
    } catch (error) { showToast(error instanceof Error ? error.message : "This plan couldn't be saved."); } finally { setSavingPlan(false); }
  };
  const loadSavedPlans = useCallback(async () => {
    try { const response = await authFetch("/api/itineraries"); const payload = await response.json() as { itineraries?: SavedPlan[] }; setSavedPlans(response.ok ? payload.itineraries ?? [] : []); } catch { setSavedPlans([]); }
  }, []);
  const deleteSavedPlan = async (id: string) => {
    const response = await authFetch(`/api/itineraries/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (response?.ok) { setSavedPlans((current) => current?.filter((plan) => plan.id !== id) ?? null); showToast("Plan removed."); } else showToast("That plan couldn't be removed. Try again.");
  };
  const openSavedPlan = (plan: SavedPlan) => { setItinerary(plan.itinerary); setSavedItineraryId(plan.itinerary.id); setMode(plan.planMode); setIntentParse(null); setPreviousItinerary(null); setScreen("itinerary"); };
  const saveDefaults = async (body: SavedPreferences) => {
    const response = await authFetch("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (response?.ok) { setRequest((current) => ({ ...current, ...body })); showToast("Default trip settings saved."); return true; }
    showToast("Defaults couldn't be saved. Try again."); return false;
  };
  const saveProfile = async (displayName: string, avatarEmoji: string | null) => {
    const response = await authFetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName, avatarEmoji }) }).catch(() => null);
    if (response?.ok) { setAvatarEmoji(avatarEmoji); await refreshSession(); showToast("Profile updated."); return true; }
    showToast("Profile couldn't be updated. Try again."); return false;
  };
  const handleSignOut = async () => { await signOut(); setSavedPlans(null); setSavedItineraryId(null); setAvatarEmoji(null); setPlanNudge(null); setScreen("planner"); showToast("Signed out."); };

  // After sign-in: resume what the guest was doing, otherwise prefill saved default trip settings.
  const onSignedIn = useEffectEvent(() => {
    void authFetch("/api/profile").then((response) => response.ok ? response.json() as Promise<{ profile?: { avatarEmoji?: string | null } }> : null).then((payload) => setAvatarEmoji(payload?.profile?.avatarEmoji ?? null)).catch(() => undefined);
    const pending = readPending();
    if (pending?.action === "plan") { setRequest(pending.request); void generate(pending.request); return; }
    if (pending?.action === "save" && pending.itinerary) {
      setRequest(pending.request); setItinerary(pending.itinerary); setMode(pending.mode ?? null); setIntentParse(pending.intentParse ?? null); setScreen("itinerary");
      void savePlan(pending.itinerary, pending.mode ?? null);
      return;
    }
    void authFetch("/api/preferences").then((response) => response.ok ? response.json() as Promise<{ preferences?: SavedPreferences | null }> : null).then((payload) => {
      const saved = payload?.preferences; if (!saved) return;
      setRequest((current) => ({ ...current, totalBudgetUsd: saved.totalBudgetUsd, partySize: saved.partySize, interests: saved.interests.length ? saved.interests : current.interests, transportPreference: saved.transportPreference, walkingPreference: saved.walkingPreference, dining: saved.dining }));
    }).catch(() => undefined);
  });
  useEffect(() => {
    if (session.status === "guest") resumedRef.current = false;
    if (session.status !== "authed" || resumedRef.current) return;
    resumedRef.current = true;
    onSignedIn();
  }, [session.status]);
  const openProfile = () => { setPlanNudge(null); setScreen("profile"); };
  const toggleFavorite = (id: string) => {
    if (!favoriteStorageKey) return;
    const next = favoriteIds.includes(id) ? favoriteIds.filter((item) => item !== id) : [...favoriteIds, id];
    setFavoriteCache((current) => ({ ...current, [favoriteStorageKey]: next }));
    try { window.localStorage.setItem(favoriteStorageKey, JSON.stringify(next)); } catch { showToast("Favorites couldn't be saved on this device."); }
  };
  const planAroundPlace = (place: NycPlace) => {
    const category: PlaceCategory = place.interests[0] ?? "landmark";
    setRequest((current) => ({ ...current, adjustment: undefined, interests: current.interests.includes(category) ? current.interests : [...current.interests, category], intentText: current.intentText.toLowerCase().includes(place.name.toLowerCase()) ? current.intentText : `I'd like to visit ${place.name}. ${current.intentText}`.trim().slice(0, 300) }));
    setScreen("planner");
    showToast(`${place.name} added to your trip request. Review it before planning.`);
  };

  const openAdjustment = (action: AdjustmentAction = "replace") => { if (itinerary) { setAdjustmentAction(action); setTargetStopId(itinerary.stops[0]?.id ?? null); setCandidateId(null); setAdjustmentBudget(request.totalBudgetUsd); setScreen("adjust"); } };
  const runAdjustment = (kind: AdjustmentAction, options: { targetStopId?: string | null; candidateId?: string | null; budget?: number } = {}) => {
    if (!itinerary) return;
    const durationHours = kind === "shorten" ? Math.max(1, hoursFor(request) - 2) : request.durationHours;
    const next: PlanRequest = { ...request, durationHours, duration: (durationHours ?? hoursFor(request)) > 7 ? "full_day" : "half_day", totalBudgetUsd: kind === "budget" && options.budget !== undefined ? options.budget : request.totalBudgetUsd, adjustment: { action: kind, itineraryId: itinerary.id, previousPlaceIds: itinerary.stops.map((stop) => stop.placeId), ...(kind === "replace" && options.targetStopId ? { targetStopId: options.targetStopId } : {}), ...(kind === "replace" && options.candidateId ? { addPlaceIds: [options.candidateId] } : {}) } };
    setPreviousItinerary(itinerary); setRequest(next); void generate(next, "changed");
  };
  const applyAdjustment = () => runAdjustment(adjustmentAction, { targetStopId, candidateId, budget: adjustmentBudget });
  const applyAskAction = (action: AskAction) => {
    if (action.type === "replan") { const next: PlanRequest = { ...request, intentText: action.intentText, adjustment: undefined }; setPreviousItinerary(null); setRequest(next); void generate(next); return; }
    if (action.type === "replace") runAdjustment("replace", { targetStopId: action.targetStopId, candidateId: action.placeId });
    else if (action.type === "shorten") runAdjustment("shorten");
    else if (action.type === "budget") runAdjustment("budget", { budget: action.totalBudgetUsd });
  };
  const submitFeedback = async () => {
    if (!itinerary || !feedbackDraft.satisfaction || !feedbackDraft.trust) { showToast("Complete both ratings before submitting."); return; }
    setFeedbackSubmitting(true);
    try {
      const response = await authFetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itineraryId: itinerary.id, rating: feedbackDraft.satisfaction >= 4 ? "helpful" : "not_helpful", satisfactionScore: feedbackDraft.satisfaction, trustScore: feedbackDraft.trust, issueType: feedbackDraft.issueType || undefined, note: feedbackDraft.note || undefined, itineraryVersion: itinerary.version, dataVersionId: itinerary.dataVersionId }) });
      if (!response.ok) throw new Error(); setSheet(null); setFeedbackDraft({ satisfaction: 0, trust: 0, issueType: "", note: "" }); showToast("Thanks — your feedback was saved for this preview.");
    } catch { showToast("Feedback was not saved. Please try again later."); } finally { setFeedbackSubmitting(false); }
  };
  const copyHandoff = async () => {
    if (!selectedSegment || !itinerary) return;
    const from = itinerary.stops.find((stop) => stop.id === selectedSegment.fromStopId)?.name ?? "Start";
    const to = itinerary.stops.find((stop) => stop.id === selectedSegment.toStopId)?.name ?? "Destination";
    const text = `${from} to ${to} (${transportLabel(selectedTransport[selectedSegment.toStopId] ?? selectedSegment.recommendedMode)})`;
    try { await navigator.clipboard.writeText(text); showToast("Route endpoints copied."); } catch { showToast(text); }
  };
  const navigate = (tab: Tab) => {
    if (tab === "plan") { setPlanNudge(null); setScreen("planner"); return; }
    if (tab === "explore") { setPlanNudge(null); setExplorePlaceId(null); setScreen("explore"); return; }
    if (tab === "ask") { setPlanNudge(null); setScreen("ask"); return; }
    if (!itinerary) { setPlanNudge(tab); return; }
    setPlanNudge(null);
    setScreen(tab === "itinerary" ? "itinerary" : "costs");
  };
  const openDetail = (index: number, from: Screen) => { setDetailIndex(index); setDetailReturn(from); setScreen("detail"); };
  const openTransport = (segment: TransportSegment) => { setSelectedSegment(segment); setSheet("transport"); };
  const activeTab: Tab | null = screen === "planner" ? "plan" : screen === "explore" || screen === "favorites" ? "explore" : screen === "itinerary" || screen === "changed" ? "itinerary" : screen === "costs" ? "costs" : screen === "ask" ? "ask" : null;
  const showNav = ["planner", "explore", "favorites", "itinerary", "changed", "costs", "ask", "profile"].includes(screen) && !(explorePlaceId && (screen === "explore" || screen === "favorites"));

  return <main className="min-h-dvh bg-[#ece6d9] text-ink"><div className="relative mx-auto min-h-dvh max-w-[390px] overflow-x-clip bg-soft shadow-[0_0_40px_rgba(13,41,64,0.08)]">
    {screen === "planner" && <PlannerScreen request={request} setRequest={setRequest} setDurationHours={setDurationHours} openCity={() => setSheet("city")} openPreference={(key) => { setPreferenceKey(key); setSheet("preferences"); }} onGenerate={() => void generate()} onExplore={() => { setExplorePlaceId(null); setScreen("explore"); }} onExplorePlace={(id) => { setExplorePlaceId(id); setScreen("explore"); }} onProfile={openProfile} avatar={avatar} />}
    {(screen === "explore" || screen === "favorites") && <NycExplore key={screen} favoriteIds={favoriteIds} favoritesOnly={screen === "favorites"} selectedPlaceId={explorePlaceId} avatar={avatar} onSelectPlace={setExplorePlaceId} onToggleFavorite={toggleFavorite} onOpenFavorites={() => { setExplorePlaceId(null); setScreen("favorites"); }} onShowAll={() => { setExplorePlaceId(null); setScreen("explore"); }} onProfile={openProfile} onPlanAround={planAroundPlace} />}
    {screen === "loading" && <LoadingScreen request={request} onCancel={() => { controllerRef.current?.abort(); setScreen("planner"); showToast("Planning cancelled. Your inputs were kept."); }} />}
    {(screen === "itinerary" || screen === "changed") && itinerary && <ItineraryScreen itinerary={itinerary} previousItinerary={screen === "changed" ? previousItinerary : null} plannedPlaces={plannedPlaces} mode={mode} intentParse={intentParse} request={request} selectedTransport={selectedTransport} onBack={() => setScreen("planner")} onOpenDetail={(index) => openDetail(index, screen)} onOpenTransport={openTransport} onAdjust={openAdjustment} onSave={() => void savePlan()} saved={savedItineraryId === itinerary.id} saving={savingPlan} onFeedback={() => setSheet("feedback")} onClearChange={() => { setPreviousItinerary(null); setScreen("itinerary"); }} showToast={showToast} />}
    {screen === "detail" && itinerary && itinerary.stops[detailIndex] && <StopDetailScreen itinerary={itinerary} index={detailIndex} selectedTransport={selectedTransport} onBack={() => setScreen(detailReturn)} onSave={() => void savePlan()} onOpenTransport={openTransport} showToast={showToast} />}
    {screen === "costs" && <BudgetSourcesScreen itinerary={itinerary} request={request} focus="budget" avatar={avatar} onProfile={openProfile} onPlan={() => setScreen("planner")} onOpenDetail={(index) => openDetail(index, screen)} />}
    {screen === "ask" && <AskWaylyScreen itinerary={itinerary} request={request} messages={askMessages} setMessages={setAskMessages} onApply={applyAskAction} onPlan={() => setScreen("planner")} />}
    {screen === "adjust" && itinerary && <AdjustmentScreen itinerary={itinerary} request={request} action={adjustmentAction} targetStopId={targetStopId} candidateId={candidateId} budget={adjustmentBudget} onBack={() => setScreen("itinerary")} onAction={setAdjustmentAction} onTarget={(value) => { setTargetStopId(value); setCandidateId(null); }} onCandidate={setCandidateId} onBudget={setAdjustmentBudget} onSubmit={applyAdjustment} />}
    {screen === "conflict" && <ConstraintScreen message={message ?? "These constraints cannot produce a reliable route."} request={request} onEdit={() => setScreen("planner")} onRelax={() => { setRequest((current) => ({ ...current, totalBudgetUsd: Math.min(10_000, current.totalBudgetUsd + 25), accessibility: false, dining: current.dining === "vegetarian" ? "no_preference" : current.dining })); setScreen("planner"); }} />}
    {screen === "error" && <ErrorScreen message={message ?? "The service is temporarily unavailable."} onRetry={() => void generate()} onEdit={() => setScreen("planner")} />}
    {screen === "profile" && <ProfileScreen session={session} avatar={avatar} request={request} savedPlans={savedPlans} favoriteCount={favoriteIds.length} onOpenFavorites={() => { setExplorePlaceId(null); setScreen("favorites"); }} onLoadPlans={loadSavedPlans} onBack={() => setScreen("planner")} onOpenPlan={openSavedPlan} onDeletePlan={(id) => void deleteSavedPlan(id)} onSaveDefaults={saveDefaults} onSaveProfile={saveProfile} onSignOut={() => void handleSignOut()} />}
    {showNav && <BottomNav active={activeTab} onNavigate={navigate} />}
    {planNudge && <aside key={planNudge} aria-live="polite" className="wayly-nudge fixed bottom-[86px] left-1/2 z-40 w-[calc(100%-32px)] max-w-[358px] rounded-[22px] border border-line bg-white p-4 shadow-sheet"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-sel text-pine"><Sparkles className="size-5" /></span><div className="flex-1"><strong className="block text-sm font-extrabold">Start with a plan ✨</strong><p className="mt-1 text-xs leading-5 text-muted-ink">Create a plan first, then your {planNudge === "itinerary" ? "itinerary" : "costs and sources"} will appear here.</p></div><button type="button" onClick={() => setPlanNudge(null)} aria-label="Dismiss prompt" className="text-lg leading-5 text-muted-ink">×</button></div><button type="button" onClick={() => { setPlanNudge(null); setScreen("planner"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="mt-3 h-10 w-full rounded-xl bg-pine text-sm font-bold text-white">Create a plan</button></aside>}
  </div>
  <OverlaySheets sheet={sheet} setSheet={setSheet} request={request} setRequest={setRequest} preferenceKey={preferenceKey} selectedSegment={selectedSegment} itinerary={itinerary} selectedTransport={selectedTransport} setSelectedTransport={setSelectedTransport} handoffProvider={handoffProvider} setHandoffProvider={setHandoffProvider} feedbackDraft={feedbackDraft} setFeedbackDraft={setFeedbackDraft} feedbackSubmitting={feedbackSubmitting} submitFeedback={submitFeedback} copyHandoff={copyHandoff} authReason={authReason} authDisabled={session.status === "disabled"} />
  {toast && <output aria-live="polite" className="fixed inset-x-5 bottom-28 z-[60] mx-auto max-w-[350px] rounded-2xl bg-ink px-4 py-3 text-center text-sm text-white shadow-xl">{toast}</output>}
  </main>;
}

/* ---------- 01 — Plan (Figma: 01 — Plan) ---------- */

function PlanTile({ icon: Icon, label, children, onClick }: { icon: typeof MapPin; label: string; children: ReactNode; onClick?: () => void }) {
  const body = <><span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-sel text-pine"><Icon className="size-[17px]" /></span><span className="min-w-0 flex-1"><span className="block text-[11px] font-medium text-muted-ink">{label}</span><span className="mt-0.5 flex items-center text-[15px] font-bold text-ink">{children}</span></span></>;
  return onClick
    ? <button type="button" onClick={onClick} className="flex min-h-[64px] items-center gap-2.5 rounded-2xl border border-line bg-white px-3 py-3 text-left">{body}<ChevronDown className="size-4 shrink-0 text-muted-ink" /></button>
    : <label className="flex min-h-[64px] items-center gap-2.5 rounded-2xl border border-line bg-white px-3 py-3">{body}</label>;
}

function AvatarBubble({ avatar, onClick, className }: { avatar: string | null; onClick: () => void; className: string }) {
  return <button type="button" onClick={onClick} aria-label="Open profile" className={`grid place-items-center rounded-full ${avatar ? "bg-pine text-[15px] font-extrabold text-white" : "bg-white/90 text-pine"} ${className}`}>{avatar ?? <UserRound className="size-[18px]" />}</button>;
}

function PlannerScreen({ request, setRequest, setDurationHours, openCity, openPreference, onGenerate, onExplore, onExplorePlace, onProfile, avatar }: { request: PlanRequest; setRequest: Dispatch<SetStateAction<PlanRequest>>; setDurationHours: (value: number) => void; openCity: () => void; openPreference: (key: PreferenceKey) => void; onGenerate: () => void; onExplore: () => void; onExplorePlace: (id: string) => void; onProfile: () => void; avatar: string | null }) {
  const fill = `${Math.min(100, (request.totalBudgetUsd / BUDGET_SLIDER_MAX) * 100)}%`;
  return <div className="pb-28">
    {/* Hero — city photo comes from city config; swap per city */}
    <div className="relative h-[340px] overflow-hidden">
      <img src={HERO_IMAGE} alt="Brooklyn Bridge and Lower Manhattan at sunset" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-x-0 top-0 h-[170px] bg-gradient-to-b from-ink/60 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[220px] bg-gradient-to-t from-ink/80 to-transparent" />
      <header className="absolute inset-x-0 top-0 flex items-center justify-between px-5 pt-[max(16px,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <span className="text-[19px] font-extrabold tracking-[0.04em] text-white">WAYLY</span>
          <button type="button" onClick={openCity} className="inline-flex items-center gap-1.5 rounded-full border border-white/40 bg-white/20 px-2.5 py-1.5 text-[13px] font-bold text-white backdrop-blur"><MapPin className="size-3.5" />New York<ChevronDown className="size-3.5" /></button>
        </div>
        <AvatarBubble avatar={avatar} onClick={onProfile} className="size-[38px]" />
      </header>
      <div className="absolute inset-x-5 bottom-14">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/35 bg-white/20 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"><Sparkles className="size-3" />Source-linked NYC plans</span>
        <h1 className="mt-2 text-[34px] font-extrabold leading-[38px] tracking-[-0.02em] text-white">Plan a clear<br />NYC day</h1>
      </div>
    </div>

    {/* Planner sheet */}
    <section className="relative -mt-10 space-y-3 rounded-t-[28px] bg-soft px-5 pb-6 pt-[22px] shadow-sheet">
      <div className="grid grid-cols-2 gap-2.5">
        <PlanTile icon={CalendarDays} label="Date"><input aria-label="Travel date" type="date" value={request.date} onChange={(event) => setRequest((current) => ({ ...current, date: event.target.value }))} className="w-full min-w-0 bg-transparent text-[14px] font-bold outline-none" /></PlanTile>
        <PlanTile icon={Clock3} label="Available"><input aria-label="Available hours" type="number" min="1" max="24" value={hoursFor(request)} onChange={(event) => setDurationHours(clampNumber(event.target.value, 1, 24, 6))} className="w-6 bg-transparent outline-none" /><span className="ml-0.5">hours</span></PlanTile>
        <div className="flex min-h-[64px] items-center gap-2.5 rounded-2xl border border-line bg-white px-3 py-3">
          <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-sel text-pine"><Users className="size-[17px]" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[11px] font-medium text-muted-ink">Travelers</span>
            <span className="mt-0.5 flex items-center gap-2"><button type="button" aria-label="Remove traveler" onClick={() => setRequest((current) => ({ ...current, partySize: Math.max(1, current.partySize - 1) }))} className="grid size-6 place-items-center rounded-full border border-line text-muted-ink"><Minus className="size-3" /></button><strong className="text-[15px] font-bold">{request.partySize}</strong><button type="button" aria-label="Add traveler" onClick={() => setRequest((current) => ({ ...current, partySize: Math.min(8, current.partySize + 1) }))} className="grid size-6 place-items-center rounded-full border border-line text-muted-ink"><Plus className="size-3" /></button></span>
          </span>
        </div>
        <PlanTile icon={Footprints} label="Pace" onClick={() => openPreference("walking")}>{preferenceText(request, "walking")}</PlanTile>
      </div>

      <SectionCard className="space-y-3 p-3.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-ink"><WalletCards className="size-[17px] text-pine" />Total budget</span>
          <span className="flex items-baseline gap-1 text-pine"><span className="text-[15px] font-extrabold">$</span><input aria-label="Total budget in US dollars" type="number" min="0" max="10000" value={request.totalBudgetUsd} onChange={(event) => setRequest((current) => ({ ...current, totalBudgetUsd: clampNumber(event.target.value, 0, 10_000, current.totalBudgetUsd) }))} className="w-14 bg-transparent text-[15px] font-extrabold outline-none" /><span className="text-xs font-medium text-muted-ink">total</span></span>
        </div>
        <input aria-label="Total budget slider" type="range" min="0" max={BUDGET_SLIDER_MAX} step="10" value={Math.min(request.totalBudgetUsd, BUDGET_SLIDER_MAX)} onChange={(event) => setRequest((current) => ({ ...current, totalBudgetUsd: Number(event.target.value) }))} className="wayly-range w-full" style={{ ["--fill" as string]: fill }} />
        <div className="flex justify-between text-[11px] font-medium text-muted-ink"><span>$0</span><span>$250</span><span>$500</span><span>$750</span><span>$1,000+</span></div>
      </SectionCard>

      <SectionCard className="p-3.5">
        <label className="flex items-center gap-1.5 text-[13px] font-bold text-ink" htmlFor="trip-intent"><Sparkles className="size-4 text-pine" />Anything specific?</label>
        <HashtagInput id="trip-intent" value={request.intentText} onChange={(intentText) => setRequest((current) => ({ ...current, intentText }))} maxLength={300} placeholder="e.g. #history #food — a relaxed afternoon near the water" />
        <p className="text-right text-[10px] text-muted-ink">{request.intentText.length} / 300</p>
      </SectionCard>

      <SectionCard className="overflow-hidden">{(["transport", "dining", "accessibility"] as const).map((key) => <button key={key} type="button" onClick={() => openPreference(key)} className="flex min-h-[52px] w-full items-center justify-between border-b border-line px-3.5 text-left last:border-0"><span className="text-[13px] font-semibold text-ink">{preferences[key].title}</span><span className="flex items-center gap-1 text-xs font-medium text-muted-ink">{preferenceText(request, key)}<ChevronRight className="size-4" /></span></button>)}</SectionCard>

      <Button size="lg" onClick={onGenerate} className="h-14 w-full rounded-[18px] bg-pine text-base font-bold shadow-cta hover:bg-pine-dark"><Sparkles className="size-[18px]" />Create my plan</Button>
      <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-ink"><ShieldCheck className="size-3.5 text-pine" />Every stop is curated and source-linked</p>

      <div className="pt-5"><div className="mb-3 flex items-end justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.1em] text-rust">Looking for ideas?</p><h2 className="mt-0.5 text-[19px] font-extrabold text-ink">Explore NYC places</h2></div><button type="button" onClick={onExplore} className="flex items-center gap-1 text-xs font-bold text-pine">View all<ChevronRight className="size-4" /></button></div><div className="flex gap-3 overflow-x-auto pb-2">{publishedPlaces.slice(0, 4).map((place) => <button key={place.id} type="button" onClick={() => onExplorePlace(place.id)} className="w-[156px] shrink-0 overflow-hidden rounded-[20px] border border-line bg-white text-left shadow-card"><PlaceImage place={place} width={320} className="relative h-[112px] w-full" /><span className="block px-3 py-2.5"><strong className="line-clamp-2 min-h-10 text-[13px] font-bold leading-5 text-ink">{place.name}</strong><span className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-ink"><MapPin className="size-3 shrink-0" />{place.neighborhood}</span></span></button>)}</div></div>
    </section>
  </div>;
}

/* ---------- 02 — Itinerary (Figma: 02 — Itinerary) ---------- */

function ItineraryScreen({ itinerary, previousItinerary, plannedPlaces, mode, intentParse, request, selectedTransport, onBack, onOpenDetail, onOpenTransport, onAdjust, onSave, saved, saving, onFeedback, onClearChange, showToast }: { itinerary: Itinerary; previousItinerary: Itinerary | null; plannedPlaces: NycPlace[]; mode: PlanMode | null; intentParse: IntentParse | null; request: PlanRequest; selectedTransport: Record<string, TransportMode>; onBack: () => void; onOpenDetail: (index: number) => void; onOpenTransport: (segment: TransportSegment) => void; onAdjust: (action?: AdjustmentAction) => void; onSave: () => void; saved: boolean; saving: boolean; onFeedback: () => void; onClearChange: () => void; showToast: (value: string) => void }) {
  const previousIds = new Set(previousItinerary?.stops.map((stop) => stop.placeId) ?? []);
  return <div className="pb-28">
    {/* Live map (Leaflet) sits behind the sheet */}
    <div className="sticky top-0 isolate z-0 h-[380px]">
      <RouteMapClient places={plannedPlaces} route={itinerary.routeGeometry?.coordinates} className="wayly-map-sheet size-full bg-sage" topInset={70} bottomInset={60} />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))]">
        <span className="pointer-events-auto"><FloatingButton label="Back to planner" onClick={onBack}><ChevronLeft className="size-5" /></FloatingButton></span>
        <span className="pointer-events-auto"><FloatingButton label="Share itinerary" onClick={() => showToast("Export and sharing are reserved for a later release.")}><Share className="size-[18px]" /></FloatingButton></span>
      </div>
      <span className="absolute bottom-12 right-4 z-10 inline-flex items-center gap-2 rounded-[14px] bg-white px-3 py-2 text-xs font-semibold text-ink shadow-float"><Route className="size-4 text-pine" />{itinerary.estimatedWalkKm} km walking{itinerary.routeSource === "geoapify" ? "" : " · est."}</span>
    </div>

    <section className="relative z-10 -mt-8 rounded-t-[28px] bg-soft px-5 pb-6 pt-2.5 shadow-sheet">
      <div className="mx-auto h-[5px] w-10 rounded-full bg-line" />
      {previousItinerary && <div className="mt-4 rounded-2xl border border-pine/25 bg-sel p-3.5"><p className="flex items-center gap-1.5 text-sm font-bold text-pine"><Check className="size-4" />Your itinerary was updated</p><p className="mt-1 text-xs leading-5 text-[#4a6b63]">Highlighted stops changed; unaffected stops are kept when possible.</p><button type="button" onClick={onClearChange} className="mt-2 text-xs font-bold text-pine">Dismiss</button></div>}
      <div className="mt-4 flex items-start justify-between gap-3">
        <div><p className="text-[11px] font-bold tracking-[0.08em] text-rust">YOUR ROUTE · {formatShortDate(request.date).toUpperCase()}</p><h1 className="mt-0.5 text-2xl font-extrabold tracking-[-0.02em] text-ink">Your day in NYC</h1></div>
        <button type="button" onClick={() => onAdjust("replace")} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-pine px-3.5 text-[13px] font-bold text-white shadow-cta"><SlidersHorizontal className="size-4" />Adjust route</button>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {mode === "ai_structured"
          ? <span className="inline-flex items-center gap-1 rounded-full bg-pine px-2.5 py-1 text-[11px] font-bold text-white"><Sparkles className="size-3" />AI-picked route</span>
          : <span className="inline-flex items-center gap-1 rounded-full bg-sage px-2.5 py-1 text-[11px] font-bold text-muted-ink"><ShieldCheck className="size-3" />Rule-based route</span>}
        <span className="inline-flex items-center gap-1 rounded-full bg-sage px-2.5 py-1 text-[11px] font-bold text-muted-ink"><Route className="size-3" />{itinerary.routeSource === "geoapify" ? "Street-routed legs" : itinerary.routeSource === "partial" ? "Some legs street-routed" : "Estimated legs"}</span>
        {itinerary.stops.some((stop) => stop.dataOrigin === "realtime_geoapify") && <span className="inline-flex items-center gap-1 rounded-full bg-rust/10 px-2.5 py-1 text-[11px] font-bold text-rust"><Info className="size-3" />Includes live listings</span>}
      </div>
      {intentParse && intentParse.detectedSignals.length > 0 && <p className="mt-2 text-xs leading-5 text-muted-ink">{intentParse.note}</p>}
      <div className="mt-3.5 grid grid-cols-3 gap-2">
        <Stat icon={MapPin} value={`${itinerary.stops.length} stops`} onClick={() => onAdjust("replace")} label="Swap a stop" />
        <Stat icon={Clock3} value={`${hoursFor(request)} hours`} onClick={() => onAdjust("shorten")} label="Shorten the day" />
        <Stat icon={WalletCards} value={`$${itinerary.estimatedTotalSpendUsd.max} / $${request.totalBudgetUsd}`} onClick={() => onAdjust("budget")} label="Change the budget" />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2" aria-label="Adjust this route">
        {([{ action: "replace", label: "Swap a stop", icon: RefreshCw }, { action: "shorten", label: "Shorter day", icon: Clock3 }, { action: "budget", label: "Set budget", icon: WalletCards }] as const).map(({ action, label, icon: Icon }) => <button key={action} type="button" onClick={() => onAdjust(action)} className="inline-flex min-h-9 items-center justify-center gap-1 rounded-full bg-sel px-2 text-[12px] font-bold text-pine"><Icon className="size-3.5 shrink-0" />{label}</button>)}
      </div>

      <div className="mt-3.5">{itinerary.stops.map((stop, index) => { const place = stop.place; const changed = Boolean(previousItinerary && !previousIds.has(stop.placeId)); const segment = itinerary.transportSegments[index]; return <div key={stop.id}>
        <StopRow stop={stop} place={place} index={index} highlighted={index === 0 || changed} changed={changed} onClick={() => onOpenDetail(index)} />
        {segment && <LegConnector segment={segment} selectedMode={selectedTransport[segment.toStopId] ?? segment.recommendedMode} onOpen={() => onOpenTransport(segment)} />}
      </div>; })}</div>

      <div className="mt-4 rounded-2xl bg-sel p-3.5"><p className="flex items-center gap-1.5 text-xs font-bold text-pine"><ShieldCheck className="size-4" />Evidence and planning boundary</p><p className="mt-1.5 text-[11px] leading-5 text-[#4a6b63]">{itinerary.warnings.join(" ")}</p><p className="mt-1.5 text-[10px] text-muted-ink">{mode === "ai_structured" ? "AI-picked from a code-checked shortlist" : "Rule-based route"} · {itinerary.version}</p></div>
      <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="outline" onClick={onSave} disabled={saving} className={`h-11 rounded-2xl border-line ${saved ? "bg-sel text-pine" : "bg-white text-pine"}`}>{saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : <Bookmark />}{saved ? "Saved" : "Save plan"}</Button><Button variant="outline" onClick={onFeedback} className="h-11 rounded-2xl border-line bg-white text-ink"><Star />Rate itinerary</Button></div>
    </section>
  </div>;
}

function Stat({ icon: Icon, value, onClick, label }: { icon: typeof MapPin; value: string; onClick?: () => void; label?: string }) {
  const body = <><Icon className="size-3.5 shrink-0 text-pine" /><span className="truncate">{value}</span></>;
  const style = "flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-line bg-white px-2 text-xs font-bold text-ink";
  return onClick ? <button type="button" onClick={onClick} aria-label={label ? `${value} — ${label}` : value} className={`${style} transition hover:border-pine active:bg-sel`}>{body}</button> : <span className={style}>{body}</span>;
}

function StopRow({ stop, place, index, highlighted, changed, onClick }: { stop: ItineraryStop; place: NycPlace; index: number; highlighted: boolean; changed: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex w-full items-center gap-3 rounded-[20px] border p-2.5 pr-3.5 text-left shadow-card ${highlighted ? "border-pine/35 bg-sel" : "border-line bg-white"}`}>
    <span className="relative size-[72px] shrink-0 overflow-hidden rounded-[14px] bg-sage">
      <PlaceImage place={place} width={240} className="absolute inset-0" />
      <span className="absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-rust text-xs font-bold text-white ring-2 ring-white">{index + 1}</span>
    </span>
    <span className="min-w-0 flex-1">
      <strong className="block truncate text-[15px] font-bold text-ink">{place.name}</strong>
      <span className="mt-1 flex items-center gap-1 truncate text-xs font-medium text-muted-ink"><MapPin className="size-3.5 shrink-0" />{place.neighborhood}</span>
      <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs"><span className="flex items-center gap-1 font-semibold text-pine"><Clock3 className="size-3.5" />{stop.time} – {addMinutes(stop.time, stop.durationMinutes)}</span><span className="font-medium text-muted-ink">{stop.expectedSpendUsd ? `${stop.spendEstimated ? "~" : ""}$${stop.expectedSpendUsd}` : "Free"}</span>{stop.dataOrigin === "realtime_geoapify" && <span className="rounded-full bg-rust/10 px-2 py-0.5 text-[10px] font-bold text-rust">Live listing</span>}{changed && <span className="rounded-full bg-rust/10 px-2 py-0.5 text-[10px] font-bold text-rust">Updated</span>}</span>
    </span>
    <ChevronRight className="size-[18px] shrink-0 text-muted-ink" />
  </button>;
}

function LegConnector({ segment, selectedMode, onOpen }: { segment: TransportSegment; selectedMode: TransportMode; onOpen: () => void }) {
  return <div className="flex items-center gap-2.5 py-1.5 pl-[46px] pr-1">
    <span className="h-7 border-l-2 border-dashed border-line" />
    <span className="flex flex-1 items-center gap-1.5 text-xs font-medium text-muted-ink"><TransportIcon mode={selectedMode} className="size-3.5 text-pine" />{transportLabel(selectedMode)} · {segment.estimatedMinutes.min}–{segment.estimatedMinutes.max} min</span>
    <button type="button" onClick={onOpen} className="min-h-8 rounded-lg px-2 text-xs font-bold text-pine hover:bg-sel">Options</button>
  </div>;
}

/* ---------- 03 — Stop detail (Figma: 03 — Stop detail) ---------- */

function StopDetailScreen({ itinerary, index, selectedTransport, onBack, onSave, onOpenTransport, showToast }: { itinerary: Itinerary; index: number; selectedTransport: Record<string, TransportMode>; onBack: () => void; onSave: () => void; onOpenTransport: (segment: TransportSegment) => void; showToast: (value: string) => void }) {
  const stop = itinerary.stops[index]; const place = stop.place;
  const heroImage = usePlaceImage(place, 1000);
  if (!place) return null;
  const nextLeg = itinerary.transportSegments[index];
  const arrivingLeg = itinerary.transportSegments[index - 1];
  const category = categoryLabel[place.interests[0]] ?? place.interests[0];
  const rows: Array<{ icon: typeof MapPin; title: string; body: string; href?: string }> = [
    { icon: stop.reasonSource === "ai" ? Sparkles : FileText, title: stop.reasonSource === "ai" ? "Why it's on your route · AI" : "Why it's on your route", body: stop.reason },
    { icon: Info, title: "Access note", body: place.accessNote },
    { icon: Tag, title: "Budget note", body: place.priceNote },
    { icon: ExternalLink, title: `Source · ${place.sourceName}`, body: `${hostname(place.sourceUrl)} · ${place.dataOrigin === "realtime_geoapify" ? "retrieved" : "reviewed"} ${place.reviewedOn}`, href: place.sourceUrl },
  ];
  return <div className="pb-32">
    <div className="relative h-[330px] overflow-hidden bg-sage">
      <PlaceImageView state={heroImage} category={place.interests[0]} alt={`${place.name} preview`} className="absolute inset-0" />
      <div className="absolute inset-x-0 top-0 h-[150px] bg-gradient-to-b from-ink/55 to-transparent" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))]">
        <FloatingButton label="Back" onClick={onBack}><ChevronLeft className="size-5" /></FloatingButton>
        <div className="flex gap-2.5"><FloatingButton label="Save" onClick={onSave}><Bookmark className="size-[18px]" /></FloatingButton><FloatingButton label="Share" onClick={() => showToast("Sharing is reserved for a later release.")}><Share className="size-[18px]" /></FloatingButton></div>
      </div>
      {heroImage.image && <a href={heroImage.image.creditUrl} target="_blank" rel="noreferrer" className="absolute bottom-11 right-4 rounded-full bg-ink/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">Image credit</a>}
    </div>
    <section className="relative -mt-7 space-y-3.5 rounded-t-[28px] bg-soft px-5 pt-[22px] shadow-sheet">
      <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.08em] text-rust"><span className="grid size-6 place-items-center rounded-full bg-rust text-xs tracking-normal text-white">{index + 1}</span>STOP {index + 1} OF {itinerary.stops.length} · {category.toUpperCase()}</p>
      <h1 className="text-[26px] font-extrabold leading-[31px] tracking-[-0.02em] text-ink">{place.name}</h1>
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-2 text-xs font-semibold text-ink"><MapPin className="size-3.5 text-pine" />{place.neighborhood}</span>
        <span className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-2 text-xs font-semibold text-ink"><Clock3 className="size-3.5 text-pine" />{stop.time} – {addMinutes(stop.time, stop.durationMinutes)}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Fact icon={Clock3} value={`${stop.durationMinutes}m`} label="Visit" />
        <Fact icon={WalletCards} value={stop.expectedSpendUsd ? `${stop.spendEstimated ? "~" : ""}$${stop.expectedSpendUsd}` : "Free"} label={stop.spendEstimated ? "Estimate" : "Allowance"} />
        <Fact icon={nextLeg ? Footprints : Check} value={nextLeg ? `${nextLeg.estimatedMinutes.min}–${nextLeg.estimatedMinutes.max}m` : "End"} label={nextLeg ? "Next leg" : "Last stop"} />
        <Fact icon={stop.dataOrigin === "realtime_geoapify" ? Info : ShieldCheck} value={stop.dataOrigin === "realtime_geoapify" ? "Live" : "Linked"} label={stop.dataOrigin === "realtime_geoapify" ? "Not reviewed" : "Source"} />
      </div>
      <div className="overflow-hidden rounded-[20px] border border-line bg-white">{rows.map(({ icon: Icon, title, body, href }) => { const inner = <><span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-sage text-pine"><Icon className="size-[17px]" /></span><span className="min-w-0 flex-1"><strong className="block text-sm font-bold text-ink">{title}</strong><span className="mt-0.5 block text-xs leading-[18px] text-muted-ink">{body}</span></span>{href && <ChevronRight className="size-4 shrink-0 text-muted-ink" />}</>; return href ? <a key={title} href={href} target="_blank" rel="noreferrer" className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-0">{inner}</a> : <div key={title} className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-0">{inner}</div>; })}</div>
      {stop.dataOrigin === "realtime_geoapify" && <div className="rounded-2xl border border-rust/25 bg-rust/5 p-3.5 text-xs leading-5 text-rust"><Info className="mr-1 inline size-3.5" />Live map listing from OpenStreetMap. Wayly hasn&apos;t reviewed it{stop.spendEstimated ? ", and its spend is a category estimate" : ""} — confirm before you go.</div>}
      <div className="rounded-2xl border border-[#f2deb7] bg-[#fffaf0] p-3.5 text-xs leading-5 text-[#8a5a16]"><AlertTriangle className="mr-1 inline size-3.5" />Hours, reservations, tickets, and on-site conditions are not live. Check the source on the day of travel.</div>
    </section>
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-5 pb-[max(18px,env(safe-area-inset-bottom))] pt-3 backdrop-blur"><div className="mx-auto flex max-w-[350px] gap-2.5">
      <button type="button" aria-label="Getting here" onClick={() => arrivingLeg ? onOpenTransport(arrivingLeg) : showToast("This is your first stop — start here.")} className="grid size-14 shrink-0 place-items-center rounded-[18px] bg-sel text-pine">{arrivingLeg ? <TransportIcon mode={selectedTransport[arrivingLeg.toStopId] ?? arrivingLeg.recommendedMode} className="size-5" /> : <Navigation className="size-5" />}</button>
      <Button size="lg" onClick={onBack} className="h-14 flex-1 rounded-[18px] bg-pine text-base font-bold hover:bg-pine-dark"><ArrowLeft className="size-[18px]" />Back to itinerary</Button>
    </div></div>
  </div>;
}

function Fact({ icon: Icon, value, label }: { icon: typeof MapPin; value: string; label: string }) {
  return <span className="flex flex-col items-center gap-1 rounded-2xl bg-sel px-1 py-2.5 text-center"><Icon className="size-[18px] text-pine" /><strong className="text-sm font-extrabold text-ink">{value}</strong><small className="text-[10px] font-medium text-muted-ink">{label}</small></span>;
}

/* ---------- 04 — Budget & sources (Figma: 04 — Budget & sources) ---------- */

function BudgetSourcesScreen({ itinerary, request, focus, avatar, onProfile, onPlan, onOpenDetail }: { itinerary: Itinerary | null; request: PlanRequest; focus: "budget" | "sources"; avatar: string | null; onProfile: () => void; onPlan: () => void; onOpenDetail: (index: number) => void }) {
  const sourcesRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus === "sources") sourcesRef.current?.scrollIntoView({ block: "start" }); }, [focus]);
  const header = <div className="flex items-end justify-between px-5 pt-[max(18px,env(safe-area-inset-top))]"><div><p className="text-[13px] font-semibold text-muted-ink">{formatShortDate(request.date)} · {request.partySize} {request.partySize === 1 ? "adult" : "adults"}</p><h1 className="text-[30px] font-extrabold tracking-[-0.02em] text-ink">Costs & sources</h1></div><AvatarBubble avatar={avatar} onClick={onProfile} className={`mb-1 size-[38px] ${avatar ? "" : "!bg-sel"}`} /></div>;
  if (!itinerary) return <div className="pb-28">{header}<div className="mx-5 mt-6 rounded-3xl bg-white p-6 text-center shadow-card"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-sel text-pine"><ChartPie className="size-7" /></div><p className="mt-4 text-base font-bold text-ink">No plan yet</p><p className="mt-1 text-sm leading-6 text-muted-ink">Create a plan to see its budget breakdown and every linked source.</p><Button onClick={onPlan} className="mt-4 h-11 rounded-2xl bg-pine px-5 hover:bg-pine-dark"><Sparkles />Create my plan</Button></div></div>;

  const transportCost = itinerary.transportSegments.reduce((total, segment) => total + (segment.estimatedCostUsd ? (segment.estimatedCostUsd.min + segment.estimatedCostUsd.max) / 2 : 0), 0);
  const slices = [
    ...itinerary.stops.map((stop, index) => ({ label: `${index + 1}. ${stop.name.replace(/\s*\([^)]*\)\s*$/, "")}`, value: stop.expectedSpendUsd, estimated: stop.spendEstimated, color: chartColors[index % chartColors.length] })),
    { label: "Transit & taxis", value: Math.round(transportCost), estimated: true, color: chartColors[5] },
  ];
  const total = itinerary.estimatedTotalSpendUsd.max;
  const remaining = request.totalBudgetUsd - total;
  const chartTotal = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 52; const circumference = 2 * Math.PI * radius; let offset = 0;

  const budgetCard = <div className="rounded-3xl bg-white p-[18px] shadow-card">
    <div className="flex items-center gap-5">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 128 128" className="size-32 -rotate-90" aria-hidden="true">
          <circle cx="64" cy="64" r={radius} fill="none" stroke="#edf3ed" strokeWidth="18" />
          {chartTotal > 0 && slices.filter((slice) => slice.value > 0).map((slice) => { const length = (slice.value / chartTotal) * circumference; const gap = 2; const dash = Math.max(0, length - gap); const element = <circle key={slice.label} cx="64" cy="64" r={radius} fill="none" stroke={slice.color} strokeWidth="18" strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} />; offset += length; return element; })}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center"><strong className="text-[22px] font-extrabold leading-none text-ink">${total}</strong><small className="mt-1 text-[11px] font-medium text-muted-ink">of ${request.totalBudgetUsd}</small></div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2">{slices.map((slice) => <li key={slice.label} className="flex items-center gap-2 text-[13px]"><span className="size-2.5 shrink-0 rounded-full" style={{ background: slice.color }} /><span className="line-clamp-2 min-w-0 flex-1 font-medium leading-4 text-ink" title={slice.label}>{slice.label}</span><span className="font-bold text-ink">{slice.value ? `${slice.estimated ? "~" : ""}$${slice.value}` : "Free"}</span></li>)}</ul>
    </div>
    <div className="mt-4 h-2 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${remaining >= 0 ? "bg-pine" : "bg-rust"}`} style={{ width: `${Math.min(100, request.totalBudgetUsd ? (total / request.totalBudgetUsd) * 100 : 100)}%` }} /></div>
    <p className={`mt-2 flex items-center gap-1.5 text-[13px] font-semibold ${remaining >= 0 ? "text-pine" : "text-rust"}`}>{remaining >= 0 ? <CircleCheck className="size-4" /> : <CircleAlert className="size-4" />}{remaining >= 0 ? `$${remaining} left — you're under budget` : `$${-remaining} over the trip budget`}</p>
    <p className="mt-1 text-[11px] text-muted-ink">Estimate range ${itinerary.estimatedTotalSpendUsd.min}–${itinerary.estimatedTotalSpendUsd.max}; planning allowances, not live prices.</p>
  </div>;

  const sourcesList = <div ref={sourcesRef} className="scroll-mt-4">
    <div className="flex items-center justify-between pb-2.5 pt-1"><h2 className="text-[19px] font-extrabold tracking-[-0.01em] text-ink">Sources</h2><span className="text-[13px] font-semibold text-muted-ink">{itinerary.stops.length} linked</span></div>
    <div className="overflow-hidden rounded-[20px] bg-white shadow-card">{itinerary.stops.map((stop, index) => { const place = stop.place; return <div key={stop.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-0">
      <button type="button" onClick={() => onOpenDetail(index)} aria-label={`Open ${stop.name}`} className="relative size-[52px] shrink-0 overflow-hidden rounded-xl bg-sage"><PlaceImage place={place} width={160} className="absolute inset-0" /></button>
      <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-bold text-ink">{stop.sourceName}</strong><span className="mt-0.5 block truncate text-xs font-medium text-muted-ink">{hostname(stop.sourceUrl)} · Stop {index + 1}{stop.dataOrigin === "realtime_geoapify" ? " · live listing" : ""}</span></span>
      <a href={stop.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open source for ${stop.name}`} className="grid size-9 place-items-center rounded-full text-pine hover:bg-sel"><ExternalLink className="size-[17px]" /></a>
    </div>; })}</div>
  </div>;

  return <div className="space-y-3 pb-28">
    {header}
    <div className="space-y-3 px-5">
      {focus === "sources" ? <>{sourcesList}{budgetCard}</> : <>{budgetCard}{sourcesList}</>}
      <div className="flex gap-2.5 rounded-2xl bg-sel px-3.5 py-3 text-xs font-medium leading-[17px] text-pine"><Info className="mt-px size-4 shrink-0" />Wayly links published sources. Hours and prices can change — check before you go.</div>
    </div>
  </div>;
}

const LOADING_STEPS = [
  { label: "Reading your request", detail: "Places, areas and #tags you wrote" },
  { label: "Checking date, budget and pace", detail: "Only places your group can afford" },
  { label: "Shortlisting places that fit", detail: "Up to 8 source-linked candidates" },
  { label: "AI picks the best route", detail: "Then code re-checks every stop" },
  { label: "Routing the streets", detail: "Walking, transit and timing between stops" },
] as const;
/** When each step ticks (ms). The last step keeps spinning until the plan arrives. */
const LOADING_TICKS = [700, 1600, 2700, 5200];

function LoadingScreen({ request, onCancel }: { request: PlanRequest; onCancel: () => void }) {
  const [done, setDone] = useState(0);
  useEffect(() => {
    const timers = LOADING_TICKS.map((ms, index) => window.setTimeout(() => setDone(index + 1), ms));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  const tags = parseHashtags(request.intentText); // only tags the user typed, not saved defaults
  const progress = Math.min(96, 8 + done * 22);
  return <div className="flex min-h-dvh flex-col bg-[#fcfaf5]"><AppHeader onBack={onCancel} title="Planning" />
    <div className="flex flex-1 flex-col px-6 pb-8 pt-4">
      <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-sel text-pine"><Compass className="size-8 animate-[spin_6s_linear_infinite]" /></div>
      <h1 className="mt-5 text-center text-xl font-extrabold text-ink">Building your NYC day</h1>
      <div className="mx-auto mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-pine transition-[width] duration-700 ease-out" style={{ width: `${progress}%` }} /></div>
      <ol className="mt-6 space-y-2.5" aria-live="polite">
        {LOADING_STEPS.map((step, index) => {
          if (index > done) return null;
          const complete = index < done;
          return <li key={step.label} className={`wayly-step-in flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 ${complete ? "border-line" : "border-pine/40 shadow-card"}`}>
            <span className={`grid size-7 shrink-0 place-items-center rounded-full ${complete ? "bg-pine text-white" : "bg-sel text-pine"}`}>{complete ? <Check key="done" className="wayly-check-pop size-4" strokeWidth={3} /> : <Loader2 className="size-4 animate-spin" />}</span>
            <span className="min-w-0 flex-1"><span className={`block text-sm font-bold ${complete ? "text-ink" : "text-pine"}`}>{step.label}</span><span className="block text-[11px] text-muted-ink">{index === 0 && tags.length ? tags.map((tag) => `#${categoryLabel[tag]?.toLowerCase() ?? tag}`).join("  ") : step.detail}</span></span>
          </li>;
        })}
      </ol>
      <div className="mt-6 rounded-2xl bg-white p-4 text-xs text-muted-ink shadow-card"><p className="font-semibold text-ink">This trip</p><p className="mt-1.5">{formatDate(request.date)} · {hoursFor(request)} hours · {request.partySize} {request.partySize === 1 ? "traveler" : "travelers"} · ${request.totalBudgetUsd} total budget</p>{request.intentText.trim() && <p className="mt-1.5 line-clamp-2 text-ink">“{request.intentText.trim()}”</p>}</div>
    </div>
    <div className="px-5 pb-[max(24px,env(safe-area-inset-bottom))]"><button type="button" onClick={onCancel} className="min-h-11 w-full text-sm text-muted-ink underline-offset-4 hover:underline">Cancel and keep inputs</button></div>
  </div>;
}

function AdjustmentScreen({ itinerary, request, action, targetStopId, candidateId, budget, onBack, onAction, onTarget, onCandidate, onBudget, onSubmit }: { itinerary: Itinerary; request: PlanRequest; action: AdjustmentAction; targetStopId: string | null; candidateId: string | null; budget: number; onBack: () => void; onAction: (value: AdjustmentAction) => void; onTarget: (value: string) => void; onCandidate: (value: string) => void; onBudget: (value: number) => void; onSubmit: () => void }) {
  const target = itinerary.stops.find((stop) => stop.id === targetStopId); const candidates = suggestReplacements(itinerary, target?.id ?? null, request);
  return <div className="min-h-dvh bg-soft"><AppHeader onBack={onBack} title="Adjust itinerary" /><section className="px-5 pb-32"><h1 className="text-[22px] font-bold tracking-[-0.4px] text-[#0d2940]">Make this plan fit better</h1><p className="mt-1 text-xs leading-5 text-[#8a9aa3]">Only change what is necessary; Wayly will preserve other stops when possible.</p><div className="mt-5 grid grid-cols-3 rounded-xl bg-[#edf3ed] p-1">{(["replace", "shorten", "budget"] as const).map((item) => <button key={item} type="button" onClick={() => onAction(item)} className={`min-h-9 rounded-lg text-xs font-semibold ${action === item ? "bg-white text-[#185e56] shadow-sm" : "text-[#58707c]"}`}>{item === "replace" ? "Replace" : item === "shorten" ? "Shorten" : "Budget"}</button>)}</div>
    {action === "replace" && <div className="mt-5"><p className="text-xs font-semibold text-[#3e5563]">Which stop should change?</p><select aria-label="Select a stop to replace" value={target?.id} onChange={(event) => onTarget(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#dde3dc] bg-white px-3 text-sm outline-none focus:border-[#185e56]">{itinerary.stops.map((stop) => <option key={stop.id} value={stop.id}>{stop.name}</option>)}</select><p className="mt-4 text-xs font-semibold text-[#3e5563]">Published candidates to consider</p><div className="mt-2 space-y-2">{candidates.map((candidate) => <button key={candidate.id} type="button" onClick={() => onCandidate(candidate.id)} className={`flex w-full overflow-hidden rounded-2xl border text-left ${candidateId === candidate.id ? "border-[#185e56] bg-[#e3f0ea]" : "border-[#dde3dc] bg-white"}`}><PlaceImage place={candidate} width={240} className="relative h-[82px] w-24 shrink-0" /><span className="flex min-w-0 flex-1 items-center justify-between gap-2 p-3"><span><strong className="block text-sm text-[#0d2940]">{candidate.name}</strong><small className="mt-1 block text-[11px] leading-4 text-[#58707c]">Published source · planning allowance ${candidate.planningAllowanceUsd * request.partySize}</small></span>{candidateId === candidate.id && <Check className="size-4 shrink-0 text-[#185e56]" />}</span></button>)}</div><p className="mt-2 text-[10px] leading-4 text-[#8a9aa3]">Candidate cards are a preview; the planner validates the new route against the same published catalog.</p></div>}
    {action === "shorten" && <div className="mt-5 rounded-2xl bg-[#f5f0e6] p-4 text-sm text-[#3e5563]"><strong className="block">Shorten the day</strong><p className="mt-2 text-xs leading-5">Wayly will reduce available time by two hours and choose fewer stops if needed.</p></div>}
    {action === "budget" && <div className="mt-5"><p className="text-xs font-semibold text-[#3e5563]">New total budget</p><div className="mt-2 flex h-14 items-center rounded-2xl border border-[#c9d7cc] bg-[#ffffff] px-4"><WalletCards className="mr-2 size-5 text-[#185e56]" /><span className="mr-1 text-sm">$</span><input aria-label="New total budget in US dollars" type="number" min="0" max="10000" value={budget} onChange={(event) => onBudget(clampNumber(event.target.value, 0, 10_000, budget))} className="w-full bg-transparent text-lg font-semibold outline-none" /></div><p className="mt-2 text-xs leading-5 text-[#8a9aa3]">Previous budget ${request.totalBudgetUsd}. Place allowances and static transport estimates will be checked against the trip total.</p></div>}
    <div className="mt-6 rounded-2xl border border-[#dde3dc] p-4"><p className="text-xs font-semibold text-[#3e5563]">Change preview</p><p className="mt-2 text-sm text-[#0d2940]">{action === "replace" ? `Try replacing ${target?.name ?? "the selected stop"}` : action === "shorten" ? "Reduce stops and shorten the overall pace" : `Total budget $${request.totalBudgetUsd} → $${budget}`}</p><p className="mt-1 text-[11px] leading-5 text-[#8a9aa3]">After submission, Wayly shows the resulting route, budget, and transit changes.</p></div>
  </section><div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#edf3ed] bg-white/95 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-2 backdrop-blur"><div className="mx-auto max-w-[350px]"><Button size="lg" onClick={onSubmit} className="h-12 w-full rounded-2xl bg-[#185e56] hover:bg-[#124a45]"><RefreshCw />Update itinerary</Button></div></div></div>;
}

function ConstraintScreen({ message, request, onEdit, onRelax }: { message: string; request: PlanRequest; onEdit: () => void; onRelax: () => void }) { return <div className="flex min-h-dvh flex-col bg-[#fffdf8]"><AppHeader onBack={onEdit} title="Adjust constraints" /><div className="flex flex-1 flex-col justify-center px-6 pb-20"><div className="grid size-14 place-items-center rounded-2xl bg-[#fff0d9] text-[#b45309]"><AlertTriangle className="size-7" /></div><h1 className="mt-5 text-xl font-bold text-[#0d2940]">These constraints conflict</h1><p className="mt-2 text-sm leading-6 text-[#58707c]">{message}</p><div className="mt-6 rounded-2xl bg-white p-4"><p className="text-xs font-semibold text-[#3e5563]">Practical next steps</p><ul className="mt-3 space-y-3 text-xs leading-5 text-[#58707c]"><li>· Increase the total budget or reduce the party size</li><li>· Reduce the number of places within the available time</li><li>· Relax preferences where current source evidence is limited</li></ul><p className="mt-3 text-[10px] text-[#8a9aa3]">Current: {hoursFor(request)} hours · ${request.totalBudgetUsd} total budget</p></div></div><div className="space-y-2 px-5 pb-[max(24px,env(safe-area-inset-bottom))]"><Button size="lg" onClick={onRelax} className="h-12 w-full rounded-2xl bg-[#185e56] hover:bg-[#124a45]">Apply a relaxed suggestion</Button><Button variant="ghost" onClick={onEdit} className="h-11 w-full rounded-xl text-[#58707c]">Edit inputs</Button></div></div>; }
function ErrorScreen({ message, onRetry, onEdit }: { message: string; onRetry: () => void; onEdit: () => void }) { return <div className="flex min-h-dvh flex-col bg-[#fffdfd]"><AppHeader onBack={onEdit} title="Something went wrong" /><div className="flex flex-1 flex-col justify-center px-6 pb-20"><div className="grid size-14 place-items-center rounded-2xl bg-[#fff0f0] text-[#b42318]"><CircleAlert className="size-7" /></div><h1 className="mt-5 text-xl font-bold text-[#0d2940]">Planning is unavailable</h1><p className="mt-2 text-sm leading-6 text-[#58707c]">{message}</p></div><div className="space-y-2 px-5 pb-[max(24px,env(safe-area-inset-bottom))]"><Button size="lg" onClick={onRetry} className="h-12 w-full rounded-2xl bg-[#185e56] hover:bg-[#124a45]">Try again</Button><Button variant="ghost" onClick={onEdit} className="h-11 w-full rounded-xl text-[#58707c]">Edit inputs</Button></div></div>; }
function ProfileScreen({ session, avatar, request, savedPlans, favoriteCount, onOpenFavorites, onLoadPlans, onBack, onOpenPlan, onDeletePlan, onSaveDefaults, onSaveProfile, onSignOut }: { session: SessionState; avatar: string | null; request: PlanRequest; savedPlans: SavedPlan[] | null; favoriteCount: number; onOpenFavorites: () => void; onLoadPlans: () => void; onBack: () => void; onOpenPlan: (plan: SavedPlan) => void; onDeletePlan: (id: string) => void; onSaveDefaults: (value: SavedPreferences) => Promise<boolean>; onSaveProfile: (name: string, emoji: string | null) => Promise<boolean>; onSignOut: () => void }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const authed = session.status === "authed";
  const needPlans = authed && savedPlans === null;
  useEffect(() => { if (needPlans) onLoadPlans(); }, [needPlans, onLoadPlans]);
  if (session.status !== "authed") return <><AppHeader onBack={onBack} title="Profile" /><section className="px-5 pb-32 pt-3">
    <div className="relative overflow-hidden rounded-3xl">
      <img src={HERO_IMAGE} alt="" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/60 to-ink/20" />
      <div className="relative p-5 pt-24 text-white">
        <h1 className="text-[22px] font-extrabold leading-7 tracking-[-0.01em]">Keep every NYC day you plan</h1>
        <p className="mt-1.5 text-xs leading-5 text-white/80">Sign in to save routes, remember your budget and interests, and plan with AI.</p>
      </div>
    </div>
    {session.status === "disabled"
      ? <div className="mt-4 flex gap-2 rounded-2xl border border-[#f2deb7] bg-[#fffaf0] p-3.5 text-xs leading-5 text-[#8a5a16]"><CircleAlert className="mt-0.5 size-4 shrink-0" />Accounts aren&apos;t configured for this preview. Add the Supabase URL and publishable key to .env.local to turn them on.</div>
      : session.status === "loading" ? <div className="mt-6 grid place-items-center text-muted-ink"><Loader2 className="size-5 animate-spin" /></div>
      : <div className="mt-4 grid gap-2.5"><Link href="/login?next=%2F" className="flex h-14 items-center justify-center gap-2 rounded-[18px] bg-pine text-base font-bold text-white shadow-cta">Sign in</Link><Link href="/register?next=%2F" className="flex h-12 items-center justify-center rounded-2xl border border-line bg-white text-sm font-bold text-pine">Create an account</Link></div>}
    <ul className="mt-5 space-y-2">{[{ icon: Bookmark, text: "Saved routes, reopen any time" }, { icon: WalletCards, text: "Your default budget and party size" }, { icon: Sparkles, text: "AI-picked routes from the checked shortlist" }].map(({ icon: Icon, text }) => <li key={text} className="flex items-center gap-3 rounded-2xl border border-line bg-white px-3.5 py-3 text-[13px] font-semibold text-ink"><span className="grid size-8 place-items-center rounded-[10px] bg-sel text-pine"><Icon className="size-4" /></span>{text}</li>)}</ul>
  </section></>;

  const { user } = session;
  const display = user.displayName || user.email?.split("@")[0] || "Traveler";
  return <><AppHeader onBack={onBack} title="Profile" /><section className="space-y-4 px-5 pb-32 pt-3">
    <div className="flex items-center gap-3.5 rounded-3xl bg-white p-4 shadow-card">
      <span className="grid size-14 shrink-0 place-items-center rounded-full bg-pine text-xl font-extrabold text-white">{avatar ?? display.charAt(0).toUpperCase()}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[17px] font-extrabold text-ink">{display}</p>
        <p className="mt-0.5 truncate text-xs font-medium text-muted-ink">{user.email}</p>
      </div>
      <button type="button" onClick={() => setEditorOpen(true)} aria-label="Edit profile" className="grid size-9 place-items-center rounded-full bg-sel text-pine"><Pencil className="size-4" /></button>
    </div>

    <button type="button" onClick={onOpenFavorites} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3.5 text-left shadow-card"><span className="grid size-10 place-items-center rounded-xl bg-sel text-pine"><Bookmark className="size-5" /></span><span className="min-w-0 flex-1"><strong className="block text-sm font-bold text-ink">Favorite places</strong><span className="mt-0.5 block text-xs text-muted-ink">{favoriteCount} saved on this device</span></span><ChevronRight className="size-4 text-muted-ink" /></button>

    <SectionCard className="p-3.5">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink"><WalletCards className="size-4 text-pine" />Default trip settings</p>
      <p className="mt-1.5 text-xs leading-5 text-muted-ink">${request.totalBudgetUsd} total · {request.partySize} {request.partySize === 1 ? "traveler" : "travelers"} · {effectiveInterests(request.intentText, request.interests).map((item) => categoryLabel[item] ?? item).join(", ")} · {preferenceText(request, "walking")} pace</p>
      <Button variant="outline" onClick={() => setEditorOpen(true)} className="mt-2.5 h-10 w-full rounded-xl border-line bg-sel text-pine">Edit profile and defaults</Button>
    </SectionCard>

    <div>
      <div className="flex items-center justify-between pb-2"><h2 className="text-[17px] font-extrabold text-ink">Saved plans</h2>{savedPlans && <span className="text-xs font-semibold text-muted-ink">{savedPlans.length}</span>}</div>
      {savedPlans === null ? <div className="grid h-20 place-items-center text-muted-ink"><Loader2 className="size-5 animate-spin" /></div>
        : savedPlans.length === 0 ? <div className="rounded-2xl border border-dashed border-line bg-white p-5 text-center"><Bookmark className="mx-auto size-6 text-pine" /><p className="mt-2 text-sm font-bold text-ink">No saved plans yet</p><p className="mt-1 text-xs text-muted-ink">Tap “Save plan” on any itinerary to keep it here.</p></div>
        : <div className="space-y-2">{savedPlans.map((plan) => { const first = plan.itinerary.stops[0]?.place; return <div key={plan.id} className="flex items-center gap-3 rounded-[20px] border border-line bg-white p-2.5 shadow-card">
          <button type="button" onClick={() => onOpenPlan(plan)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            {first ? <PlaceImage place={first} width={200} className="relative size-[60px] shrink-0 rounded-[14px]" /> : <span className="size-[60px] shrink-0 rounded-[14px] bg-sage" />}
            <span className="min-w-0 flex-1"><strong className="line-clamp-2 text-sm font-bold leading-5 text-ink">{plan.title}</strong><span className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-ink">{plan.planMode === "ai_structured" && <Sparkles className="size-3 text-pine" />}{plan.itinerary.stops.length} stops · saved {formatShortDate(plan.createdAt.slice(0, 10))}</span></span>
          </button>
          <button type="button" aria-label={`Delete ${plan.title}`} onClick={() => onDeletePlan(plan.id)} className="grid size-9 shrink-0 place-items-center rounded-full text-muted-ink hover:bg-rust/10 hover:text-rust"><Trash2 className="size-4" /></button>
        </div>; })}</div>}
    </div>

    <button type="button" onClick={replayOnboarding} className="w-full py-2 text-center text-xs font-semibold text-pine">View app introduction</button>
    <Button variant="outline" onClick={onSignOut} className="h-12 w-full rounded-2xl border-line bg-white text-rust"><LogOut />Sign out</Button>
  </section>{editorOpen && <ProfileEditor session={session} avatar={avatar} request={request} onClose={() => setEditorOpen(false)} onSaveDefaults={onSaveDefaults} onSaveProfile={onSaveProfile} />}</>;
}

const avatarChoices = ["🧭", "🗽", "🌆", "🎨", "🌿", "🍽️"] as const;
function ProfileEditor({ session, avatar, request, onClose, onSaveDefaults, onSaveProfile }: { session: Extract<SessionState, { status: "authed" }>; avatar: string | null; request: PlanRequest; onClose: () => void; onSaveDefaults: (value: SavedPreferences) => Promise<boolean>; onSaveProfile: (name: string, emoji: string | null) => Promise<boolean> }) {
  const [name, setName] = useState(session.user.displayName || session.user.email?.split("@")[0] || "");
  const [emoji, setEmoji] = useState<string | null>(avatarChoices.includes(avatar as typeof avatarChoices[number]) ? avatar : null);
  const [draft, setDraft] = useState<SavedPreferences>({ totalBudgetUsd: request.totalBudgetUsd, partySize: request.partySize, interests: request.interests, transportPreference: request.transportPreference, walkingPreference: request.walkingPreference, dining: request.dining });
  const [saving, setSaving] = useState<"profile" | "defaults" | null>(null);
  return <Sheet open onOpenChange={(open) => !open && onClose()}><SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-[390px] overflow-y-auto rounded-t-[28px] bg-soft"><SheetHeader className="px-5 pt-6"><SheetTitle>Edit profile</SheetTitle><SheetDescription>Choose how you appear and save your usual trip settings.</SheetDescription></SheetHeader><div className="space-y-5 px-5 pb-8">
    <div className="rounded-2xl border border-line bg-white p-4"><label className="block text-xs font-bold text-ink">Display name<input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-line px-3 text-sm font-medium outline-none focus:border-pine" /></label><p className="mt-3 text-xs font-bold text-ink">Choose an avatar</p><div className="mt-2 flex flex-wrap gap-2">{avatarChoices.map((choice) => <button key={choice} type="button" onClick={() => setEmoji(choice)} aria-label={`Avatar ${choice}`} aria-pressed={emoji === choice} className={`grid size-11 place-items-center rounded-full border text-xl ${emoji === choice ? "border-pine bg-sel" : "border-line bg-white"}`}>{choice}</button>)}<button type="button" onClick={() => setEmoji(null)} aria-label="Use name initial" aria-pressed={emoji === null} className={`grid size-11 place-items-center rounded-full border text-xs font-bold ${emoji === null ? "border-pine bg-sel text-pine" : "border-line text-muted-ink"}`}>A</button></div><p className="mt-3 text-[11px] text-muted-ink">Sign-in email: {session.user.email}</p><Button disabled={saving !== null || !name.trim()} onClick={async () => { setSaving("profile"); try { await onSaveProfile(name.trim(), emoji); } finally { setSaving(null); } }} className="mt-4 h-10 w-full rounded-xl bg-pine text-white">{saving === "profile" ? "Saving…" : "Save profile"}</Button></div>
    <div className="rounded-2xl border border-line bg-white p-4"><h3 className="text-sm font-extrabold text-ink">Default trip settings</h3><div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-bold text-ink">Budget (USD)<input type="number" min={0} max={10000} value={draft.totalBudgetUsd} onChange={(event) => setDraft((current) => ({ ...current, totalBudgetUsd: clampNumber(event.target.value, 0, 10000, current.totalBudgetUsd) }))} className="mt-2 h-11 w-full rounded-xl border border-line px-3 text-sm outline-none focus:border-pine" /></label><label className="text-xs font-bold text-ink">Travelers<input type="number" min={1} max={8} value={draft.partySize} onChange={(event) => setDraft((current) => ({ ...current, partySize: clampNumber(event.target.value, 1, 8, current.partySize) }))} className="mt-2 h-11 w-full rounded-xl border border-line px-3 text-sm outline-none focus:border-pine" /></label></div><p className="mt-4 text-xs font-bold text-ink">Interests</p><div className="mt-2 flex flex-wrap gap-2">{shortcuts.map(({ category, label }) => { const selected = draft.interests.includes(category); return <button key={category} type="button" aria-pressed={selected} onClick={() => setDraft((current) => ({ ...current, interests: selected ? current.interests.filter((item) => item !== category) : [...current.interests, category] }))} className={`rounded-full border px-3 py-2 text-xs font-semibold ${selected ? "border-pine bg-sel text-pine" : "border-line text-muted-ink"}`}>{label}</button>; })}</div>{([{ key: "transportPreference", label: "Getting around", options: preferences.transport.options }, { key: "walkingPreference", label: "Walking pace", options: preferences.walking.options }, { key: "dining", label: "Dining", options: preferences.dining.options }] as const).map(({ key, label, options }) => <label key={key} className="mt-4 block text-xs font-bold text-ink">{label}<select value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} className="mt-2 h-11 w-full rounded-xl border border-line bg-white px-3 text-sm font-medium outline-none focus:border-pine">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}<Button disabled={saving !== null || draft.interests.length === 0} onClick={async () => { setSaving("defaults"); try { await onSaveDefaults(draft); } finally { setSaving(null); } }} className="mt-5 h-10 w-full rounded-xl bg-pine text-white">{saving === "defaults" ? "Saving…" : "Save trip defaults"}</Button>{draft.interests.length === 0 && <p className="mt-2 text-xs text-rust">Choose at least one interest.</p>}</div>
  </div></SheetContent></Sheet>;
}
function ScoreGroup({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <div><p className="text-xs font-semibold text-[#3e5563]">{label}</p><div className="mt-2 flex gap-1">{[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" onClick={() => onChange(score)} aria-label={`${label}: ${score} out of 5`} className={`grid size-9 place-items-center rounded-lg ${score <= value ? "text-[#e4a72d]" : "text-[#d9dde3]"}`}><Star className="size-6" fill="currentColor" /></button>)}</div></div>; }

function OverlaySheets({ sheet, setSheet, request, setRequest, preferenceKey, selectedSegment, itinerary, selectedTransport, setSelectedTransport, handoffProvider, setHandoffProvider, feedbackDraft, setFeedbackDraft, feedbackSubmitting, submitFeedback, copyHandoff, authReason, authDisabled }: { sheet: SheetName; setSheet: (value: SheetName) => void; request: PlanRequest; setRequest: Dispatch<SetStateAction<PlanRequest>>; preferenceKey: PreferenceKey; selectedSegment: TransportSegment | null; itinerary: Itinerary | null; selectedTransport: Record<string, TransportMode>; setSelectedTransport: Dispatch<SetStateAction<Record<string, TransportMode>>>; handoffProvider: string | null; setHandoffProvider: (value: string | null) => void; feedbackDraft: { satisfaction: number; trust: number; issueType: string; note: string }; setFeedbackDraft: Dispatch<SetStateAction<{ satisfaction: number; trust: number; issueType: string; note: string }>>; feedbackSubmitting: boolean; submitFeedback: () => void; copyHandoff: () => Promise<void>; authReason: AuthReason; authDisabled: boolean }) {
  const activeTransport = selectedSegment ? selectedTransport[selectedSegment.toStopId] ?? selectedSegment.recommendedMode : "walk";
  const from = itinerary?.stops.find((stop) => stop.id === selectedSegment?.fromStopId)?.name ?? "Start"; const to = itinerary?.stops.find((stop) => stop.id === selectedSegment?.toStopId)?.name ?? "Destination";
  const preference = preferences[preferenceKey]; const currentValue = preferenceKey === "accessibility" ? String(request.accessibility) : String(request[preferenceKey === "transport" ? "transportPreference" : preferenceKey === "walking" ? "walkingPreference" : "dining"]);
  return <>
    <Sheet open={sheet === "city"} onOpenChange={(open) => !open && setSheet(null)}><SheetContent side="bottom" className="max-h-[80dvh] rounded-t-[28px] bg-soft"><SheetHeader className="px-5 pt-7"><SheetTitle>Choose city</SheetTitle><SheetDescription>Only New York City has a published catalog in this preview.</SheetDescription></SheetHeader><div className="px-5 pb-5"><button type="button" onClick={() => setSheet(null)} className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-[#185e56] bg-[#e3f0ea] px-4 text-left"><span><strong className="block text-sm text-[#185e56]">New York City</strong><small className="mt-1 block text-[11px] text-[#4a6b63]">Supported · published source catalog</small></span><Check className="size-5 text-[#185e56]" /></button>{["Boston", "Philadelphia", "Chicago"].map((city) => <div key={city} className="mt-2 flex min-h-14 items-center justify-between rounded-2xl bg-[#f5f0e6] px-4 text-sm text-[#8a9aa3]"><span>{city}</span><small>Coming later</small></div>)}</div></SheetContent></Sheet>
    <Sheet open={sheet === "preferences"} onOpenChange={(open) => !open && setSheet(null)}><SheetContent side="bottom" className="rounded-t-[28px] bg-soft"><SheetHeader className="px-5 pt-7"><SheetTitle>{preference.title}</SheetTitle><SheetDescription>Your choice is used as a planning constraint.</SheetDescription></SheetHeader><div className="space-y-2 px-5 pb-5">{preference.options.map((option) => <button key={option.value} type="button" onClick={() => { setRequest((current) => preferenceKey === "accessibility" ? { ...current, accessibility: option.value === "true" } : preferenceKey === "transport" ? { ...current, transportPreference: option.value as PlanRequest["transportPreference"] } : preferenceKey === "walking" ? { ...current, walkingPreference: option.value as PlanRequest["walkingPreference"] } : { ...current, dining: option.value as PlanRequest["dining"] }); setSheet(null); }} className={`flex min-h-12 w-full items-center justify-between rounded-xl border px-3.5 text-left ${currentValue === option.value ? "border-[#185e56] bg-[#e3f0ea] text-[#185e56]" : "border-[#dde3dc] text-[#3e5563]"}`}><span><strong className="block text-sm font-medium">{option.label}</strong>{option.note && <small className="mt-1 block max-w-[260px] text-[10px] leading-4 text-[#8a9aa3]">{option.note}</small>}</span>{currentValue === option.value && <Check className="size-4" />}</button>)}</div></SheetContent></Sheet>
    <Sheet open={sheet === "transport"} onOpenChange={(open) => !open && setSheet(null)}><SheetContent side="bottom" className="max-h-[86dvh] rounded-t-[28px] bg-soft"><SheetHeader className="px-5 pt-7"><SheetTitle>Choose a travel mode</SheetTitle><SheetDescription>{from} → {to} · planning estimates only</SheetDescription></SheetHeader>{selectedSegment && <div className="space-y-2 px-5 pb-6">{(["walk", "public_transit", "taxi"] as const).map((item) => { const chosen = activeTransport === item; const amount = transportEstimate(item, selectedSegment, request.partySize); return <button key={item} type="button" onClick={() => setSelectedTransport((current) => ({ ...current, [selectedSegment.toStopId]: item }))} className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left ${chosen ? "border-[#185e56] bg-[#e3f0ea]" : "border-[#dde3dc]"}`}><span className="grid size-10 place-items-center rounded-xl bg-white text-[#185e56]"><TransportIcon mode={item} className="size-5" /></span><span className="flex-1"><strong className="block text-sm text-[#0d2940]">{transportLabel(item)}</strong><small className="mt-1 block text-[11px] text-[#58707c]">{amount}</small></span>{chosen && <Check className="size-4 text-[#185e56]" />}</button>; })}<Button size="lg" onClick={() => { setHandoffProvider(null); setSheet("handoff"); }} className="mt-3 h-12 w-full rounded-2xl bg-[#185e56] hover:bg-[#124a45]"><Navigation />Continue in maps</Button><p className="text-center text-[10px] leading-4 text-[#8a9aa3]">A map provider owns live routes, fares, and execution; Wayly does not initiate navigation, rides, or payment.</p></div>}</SheetContent></Sheet>
    <Sheet open={sheet === "handoff"} onOpenChange={(open) => !open && setSheet(null)}><SheetContent side="bottom" className="rounded-t-[28px] bg-soft"><SheetHeader className="px-5 pt-7"><SheetTitle>Continue in maps</SheetTitle><SheetDescription>{from} → {to}</SheetDescription></SheetHeader><div className="px-5 pb-6">{handoffProvider ? <div><div className="rounded-2xl bg-[#edf3ed] p-4"><p className="text-sm font-semibold text-[#185e56]">{handoffProvider}</p><p className="mt-2 text-xs leading-5 text-[#4a6b63]">Wayly would hand off the endpoints and travel mode. The map provider owns live routing, price, and execution.</p></div><p className="mt-4 text-xs leading-5 text-[#58707c]">This local preview does not open a deep link. Copy the endpoints and search in your preferred map.</p><Button size="lg" onClick={() => void copyHandoff()} className="mt-4 h-12 w-full rounded-2xl bg-[#185e56] hover:bg-[#124a45]"><Copy />Copy route endpoints</Button></div> : <div className="space-y-2">{["Google Maps", "Apple Maps", "Citymapper"].map((provider) => <button key={provider} type="button" onClick={() => setHandoffProvider(provider)} className="flex min-h-13 w-full items-center justify-between rounded-2xl border border-[#dde3dc] px-4 text-left"><span><strong className="block text-sm text-[#0d2940]">{provider}</strong><small className="mt-1 block text-[11px] text-[#8a9aa3]">Preview only · no external launch</small></span><ChevronRight className="size-4 text-[#8a9aa3]" /></button>)}</div>}</div></SheetContent></Sheet>
    <Sheet open={sheet === "feedback"} onOpenChange={(open) => !open && setSheet(null)}><SheetContent side="bottom" className="max-h-[92dvh] rounded-t-[28px] bg-soft"><SheetHeader className="px-5 pt-7"><SheetTitle>Was this itinerary helpful?</SheetTitle><SheetDescription>Feedback is associated with this preview and its data version.</SheetDescription></SheetHeader><div className="space-y-5 px-5 pb-6"><ScoreGroup label="Overall satisfaction" value={feedbackDraft.satisfaction} onChange={(value) => setFeedbackDraft((current) => ({ ...current, satisfaction: value }))} /><ScoreGroup label="How much do you trust this recommendation?" value={feedbackDraft.trust} onChange={(value) => setFeedbackDraft((current) => ({ ...current, trust: value }))} /><div className="border-t border-[#edf3ed] pt-4"><p className="text-xs font-semibold text-[#3e5563]">If something was wrong, what was it?</p><div className="mt-2 flex flex-wrap gap-2">{[{ value: "fit", label: "Not my interests" }, { value: "route", label: "Route does not fit" }, { value: "budget", label: "Budget estimate" }, { value: "walking", label: "Too much walking" }, { value: "data", label: "Place information" }, { value: "other", label: "Other" }].map((item) => <button key={item.value} type="button" onClick={() => setFeedbackDraft((current) => ({ ...current, issueType: current.issueType === item.value ? "" : item.value }))} className={`min-h-8 rounded-full border px-3 text-[11px] ${feedbackDraft.issueType === item.value ? "border-[#185e56] bg-[#e3f0ea] text-[#185e56]" : "border-[#dde3dc] text-[#3e5563]"}`}>{item.label}</button>)}</div></div><label className="block border-t border-[#edf3ed] pt-4"><span className="text-xs font-semibold text-[#3e5563]">Anything else to share?</span><textarea aria-label="Feedback details" value={feedbackDraft.note} maxLength={500} onChange={(event) => setFeedbackDraft((current) => ({ ...current, note: event.target.value }))} placeholder="For example: I would like a shorter walk or more local food options." className="mt-2 h-20 w-full resize-none rounded-xl border border-[#dde3dc] p-3 text-xs leading-5 outline-none placeholder:text-[#a7b3b9] focus:border-[#185e56]" /></label><Button size="lg" disabled={feedbackSubmitting} onClick={submitFeedback} className="h-12 w-full rounded-2xl bg-[#185e56] hover:bg-[#124a45]">{feedbackSubmitting ? <Loader2 className="animate-spin" /> : <Send />}{feedbackSubmitting ? "Submitting…" : "Submit feedback"}</Button><SheetClose render={<button type="button" className="min-h-9 w-full text-xs text-[#8a9aa3]">Skip for now</button>} /></div></SheetContent></Sheet>
    <Sheet open={sheet === "auth"} onOpenChange={(open) => !open && setSheet(null)}><SheetContent side="bottom" className="rounded-t-[28px] bg-soft"><SheetHeader className="px-5 pt-7"><SheetTitle>{authDisabled ? "Accounts are off in this preview" : authReason === "plan" ? "Sign in to create your plan" : "Sign in to save this plan"}</SheetTitle><SheetDescription>{authDisabled ? "Add the Supabase URL and publishable key to .env.local to turn on accounts." : authReason === "plan" ? "Your inputs are kept — we'll build the route right after you sign in." : "We'll keep this route and save it to your profile right after you sign in."}</SheetDescription></SheetHeader><div className="px-5 pb-6">{authDisabled
      ? <SheetClose render={<button type="button" aria-label="Close" className="h-12 w-full rounded-2xl bg-pine text-sm font-bold text-white" />}>Got it</SheetClose>
      : <div className="grid gap-2.5"><div className="flex items-center gap-3 rounded-2xl bg-sel p-3.5"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-pine">{authReason === "plan" ? <Sparkles className="size-5" /> : <Bookmark className="size-5" />}</span><p className="text-xs leading-5 text-[#4a6b63]">{authReason === "plan" ? "Plans use an AI pick from a code-checked shortlist, so each one is tied to an account." : "Saved plans live in your profile and work on any device you sign in on."}</p></div><Link href="/login?next=%2F" className="flex h-14 items-center justify-center rounded-[18px] bg-pine text-base font-bold text-white shadow-cta">Sign in</Link><Link href="/register?next=%2F" className="flex h-12 items-center justify-center rounded-2xl border border-line bg-white text-sm font-bold text-pine">Create an account</Link><SheetClose render={<button type="button" aria-label="Not now" className="min-h-10 w-full text-sm text-muted-ink" />}>Not now</SheetClose></div>}</div></SheetContent></Sheet>
  </>;
}
