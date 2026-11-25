"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2, ShieldAlert } from "lucide-react";
import { replayOnboarding } from "@/components/onboarding-gate";
import { useSession, type SessionUser } from "@/lib/use-session";

/**
 * Client-side sign-in gate. Nothing inside renders until the server
 * (/api/auth/me) has confirmed an active account. Guests are sent to
 * /login?next=<the link they opened>, so deep links resume after sign-in.
 * Fails closed: if the account service isn't configured, the app stays locked.
 *
 * This is a UX boundary only — every data/API route also verifies the
 * Supabase JWT on the server.
 */
export function RequireAuth({ children, roles }: { children: ReactNode; roles?: readonly SessionUser["role"][] }) {
  const router = useRouter();
  const { session } = useSession();

  useEffect(() => {
    if (session.status !== "guest") return;
    const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    router.replace(`/login?next=${encodeURIComponent(here)}`);
  }, [session.status, router]);

  if (session.status === "authed") {
    if (roles && !roles.includes(session.user.role)) return <Gate icon={<ShieldAlert className="size-6" />} title="No access" text="Your account doesn't have permission to open this page." />;
    return <>{children}</>;
  }
  if (session.status === "disabled") return <Gate icon={<CircleAlert className="size-6" />} title="Sign-in unavailable" text="The account service isn't configured, so Wayly is locked. Add the Supabase URL and publishable key to .env.local and restart." action={{ label: "Back", onClick: replayOnboarding }} />;
  return <Gate icon={<Loader2 className="size-6 animate-spin" />} title="Checking your account…" text="One moment." />;
}

function Gate({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: { label: string; onClick: () => void } }) {
  return <main className="grid min-h-dvh place-items-center bg-[#ece6d9] px-6 text-ink">
    <div className="flex w-full max-w-[320px] flex-col items-center text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-sel text-pine">{icon}</span>
      <p className="mt-4 text-base font-bold">{title}</p>
      <p className="mt-1.5 text-[13px] leading-5 text-muted-ink">{text}</p>
      {action && <button type="button" onClick={action.onClick} className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-pine text-sm font-bold text-white">{action.label}</button>}
    </div>
  </main>;
}
