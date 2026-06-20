'use client';
import { useEffect, type ReactNode } from 'react';

function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" style={{ display: 'block', filter: 'drop-shadow(0 6px 14px rgba(16,185,129,.45))' }} aria-hidden="true">
      <defs>
        <linearGradient id="vlogoCredits" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
      </defs>
      <rect width="30" height="30" rx="8.5" fill="url(#vlogoCredits)" />
      <path d="M10 7.5h6.2a4.8 4.8 0 0 1 0 9.6H13.6V22.5H10z M13.6 11v3.1h2.2a1.55 1.55 0 0 0 0-3.1z" fill="#fff" />
    </svg>
  );
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5 text-[1.35rem] font-extrabold tracking-tight text-zinc-900">
      <Logo />
      <span>Vac<span className="text-emerald-600">ant</span></span>
    </span>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">{children}</p>;
}

// Initials avatar in the brand language — OS-independent, no emoji.
function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200/70">
      {initials}
    </span>
  );
}

// ── Backer data ──────────────────────────────────────────────────────
// Example backer requested: "Ryan Y." appears in the Founding Backers tier.
type Tier = { name: string; pledge: string; blurb: string; backers: string[] };

const TIERS: Tier[] = [
  {
    name: 'Founding Backers',
    pledge: '$250+',
    blurb: 'Believed in live, vision-checked parking before a single lot was live. Names etched here for good.',
    backers: ['Ryan Y.'],
  },
  {
    name: 'Lot Champions',
    pledge: '$100',
    blurb: 'Funded the cameras and the compute that turn a feed into an exact open-space count.',
    backers: [],
  },
  {
    name: 'Early Supporters',
    pledge: '$25',
    blurb: 'Got us off the ground and onto the first real public feeds.',
    backers: [],
  },
];

