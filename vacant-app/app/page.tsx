'use client';
import { useEffect, useState, type ReactNode } from 'react';

function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" style={{ display: 'block', filter: 'drop-shadow(0 6px 14px rgba(16,185,129,.45))' }} aria-hidden="true">
      <defs>
        <linearGradient id="vlogoLanding" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
      </defs>
      <rect width="30" height="30" rx="8.5" fill="url(#vlogoLanding)" />
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

// Monoline emerald icon set: one visual language, OS-independent (no emoji).
const ICONS: Record<string, ReactNode> = {
  camera: <><path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H7l1.4-2h7.2L18 7h2.5A1.5 1.5 0 0 1 22 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 18z" /><circle cx="12" cy="13" r="3.6" /></>,
  pin: <><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  shield: <><path d="M12 3l7 3v5c0 4.6-3.1 7.8-7 9-3.9-1.2-7-4.4-7-9V6z" /><path d="M8.8 11.6l2.1 2.1 4.3-4.6" /></>,
  bolt: <path d="M13 3 5 14h5l-1 7 9-11h-5z" />,
  map: <><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></>,
  trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M16 7h5v5" /></>,
  clock: <><circle cx="12" cy="12" r="8.2" /><path d="M12 8v4.2l3 1.8" /></>,
  coin: <><circle cx="12" cy="12" r="8.2" /><path d="M12 7.2v9.6M14.4 9.4a2.6 2 0 0 0-2.4-1.4h-.7a2 2 0 0 0 0 4h1.4a2 2 0 0 1 0 4h-.7a2.6 2 0 0 1-2.4-1.4" /></>,
  store: <><path d="M4 9 5.2 4h13.6L20 9M4 9v11h16V9M4 9h16" /><path d="M10 20v-5h4v5" /></>,
  globe: <><circle cx="12" cy="12" r="8.2" /><path d="M3.8 12h16.4M12 3.8c2.2 2.3 3.4 5.2 3.4 8.2S14.2 17.9 12 20.2c-2.2-2.3-3.4-5.2-3.4-8.2S9.8 6.1 12 3.8z" /></>,
};

