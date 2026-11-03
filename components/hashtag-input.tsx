"use client";

import { useRef, useState } from "react";
import { Hash } from "lucide-react";
import { parseHashtags, suggestTags, TAG_LABELS, tokenizeHashtags } from "@/lib/nyc-hashtags";

const TEXT = "block w-full whitespace-pre-wrap break-words p-0 text-[13px] leading-5 [overflow-wrap:anywhere]";

/**
 * Trip request box where #tags filter interests. Recognised tags turn blue
 * (a mirrored layer behind a transparent textarea, so caret and selection stay
 * native). Typing "#" shows tag suggestions; tapping one completes it.
 */
export function HashtagInput({ value, onChange, maxLength = 300, id, placeholder, onEnter, ariaLabel = "Trip request", compact = false }: { value: string; onChange: (value: string) => void; maxLength?: number; id?: string; placeholder?: string; onEnter?: () => void; ariaLabel?: string; compact?: boolean }) {
  const minHeight = compact ? "min-h-10" : "min-h-14";
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const before = value.slice(0, caret);
  const partial = /(?:^|\s)#([a-z-]*)$/i.exec(before);
  const suggestions = partial ? suggestTags(partial[1]).filter((tag) => !parseHashtags(value).includes(tag) || TAG_LABELS[tag] !== partial[1].toLowerCase()).slice(0, 6) : [];
  const active = parseHashtags(value);

  const update = (next: string, nextCaret?: number) => {
    onChange(next.slice(0, maxLength));
    if (nextCaret !== undefined) requestAnimationFrame(() => { ref.current?.setSelectionRange(nextCaret, nextCaret); ref.current?.focus(); setCaret(nextCaret); });
  };
  const complete = (label: string) => {
    if (!partial) return;
    const start = caret - partial[1].length;
    const rest = value.slice(caret).replace(/^[a-z-]*/i, "");
    const insert = `${label} `;
    update(value.slice(0, start) + insert + rest.replace(/^ /, ""), start + insert.length);
  };

  return <div>
    <div className={`relative mt-2 ${minHeight}`}>
      <div aria-hidden="true" className={`${TEXT} ${minHeight} text-ink`}>
        {value ? tokenizeHashtags(value).map((token, index) => token.hashtag && token.tag
          ? <span key={index} className="rounded-[4px] bg-[#e6efff] text-[#1d64d8]">{token.text}</span>
          : <span key={index}>{token.text}</span>) : <span className="text-[#a7b3b9]">{placeholder}</span>}
        {"​"}
      </div>
      <textarea
        id={id} ref={ref} aria-label={ariaLabel} value={value} maxLength={maxLength} spellCheck={false}
        onChange={(event) => { update(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onKeyDown={(event) => { if ((event.key === "Tab" || event.key === "Enter") && suggestions[0]) { event.preventDefault(); complete(TAG_LABELS[suggestions[0]]); return; } if (event.key === "Enter" && !event.shiftKey && onEnter && !event.nativeEvent.isComposing) { event.preventDefault(); onEnter(); } }}
        className={`${TEXT} absolute inset-0 h-full resize-none overflow-hidden bg-transparent text-transparent caret-ink outline-none selection:bg-[#1d64d8]/25`}
      />
    </div>
    {suggestions.length > 0
      ? <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Tag suggestions">{suggestions.map((tag) => <li key={tag}><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => complete(TAG_LABELS[tag])} className="inline-flex min-h-7 items-center gap-0.5 rounded-full bg-[#e6efff] px-2.5 text-[12px] font-semibold text-[#1d64d8]"><Hash className="size-3" />{TAG_LABELS[tag]}</button></li>)}</ul>
      : <p className="mt-2 text-[11px] leading-4 text-muted-ink">{active.length ? <>Filtering by {active.map((tag) => <span key={tag} className="font-semibold text-[#1d64d8]">#{TAG_LABELS[tag]} </span>)}</> : <>Type <span className="font-semibold text-[#1d64d8]">#</span> to filter: #history #food #views #art #kids …</>}</p>}
  </div>;
}