export default function Credits() {
  useEffect(() => {
    document.documentElement.classList.add('reveal-armed');
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { e.target.classList.add('is-visible'); obs.unobserve(e.target); }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    document.querySelectorAll<HTMLElement>('.reveal').forEach((el) => obs.observe(el));
    return () => { obs.disconnect(); document.documentElement.classList.remove('reveal-armed'); };
  }, []);

  const total = TIERS.reduce((n, t) => n + t.backers.length, 0);

  return (
    <div className="flex min-h-dvh w-full flex-col bg-[#eef3f1] text-zinc-900">
      {/* ── Sticky nav ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-[#eef3f1]/90 backdrop-blur-md">
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="/" aria-label="Vacant home"><Wordmark /></a>
          <div className="hidden items-center gap-8 text-sm font-medium text-zinc-500 md:flex">
            <a href="/" className="transition-colors hover:text-zinc-900">Home</a>
            <a href="/#how" className="transition-colors hover:text-zinc-900">How it works</a>
            <a href="/#why" className="transition-colors hover:text-zinc-900">Why it pays</a>
          </div>
          <a href="/live" className="inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.98]">
            See it live <span aria-hidden="true">→</span>
          </a>
        </nav>
      </header>

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -top-32 right-[-10%] -z-10 h-[36rem] w-[36rem] rounded-full bg-emerald-300/25 blur-[120px]" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-40 left-[-15%] -z-10 h-[32rem] w-[32rem] rounded-full bg-emerald-200/30 blur-[120px]" aria-hidden="true" />
          <div className="mx-auto w-full max-w-3xl px-5 py-20 text-center sm:px-8 sm:py-28">
            <div className="reveal mx-auto inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-100/70 px-3.5 py-1.5 text-sm font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {total} {total === 1 ? 'backer' : 'backers'} and counting
            </div>
            <h1 className="reveal reveal-d1 mt-5 text-[clamp(2.2rem,5vw,3.25rem)] font-bold leading-[1.06] tracking-tight text-zinc-900">
              Vacant exists because of <span className="text-emerald-600">these people.</span>
            </h1>
            <p className="reveal reveal-d2 mx-auto mt-5 max-w-xl text-lg leading-relaxed text-zinc-500 sm:text-xl">
              Every backer on Kickstarter funded a camera, a calibration, or a line of code that turns a live
              feed into an open spot. This wall is for them.
            </p>
          </div>
        </section>

        {/* ── Featured backer spotlight ────────────────────────────── */}
        <section className="mx-auto w-full max-w-6xl px-5 pb-4 sm:px-8">
          <div className="reveal mx-auto max-w-3xl overflow-hidden rounded-[2rem] border border-emerald-200/70 bg-white p-8 shadow-xl shadow-emerald-900/5 sm:p-10">
            <Eyebrow>Founding backer</Eyebrow>
            <div className="mt-5 flex items-center gap-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-sm shadow-emerald-600/30">
                RY
              </span>
              <div>
                <p className="text-2xl font-bold tracking-tight text-zinc-900">Ryan Y.</p>
                <p className="text-sm font-medium text-emerald-600">Founding Backer · $250+</p>
              </div>
            </div>
            <p className="mt-6 text-[15px] leading-relaxed text-zinc-500">
              &ldquo;Backed Vacant on day one. Proud to help drivers stop circling the block and get parking that
              actually tells the truth.&rdquo;
            </p>
          </div>
        </section>

        {/* ── Backers wall by tier ─────────────────────────────────── */}
        <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="reveal max-w-2xl">
            <Eyebrow>The wall</Eyebrow>
            <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-tight tracking-tight text-zinc-900">
              Every backer, by tier.
            </h2>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-3">
            {TIERS.map((t, i) => (
              <div key={t.name} className={`reveal reveal-d${(i % 3) + 1} flex flex-col rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm`}>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-lg font-bold tracking-tight text-zinc-900">{t.name}</h3>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{t.pledge}</span>
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-zinc-500">{t.blurb}</p>
                <div className="mt-5 flex flex-col gap-2.5 border-t border-zinc-200/80 pt-5">
                  {t.backers.length > 0 ? (
                    t.backers.map((b) => (
                      <div key={b} className="flex items-center gap-3">
                        <Avatar name={b} />
                        <span className="text-[15px] font-semibold text-zinc-800">{b}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm italic text-zinc-400">Your name could be here.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Closing CTA ──────────────────────────────────────────── */}
        <section className="px-5 py-16 sm:px-8 sm:py-20">
          <div className="reveal relative mx-auto w-full max-w-6xl overflow-hidden rounded-[2rem] bg-zinc-900 px-8 py-16 text-center sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-500/20 blur-[100px]" aria-hidden="true" />
            <Eyebrow>Join the wall</Eyebrow>
            <h2 className="mx-auto mt-4 max-w-3xl text-[clamp(1.9rem,4.5vw,3rem)] font-bold leading-[1.1] tracking-tight text-white">
              Back Vacant and <span className="text-emerald-400">get your name here.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-zinc-400">
              Every pledge funds another live lot. Founding Backers are listed at the top of this page for good.
            </p>
            <a href="https://www.kickstarter.com" target="_blank" rel="noopener noreferrer" className="mt-9 inline-flex h-14 items-center justify-center gap-3 rounded-2xl bg-emerald-500 px-8 text-lg font-semibold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-[0.98]">
              Back us on Kickstarter <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="border-t border-zinc-200/80 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-sm">
            <Wordmark />
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              Live parking occupancy from real public cameras. Less circling, less waste.
            </p>
          </div>
          <a href="/" className="inline-flex h-12 w-fit items-center gap-2.5 rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.98]">
            Back to home <span aria-hidden="true">→</span>
          </a>
        </div>
        <div className="border-t border-zinc-200/80">
          <div className="mx-auto w-full max-w-6xl px-5 py-5 text-xs text-zinc-400 sm:px-8">
            &copy; {new Date().getFullYear()} Vacant &middot; Built with our backers.
          </div>
        </div>
      </footer>
    </div>
  );
}