function Icon({ name }: { name: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const FEATURES = [
  { icon: 'camera', title: 'Real cameras, real counts', body: 'We read live public camera feeds and detect every car with computer vision, not GPS guesses, not estimates. What you see is what is on the ground.' },
  { icon: 'pin', title: 'Down to the exact spot', body: 'Painted lots are checked stall by stall, so you get an exact open-space count and a map of where the empty spots actually are.' },
  { icon: 'shield', title: 'Vision-checked accuracy', body: 'Every count is verified by a second AI pass before it ships, so the number on screen is one you can trust to send a driver to.' },
  { icon: 'bolt', title: 'Near real-time', body: 'Feeds refresh continuously. Open a lot and the occupancy you see is current, updated as cars come and go.' },
  { icon: 'map', title: 'Lots and streets', body: 'Calibrated trailhead and garage lots plus live street-traffic counters, all in one view, each one drawn to scale.' },
  { icon: 'trend', title: 'Knows its busiest hour', body: 'Vacant remembers the most cars it has ever measured at each location, so a lot can tell drivers when to skip the trip.' },
];

const WHY = [
  { icon: 'clock', title: 'Drivers save time', body: 'No more laps around the block. Open the app, see exactly where a space is, and go straight to it.' },
  { icon: 'coin', title: 'Drivers save money', body: 'Less circling means less fuel burned and fewer wrong-lot fees. The wasted $345 a year stays in their pocket.' },
  { icon: 'store', title: 'Lots keep customers', body: 'A driver who can see there is room comes in instead of giving up. A full lot can point them somewhere nearby.' },
  { icon: 'globe', title: 'Cities cut congestion', body: 'Up to a third of downtown traffic is parking-hunting. Show drivers open spots and that traffic simply disappears.' },
];

const STEPS = [
  { n: '1', title: 'Point at a feed', body: 'Any public camera over a lot or street. One quick calibration maps the view to the real ground plane.' },
  { n: '2', title: 'We count every car', body: 'Computer vision detects and places each vehicle, then a second AI pass verifies the number is right.' },
  { n: '3', title: 'Drivers see open spots', body: 'A live, exact open-space count and map, so nobody circles the block and no lot loses a customer to "is it full?"' },
];

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
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
    return () => { window.removeEventListener('scroll', onScroll); obs.disconnect(); document.documentElement.classList.remove('reveal-armed'); };
  }, []);

  return (
    <div className="flex min-h-dvh w-full flex-col bg-[#eef3f1] text-zinc-900">
      {/* ── Sticky nav ─────────────────────────────────────────────── */}
      <header className={`sticky top-0 z-40 border-b transition-colors duration-300 ${scrolled ? 'border-zinc-200/80 bg-[#eef3f1]/90 backdrop-blur-md' : 'border-transparent bg-transparent'}`}>
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <a href="#top" aria-label="Vacant home"><Wordmark /></a>
          <div className="hidden items-center gap-8 text-sm font-medium text-zinc-500 md:flex">
            <a href="#how" className="transition-colors hover:text-zinc-900">How it works</a>
            <a href="#features" className="transition-colors hover:text-zinc-900">Features</a>
            <a href="#why" className="transition-colors hover:text-zinc-900">Why it pays</a>
          </div>
          <a href="/live" className="inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.98]">
            See it live <span aria-hidden="true">→</span>
          </a>
        </nav>
      </header>

      <main id="top" className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute -top-32 right-[-10%] -z-10 h-[36rem] w-[36rem] rounded-full bg-emerald-300/25 blur-[120px]" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-40 left-[-15%] -z-10 h-[32rem] w-[32rem] rounded-full bg-emerald-200/30 blur-[120px]" aria-hidden="true" />
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-2 lg:gap-8 lg:py-28">
            <div className="reveal max-w-xl">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-100/70 px-3.5 py-1.5 text-sm font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Drivers waste 17 hours a year hunting for parking
              </div>
              <h1 className="mt-5 text-[clamp(2.2rem,5vw,3.25rem)] font-bold leading-[1.06] tracking-tight text-zinc-900">
                Stop circling. See which spots are <span className="text-emerald-600">open</span> right now.
              </h1>
              <p className="mt-5 max-w-lg text-lg leading-relaxed text-zinc-500 sm:text-xl">
                Vacant reads live cameras and counts every car, so drivers find a space in seconds and lots stop
                losing customers to &ldquo;is it even full?&rdquo; Less time wasted, more money saved.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href="/live" className="inline-flex h-14 items-center justify-center gap-3 rounded-2xl bg-zinc-900 px-7 text-lg font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.98]">
                  See the live demo <span aria-hidden="true">→</span>
                </a>
                <a href="#how" className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-7 text-lg font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 active:scale-[0.98]">
                  How it works
                </a>
              </div>
              <p className="mt-7 text-sm text-zinc-400">
                Live now &middot; real public cameras &middot; vision-checked counts
              </p>
            </div>

            {/* Hero card: a mini occupancy panel that mirrors the live app */}
            <div className="reveal reveal-d1 order-first lg:order-last">
              <div className="stash-float mx-auto w-full max-w-sm rounded-[1.75rem] border border-zinc-200/80 bg-white p-6 shadow-xl shadow-emerald-900/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Chautauqua Lot
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">✓ vision-checked</span>
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">Spaces open</p>
                <div className="mt-1 flex items-end gap-2">
                  <span className="text-[4.5rem] font-extrabold leading-none tracking-tight text-emerald-600">23</span>
                  <span className="mb-2 text-lg font-semibold text-zinc-400">/ 60</span>
                </div>
                <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-500" style={{ width: '62%' }} />
                </div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-400">62% full · 37 cars parked</p>
                {/* 24-cell mini lot: 9 open (emerald) of 24 ≈ the 23/60 ratio above */}
                <div className="mt-5 grid grid-cols-6 gap-1.5" aria-hidden="true">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <span key={i} className={`h-5 rounded-md ${[1, 4, 9, 12, 15, 18, 20, 22, 23].includes(i) ? 'bg-emerald-400/80' : 'bg-zinc-200'}`} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Stat band ────────────────────────────────────────────── */}
        <section className="border-y border-zinc-200/80 bg-white">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 divide-y divide-zinc-200/80 px-5 py-12 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-8 sm:py-14">
            {[
              { v: '17 hrs', l: 'the average driver spends hunting for parking each year' },
              { v: '$345', l: 'wasted per driver annually in time, fuel, and fees' },
              { v: '30%', l: 'of city traffic is just cars looking for a space' },
            ].map((s, i) => (
              <div key={s.v} className={`reveal reveal-d${i + 1} flex flex-col items-center py-6 text-center sm:px-6 sm:py-0`}>
                <span className="font-mono text-[clamp(2.5rem,6vw,4rem)] font-bold leading-none tracking-tight text-emerald-600">{s.v}</span>
                <span className="mt-3 max-w-[15rem] text-sm text-zinc-500">{s.l}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────── */}
        <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8 sm:py-24">
          <div className="reveal max-w-2xl">
            <Eyebrow>What it does</Eyebrow>
            <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-tight tracking-tight text-zinc-900">
              It actually measures the cars. Everyone else guesses.
            </h2>
            <p className="mt-4 text-lg text-zinc-500">
              Vacant turns an ordinary camera into a live, exact count of open spaces, accurate enough to send a
              driver straight to one.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div key={f.title} className={`reveal reveal-d${(i % 3) + 1} group rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-md`}>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 transition group-hover:bg-emerald-100"><Icon name={f.icon} /></span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900">{f.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-zinc-500">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────── */}
        <section id="how" className="scroll-mt-20 border-y border-zinc-200/80 bg-white">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="reveal max-w-2xl">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="mt-3 text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-tight tracking-tight text-zinc-900">
                From a camera feed to an open spot in three steps.
              </h2>
            </div>
            <div className="relative mt-12 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-6">
              {STEPS.map((s, i) => (
                <div key={s.n} className={`reveal reveal-d${i + 1} relative`}>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-bold text-white shadow-sm shadow-emerald-600/30">{s.n}</div>
                  <h3 className="mt-5 text-xl font-semibold tracking-tight text-zinc-900">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-zinc-500">{s.body}</p>
                  {i < STEPS.length - 1 && (
                    <span className="pointer-events-none absolute right-[-22px] top-6 hidden text-2xl text-emerald-300 md:block" aria-hidden="true">→</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Why it pays ──────────────────────────────────────────── */}
        <section id="why" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8 sm:py-24">
          <div className="reveal">
            <Eyebrow>Why it pays</Eyebrow>
            <h2 className="mt-4 max-w-2xl text-[clamp(1.9rem,4.5vw,3rem)] font-bold leading-[1.1] tracking-tight text-zinc-900">
              Saved time on one side. Saved money on the <span className="text-emerald-600">other.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-zinc-500">
              Every minute a driver does not spend circling is a minute, and a gallon of gas, they keep. Every car a lot
              does not turn away is revenue it keeps.
            </p>
          </div>
          <div className="reveal mt-12 grid gap-5 sm:grid-cols-2">
            {WHY.map((p) => (
              <div key={p.title} className="rounded-2xl border border-zinc-200/80 bg-white p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Icon name={p.icon} /></div>
                <h3 className="mt-4 text-lg font-bold text-zinc-900">{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-zinc-500">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Closing CTA ──────────────────────────────────────────── */}
        <section className="scroll-mt-20 px-5 py-20 sm:px-8 sm:py-24">
          <div className="reveal relative mx-auto w-full max-w-6xl overflow-hidden rounded-[2rem] bg-zinc-900 px-8 py-16 text-center sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-500/20 blur-[100px]" aria-hidden="true" />
            <Eyebrow>Live right now</Eyebrow>
            <h2 className="mx-auto mt-4 max-w-3xl text-[clamp(1.9rem,4.5vw,3rem)] font-bold leading-[1.1] tracking-tight text-white">
              See real lots counted, <span className="text-emerald-400">car by car.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-zinc-400">
              Open the live board and watch open spaces update from real public cameras: lots drawn to scale, streets counted live.
            </p>
            <a href="/live" className="mt-9 inline-flex h-14 items-center justify-center gap-3 rounded-2xl bg-emerald-500 px-8 text-lg font-semibold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-[0.98]">
              Open the live demo <span aria-hidden="true">→</span>
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
          <a href="/live" className="inline-flex h-12 w-fit items-center gap-2.5 rounded-xl bg-zinc-900 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.98]">
            See it live <span aria-hidden="true">→</span>
          </a>
        </div>
        <div className="border-t border-zinc-200/80">
          <div className="mx-auto w-full max-w-6xl px-5 py-5 text-xs text-zinc-400 sm:px-8">
            &copy; {new Date().getFullYear()} Vacant &middot; Find the open spot before you leave.
          </div>
        </div>
      </footer>
    </div>
  );
}
