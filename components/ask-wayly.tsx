"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Clock3, Loader2, RefreshCw, Sparkles, WalletCards, Wand2 } from "lucide-react";
import { HashtagInput } from "@/components/hashtag-input";
import { tokenizeHashtags } from "@/lib/nyc-hashtags";
import type { AskAction } from "@/lib/nyc-ask";
import { authFetch } from "@/lib/supabase-browser";
import type { Itinerary, PlanRequest } from "@/lib/nyc-types";

export type AskMessage = { id: string; role: "user" | "assistant"; text: string; action?: AskAction; applied?: boolean; source?: "model" | "rules"; error?: boolean };

const withRoute = ["Swap stop 2 for #food", "Make it shorter", "Make it cheaper", "Add more #views"];
const withoutRoute = ["#art and dumplings in Chinatown", "Rainy day #museums", "#kids #science", "Jazz tonight in the Village"];

function actionLabel(action: AskAction, itinerary: Itinerary | null) {
  if (action.type === "replace") return `Swap ${itinerary?.stops.find((stop) => stop.id === action.targetStopId)?.name ?? "a stop"} → ${action.placeName}`;
  if (action.type === "shorten") return "Shorten the day by about 2 hours";
  if (action.type === "budget") return `Re-plan with a $${action.totalBudgetUsd} total budget`;
  if (action.type === "replan") return `Plan a new route: “${action.intentText}”`;
  return "";
}
const actionIcon = { replace: RefreshCw, shorten: Clock3, budget: WalletCards, replan: Wand2, none: Sparkles } as const;

function Highlighted({ text }: { text: string }) {
  return <>{tokenizeHashtags(text).map((token, index) => token.hashtag && token.tag ? <span key={index} className="font-semibold text-[#1d64d8]">{token.text}</span> : <span key={index}>{token.text}</span>)}</>;
}

/**
 * Ask Wayly tab. Every suggestion that changes the route is a proposal card;
 * nothing changes until the user taps Apply (the change then runs through the
 * normal planner, so all budget/source/route checks still apply).
 */
export function AskWaylyScreen({ itinerary, request, messages, setMessages, onApply, onPlan }: {
  itinerary: Itinerary | null; request: PlanRequest; messages: AskMessage[];
  setMessages: (update: (current: AskMessage[]) => AskMessage[]) => void; onApply: (action: AskAction) => void; onPlan: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages.length, sending]);

  const send = async (text = draft) => {
    const message = text.trim();
    if (!message || sending) return;
    const history = messages.filter((item) => !item.error).slice(-8).map((item) => ({ role: item.role, text: item.text }));
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    setDraft(""); setSending(true);
    try {
      const { adjustment: _ignored, ...plan } = request;
      const response = await authFetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, history, request: plan, stops: itinerary?.stops.map((stop) => ({ id: stop.id, placeId: stop.placeId, name: stop.name })) ?? [] }) });
      const payload = await response.json() as { reply?: string; action?: AskAction; source?: "model" | "rules"; error?: { message?: string } };
      if (!response.ok || !payload.reply) throw new Error(payload.error?.message ?? "Wayly couldn't answer right now.");
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: payload.reply!, action: payload.action, source: payload.source }]);
    } catch (error) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: error instanceof Error ? error.message : "Wayly couldn't answer right now.", error: true }]);
    } finally { setSending(false); }
  };

  const apply = (item: AskMessage) => {
    if (!item.action || item.action.type === "none") return;
    setMessages((current) => current.map((entry) => entry.id === item.id ? { ...entry, applied: true } : entry));
    onApply(item.action);
  };

  return <div className="flex min-h-dvh flex-col pb-[92px]">
    <header className="px-5 pt-[max(18px,env(safe-area-inset-top))]">
      <p className="text-[13px] font-semibold text-muted-ink">{itinerary ? `About your route · ${itinerary.stops.length} stops` : "No route yet"}</p>
      <h1 className="flex items-center gap-2 text-[30px] font-extrabold tracking-[-0.02em] text-ink"><Sparkles className="size-6 text-pine" />Ask Wayly</h1>
      <p className="mt-1 text-xs leading-5 text-muted-ink">Swap a stop, shorten the day, change the budget or plan something new. Changes only happen when you tap Apply.</p>
    </header>

    <section className="flex-1 space-y-3 px-5 pt-4" aria-live="polite">
      {messages.length === 0 && <div className="rounded-3xl bg-white p-4 shadow-card">
        <p className="text-sm font-bold text-ink">Try asking</p>
        <div className="mt-2.5 flex flex-wrap gap-2">{(itinerary ? withRoute : withoutRoute).map((text) => <button key={text} type="button" onClick={() => void send(text)} className="rounded-full border border-line bg-soft px-3 py-1.5 text-left text-[12px] font-semibold text-ink"><Highlighted text={text} /></button>)}</div>
        {!itinerary && <button type="button" onClick={onPlan} className="mt-3 text-xs font-bold text-pine">Or use the planner →</button>}
      </div>}
      {messages.map((item) => item.role === "user"
        ? <div key={item.id} className="ml-10 rounded-[20px] rounded-br-md bg-pine px-3.5 py-2.5 text-[13px] leading-5 text-white">{item.text}</div>
        : <div key={item.id} className="mr-6">
            <div className={`rounded-[20px] rounded-bl-md px-3.5 py-2.5 text-[13px] leading-5 shadow-card ${item.error ? "bg-rust/10 text-rust" : "bg-white text-ink"}`}><Highlighted text={item.text} /></div>
            {item.action && item.action.type !== "none" && (() => { const Icon = actionIcon[item.action.type]; return <div className="mt-1.5 flex items-center gap-2 rounded-2xl border border-pine/25 bg-sel p-2.5">
              <Icon className="size-4 shrink-0 text-pine" />
              <span className="min-w-0 flex-1 text-[12px] font-semibold leading-4 text-pine">{actionLabel(item.action, itinerary)}</span>
              <button type="button" disabled={item.applied} onClick={() => apply(item)} className="inline-flex h-8 items-center gap-1 rounded-full bg-pine px-3 text-[12px] font-bold text-white disabled:bg-pine/40">{item.applied ? <><Check className="size-3.5" />Applied</> : "Apply"}</button>
            </div>; })()}
          </div>)}
      {sending && <div className="mr-6 inline-flex items-center gap-2 rounded-[20px] bg-white px-3.5 py-2.5 text-[13px] text-muted-ink shadow-card"><Loader2 className="size-4 animate-spin" />Thinking…</div>}
      <div ref={endRef} />
    </section>

    <div className="fixed bottom-[68px] left-1/2 z-20 w-full max-w-[390px] -translate-x-1/2 border-t border-line bg-soft/95 px-4 pb-2.5 pt-2 backdrop-blur">
      <div className="flex items-end gap-2 rounded-[22px] border border-line bg-white px-3.5 pb-2 pt-0.5">
        <div className="min-w-0 flex-1"><HashtagInput value={draft} onChange={setDraft} maxLength={300} ariaLabel="Message Wayly" placeholder="e.g. swap the museum for #food" onEnter={() => void send()} compact /></div>
        <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending} aria-label="Send" className="mb-7 grid size-9 shrink-0 place-items-center rounded-full bg-pine text-white disabled:bg-line"><ArrowUp className="size-[18px]" /></button>
      </div>
    </div>
  </div>;
}
