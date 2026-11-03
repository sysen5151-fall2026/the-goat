import { LockKeyhole, ShieldCheck } from 'lucide-react';

export default function OpsLoginPage() {
  return (
    <main className="min-h-screen bg-[#f4f6f5] text-[#16211d]">
      <div className="mx-auto flex min-h-screen max-w-[1080px] flex-col justify-center px-5 py-10 md:px-8 lg:flex-row lg:items-center lg:gap-16">
        <section className="mb-10 max-w-md lg:mb-0 lg:w-[420px]">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-lg bg-[#0b5d3b] text-sm font-bold text-white">W</div>
            <div>
              <p className="text-[17px] font-bold tracking-[-0.025em]">Wayly <span className="text-[#16a06a]">NYC Ops</span></p>
              <p className="text-[11px] text-[#8a978f]">Quality Console</p>
            </div>
          </div>
          <h1 className="mt-8 text-3xl font-semibold tracking-[-0.04em] text-[#16211d]">Operations preview</h1>
          <p className="mt-3 text-sm leading-6 text-[#5a6963]">
            This prototype preserves the operations-console experience for the NYC catalog. Access requires a signed-in Wayly account with an operator role, checked on the server.
          </p>
          <ul className="mt-6 space-y-2 text-[13px] text-[#5a6963]">
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 text-[#0b5d3b]" />Published NYC places expose a source link and review date.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 text-[#0b5d3b]" />Local catalog checks and release evidence are shown separately.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 text-[#0b5d3b]" />No credentials, roles, or persistent operator actions are simulated.</li>
          </ul>
        </section>

        <section className="w-full max-w-[440px] rounded-2xl border border-[#e7ebe9] bg-white p-6 shadow-[0_8px_30px_rgba(22,33,29,0.04)] md:p-8">
          <div className="flex items-center gap-2 text-[#0b5d3b]">
            <LockKeyhole className="size-4" />
            <p className="text-[13px] font-semibold">Preview access</p>
          </div>
          <p className="mt-1 text-[12px] text-[#8a978f]">Only admin and super_admin accounts can open the console.</p>
          <a href="/login?next=%2Fops" className="mt-5 flex h-10 w-full items-center justify-center rounded-lg bg-[#0b5d3b] text-[13px] font-semibold text-white hover:bg-[#094c30]">
            Sign in with an operator account
          </a>
          <div className="mt-5 border-t border-[#e7ebe9] pt-4">
            <a href="/" className="flex h-10 items-center justify-center rounded-lg border border-[#e7ebe9] text-[13px] font-medium text-[#5a6963] hover:bg-[#f4f6f5]">
              Return to visitor app
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
