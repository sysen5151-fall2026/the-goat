"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check, CircleAlert, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { replayOnboarding } from "@/components/onboarding-gate";

type AuthMode = "login" | "register" | "reset";
type Notice = { tone: "error" | "info"; text: string } | null;

const HERO_IMAGE = "/images/nyc-hero.jpg";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Supabase auth errors → short, user-facing copy. */
function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/invalid login credentials/i.test(message)) return "That email and password don't match. Try again or reset your password.";
  if (/already registered|already been registered/i.test(message)) return "An account with this email already exists — sign in instead.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first — check your inbox for the link from Wayly.";
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  if (/password/i.test(message) && /(weak|short|least)/i.test(message)) return "Choose a stronger password (at least 8 characters).";
  if (/fetch|network/i.test(message)) return "Can't reach the account service. Check your connection and try again.";
  return message || "Sign-in couldn't be completed right now.";
}

/** Where to go after sign-in: a same-origin path from ?next=, else home. */
function nextPath() {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next");
  // Same-origin paths only (blocks //evil.com, /\\evil.com and auth-page loops).
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (/^\/(login|register)(\/|\?|#|$)/.test(next)) return "/";
  return next;
}

function Field({ icon: Icon, label, children, trailing }: { icon: typeof Mail; label: string; children: ReactNode; trailing?: ReactNode }) {
  return <label className="flex min-h-[64px] items-center gap-2.5 rounded-2xl border border-line bg-white px-3 py-2.5 focus-within:border-pine">
    <span className="grid size-[34px] shrink-0 place-items-center rounded-[11px] bg-sel text-pine"><Icon className="size-[17px]" /></span>
    <span className="min-w-0 flex-1"><span className="block text-[11px] font-medium text-muted-ink">{label}</span>{children}</span>
    {trailing}
  </label>;
}

const inputClass = "mt-0.5 w-full bg-transparent text-[15px] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-[#a7b3b9]";

export function ConsumerAuthPage({ mode: initialMode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);
  const configured = Boolean(getSupabaseBrowserClient("consumer"));
  const isRegister = mode === "register";

  // Already signed in (and not resetting a password) → go straight to the requested page.
  useEffect(() => {
    const client = getSupabaseBrowserClient("consumer");
    if (!client || window.location.hash.includes("type=recovery")) return;
    void client.auth.getSession().then(({ data }) => { if (data.session) router.replace(nextPath()); });
  }, [router]);

  // A password-reset email link lands here with a recovery session.
  useEffect(() => {
    const client = getSupabaseBrowserClient("consumer");
    const subscription = client?.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") { setMode("reset"); setNotice({ tone: "info", text: "Choose a new password for your account." }); }
    });
    return () => subscription?.data.subscription.unsubscribe();
  }, []);

  const switchMode = (next: AuthMode) => {
    setMode(next); setNotice(null); setConfirmPassword("");
    if (next !== "reset") window.history.replaceState(null, "", `/${next === "register" ? "register" : "login"}${window.location.search}`);
  };

  const finish = () => { router.replace(nextPath()); router.refresh(); };

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient("consumer");
    if (!supabase) { setNotice({ tone: "error", text: "Accounts aren't configured for this preview yet." }); return; }
    if (mode !== "reset" && !isValidEmail(email)) { setNotice({ tone: "error", text: "Enter a valid email address." }); return; }
    if (password.length < 8) { setNotice({ tone: "error", text: "Your password needs at least 8 characters." }); return; }
    if ((isRegister || mode === "reset") && password !== confirmPassword) { setNotice({ tone: "error", text: "The two passwords don't match." }); return; }
    if (isRegister && !displayName.trim()) { setNotice({ tone: "error", text: "Tell us what to call you." }); return; }
    if (isRegister && !termsAccepted) { setNotice({ tone: "error", text: "Accept the Terms and Privacy Notice to continue." }); return; }

    setSubmitting(true); setNotice(null);
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        finish();
        return;
      }
      if (isRegister) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: displayName.trim().slice(0, 24) }, emailRedirectTo: `${window.location.origin}/login` },
        });
        if (error) throw error;
        // Supabase returns a user with no identities when the email is already taken (enumeration-safe mode).
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error("already registered");
        if (!data.session) {
          setMode("login"); setPassword(""); setConfirmPassword("");
          setNotice({ tone: "info", text: `We sent a confirmation link to ${email.trim()}. Open it, then sign in here.` });
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
      finish();
    } catch (error) {
      setNotice({ tone: "error", text: friendlyError(error) });
    } finally {
      setSubmitting(false);
    }
  };

  const forgotPassword = async () => {
    const supabase = getSupabaseBrowserClient("consumer");
    if (!supabase) return;
    if (!isValidEmail(email)) { setNotice({ tone: "error", text: "Enter your email above first, then tap “Forgot password”." }); return; }
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/login` });
    setSubmitting(false);
    setNotice(error ? { tone: "error", text: friendlyError(error) } : { tone: "info", text: `If ${email.trim()} has an account, a reset link is on its way.` });
  };

  const title = mode === "reset" ? "Set a new password" : isRegister ? "Create your account" : "Welcome back";
  const subtitle = mode === "reset" ? "You're almost back in." : isRegister ? "Save routes, keep your preferences, pick up where you left off." : "Sign in to plan, save and revisit your NYC days.";

  return <main className="min-h-dvh bg-[#ece6d9] text-ink"><div className="relative mx-auto min-h-dvh max-w-[390px] overflow-x-clip bg-soft shadow-[0_0_40px_rgba(13,41,64,0.08)]">
    <div className="relative h-[260px] overflow-hidden">
      <img src={HERO_IMAGE} alt="Brooklyn Bridge and Lower Manhattan at sunset" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-x-0 top-0 h-[140px] bg-gradient-to-b from-ink/60 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[180px] bg-gradient-to-t from-ink/85 to-transparent" />
      <header className="absolute inset-x-0 top-0 flex items-center justify-between px-5 pt-[max(16px,env(safe-area-inset-top))]">
        <span className="size-[38px]" />
        <span className="text-[19px] font-extrabold tracking-[0.04em] text-white">WAYLY</span>
        <span className="size-[38px]" />
      </header>
      <div className="absolute inset-x-5 bottom-14">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/35 bg-white/20 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"><Sparkles className="size-3" />Source-linked NYC plans</span>
        <h1 className="mt-2 text-[30px] font-extrabold leading-[34px] tracking-[-0.02em] text-white">{title}</h1>
      </div>
    </div>

    <section className="relative -mt-10 rounded-t-[28px] bg-soft px-5 pb-10 pt-[22px] shadow-sheet">
      {mode !== "reset" && <div role="tablist" aria-label="Account" className="grid grid-cols-2 rounded-2xl bg-sage p-1">
        {(["login", "register"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={mode === item} onClick={() => switchMode(item)} className={`min-h-10 rounded-xl text-[13px] font-bold transition ${mode === item ? "bg-white text-pine shadow-sm" : "text-muted-ink"}`}>{item === "login" ? "Sign in" : "Create account"}</button>)}
      </div>}
      <p className="mt-3.5 text-[13px] leading-5 text-muted-ink">{subtitle}</p>

      {!configured && <div className="mt-3 flex gap-2 rounded-2xl border border-[#f2deb7] bg-[#fffaf0] p-3 text-xs leading-5 text-[#8a5a16]"><CircleAlert className="mt-0.5 size-4 shrink-0" />Accounts aren&apos;t configured for this preview. Add the Supabase URL and publishable key to .env.local and restart.</div>}

      <form onSubmit={submit} noValidate className="mt-3.5 space-y-2.5">
        {isRegister && <Field icon={UserRound} label="Your name"><input autoComplete="name" value={displayName} maxLength={24} onChange={(event) => setDisplayName(event.target.value)} placeholder="What should we call you?" className={inputClass} /></Field>}
        {mode !== "reset" && <Field icon={Mail} label="Email"><input type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className={inputClass} /></Field>}
        <Field icon={Lock} label={mode === "reset" ? "New password" : "Password"} trailing={<button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="grid size-9 place-items-center rounded-full text-muted-ink hover:bg-sel">{showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}</button>}>
          <input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" className={inputClass} />
        </Field>
        {(isRegister || mode === "reset") && <Field icon={KeyRound} label="Confirm password"><input type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Type it again" className={inputClass} /></Field>}

        {mode === "login" && <div className="flex justify-end"><button type="button" onClick={() => void forgotPassword()} className="min-h-8 px-1 text-xs font-bold text-pine">Forgot password?</button></div>}
        {isRegister && <button type="button" onClick={() => setTermsAccepted((value) => !value)} aria-pressed={termsAccepted} className="flex w-full items-start gap-2.5 rounded-2xl px-1 py-1.5 text-left text-xs leading-5 text-muted-ink">
          <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border ${termsAccepted ? "border-pine bg-pine text-white" : "border-line bg-white"}`}>{termsAccepted && <Check className="size-3.5" />}</span>
          I agree to the Terms and Privacy Notice. Wayly stores my email, saved routes and planning preferences.
        </button>}

        {notice && <p role={notice.tone === "error" ? "alert" : "status"} className={`flex gap-2 rounded-2xl p-3 text-xs leading-5 ${notice.tone === "error" ? "bg-rust/10 text-rust" : "bg-sel text-pine"}`}>{notice.tone === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <Check className="mt-0.5 size-4 shrink-0" />}{notice.text}</p>}

        <Button type="submit" size="lg" disabled={submitting || !configured} className="h-14 w-full rounded-[18px] bg-pine text-base font-bold shadow-cta hover:bg-pine-dark">
          {submitting ? <Loader2 className="size-[18px] animate-spin" /> : <ArrowRight className="size-[18px]" />}
          {submitting ? "One moment…" : mode === "reset" ? "Save new password" : isRegister ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-muted-ink"><ShieldCheck className="size-3.5 text-pine" />Your password never touches Wayly&apos;s servers</p>
      {mode !== "reset" && <button type="button" onClick={replayOnboarding} className="mt-3 w-full py-2 text-center text-xs font-semibold text-pine">View app introduction</button>}
    </section>
  </div></main>;
}
