'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type OccData = {
  id: string; name: string; inside: number | null; count: number;
  capacity: number | null; peak: number | null; ts: number;
  image: string | null; cv_count?: number | null;
};

function Timestamp() {
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString([], { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <>{t}</>;
}

export default function StreamPage() {
  const [occ, setOcc] = useState<OccData | null>(null);
  const [lastFrame, setLastFrame] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let frameCount = 0;
    let lastTs = 0;
    let on = true;

    const poll = async () => {
      try {
        const r = await fetch('/api/occupancy', { cache: 'no-store' });
        const data = await r.json();
        const lot: OccData | undefined = data['mylot'];
        if (!lot) return;
        setOcc(lot);
        if (lot.image && lot.ts !== lastTs) {
          lastTs = lot.ts;
          setLastFrame(lot.image);
          frameCount++;
        }
      } catch {}
    };

    poll();
    const pollId = setInterval(poll, 500);

    // tick clock and fps counter
    const clockId = setInterval(() => setNow(Date.now()), 1000);
    const fpsId = setInterval(() => {
      setFps(frameCount);
      frameCount = 0;
    }, 10000);

    return () => { on = false; clearInterval(pollId); clearInterval(clockId); clearInterval(fpsId); };
  }, []);

  const inside = occ?.inside ?? occ?.count ?? 0;
  const cap = occ?.capacity ?? null;
  const pct = cap ? Math.min(100, Math.round((inside / cap) * 100)) : 0;
  const ago = occ?.ts ? Math.round((now - occ.ts) / 1000) : null;
  const live = ago != null && ago < 12;
  const status = !occ ? 'waiting' : !live ? 'stale' : 'live';

  return (
    <div style={{
      minHeight: '100vh', background: '#080f18',
      display: 'flex', flexDirection: 'column',
      fontFamily: '"Courier New", "Courier", monospace',
      color: '#00ff88',
    }}>

      {/* top bar */}
      <header style={{
        padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(0,255,136,.15)', background: 'rgba(0,255,136,.03)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/" style={{ color: '#3a8c60', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
            ← DASHBOARD
          </Link>
          <span style={{ color: '#1a3d28', fontSize: 12 }}>|</span>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>SECURITY CAM · CAM-01 · MY PARKING LOT</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, letterSpacing: 1 }}>
          <span style={{ color: '#3a8c60' }}><Timestamp /></span>
          <span style={{
            padding: '3px 10px', borderRadius: 3, fontSize: 11, fontWeight: 700, letterSpacing: 1,
            background: status === 'live' ? 'rgba(0,255,136,.15)' : 'rgba(255,60,60,.15)',
            color: status === 'live' ? '#00ff88' : '#ff4444',
            border: `1px solid ${status === 'live' ? 'rgba(0,255,136,.4)' : 'rgba(255,60,60,.4)'}`,
          }}>
            {status === 'live' ? '● REC' : status === 'stale' ? '○ STALE' : '○ WAITING'}
          </span>
        </div>
      </header>

      {/* main grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 260px', overflow: 'hidden' }}>

        {/* camera feed */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'hidden' }}>

          {/* scanline overlay */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,.08) 2px, rgba(0,0,0,.08) 4px)',
          }} />

          {/* corner brackets */}
          {[['0','0','1,0,0,1'], ['0','auto','1,0,0,-1'], ['auto','0','-1,0,0,1'], ['auto','auto','-1,0,0,-1']].map(([t,b,m], i) => (
            <div key={i} style={{ position: 'absolute', top: t === 'auto' ? undefined : 28, bottom: b === 'auto' ? undefined : 28,
              left: i < 2 ? 28 : undefined, right: i >= 2 ? 28 : undefined, width: 24, height: 24, zIndex: 11,
              borderTop: i < 2 ? '2px solid rgba(0,255,136,.6)' : 'none',
              borderBottom: i >= 2 ? '2px solid rgba(0,255,136,.6)' : 'none',
              borderLeft: i === 0 || i === 2 ? '2px solid rgba(0,255,136,.6)' : 'none',
              borderRight: i === 1 || i === 3 ? '2px solid rgba(0,255,136,.6)' : 'none',
            }} />
          ))}

          <div style={{ width: '100%', maxWidth: 900, position: 'relative' }}>
            <div style={{
              borderRadius: 4, overflow: 'hidden', background: '#030810',
              aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid rgba(0,255,136,.2)',
              boxShadow: '0 0 40px rgba(0,255,136,.06)',
            }}>
              {lastFrame
                ? <img src={lastFrame} alt="detection feed" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: 'rgba(0,255,136,.3)', fontSize: 48, marginBottom: 12 }}>⬛</div>
                    <div style={{ color: 'rgba(0,255,136,.5)', fontSize: 13, letterSpacing: 2 }}>
                      {occ ? 'AWAITING FRAME…' : 'NO SIGNAL'}
                    </div>
                    <div style={{ color: 'rgba(0,255,136,.25)', fontSize: 11, marginTop: 8, letterSpacing: 1 }}>
                      {occ ? 'DETECTION WORKER CONNECTED' : 'START: python scripts/push.py'}
                    </div>
                  </div>
                )}
            </div>

            {/* HUD overlays */}
            {lastFrame && (
              <>
                <div style={{ position: 'absolute', top: 10, left: 12, fontSize: 11, color: 'rgba(0,255,136,.7)', letterSpacing: 1, textShadow: '0 0 8px rgba(0,255,136,.8)' }}>
                  CAM-01 · MY PARKING LOT
                </div>
                <div style={{ position: 'absolute', top: 10, right: 12, fontSize: 11, color: 'rgba(0,255,136,.7)', letterSpacing: 1, textShadow: '0 0 8px rgba(0,255,136,.8)' }}>
                  YOLO11x · {ago != null ? `${ago}s AGO` : '—'}
                </div>
                <div style={{ position: 'absolute', bottom: 10, left: 12, fontSize: 11, color: 'rgba(0,255,136,.6)', letterSpacing: 1 }}>
                  VEHICLES DETECTED: <span style={{ color: '#00ff88', fontWeight: 700 }}>{occ?.count ?? 0}</span>
                </div>
                <div style={{ position: 'absolute', bottom: 10, right: 12, fontSize: 11, color: 'rgba(0,255,136,.6)', letterSpacing: 1 }}>
                  IN-LOT: <span style={{ color: '#00ff88', fontWeight: 700 }}>{inside}</span>
                  {cap != null && <span style={{ color: 'rgba(0,255,136,.4)' }}> / {cap}</span>}
                </div>
              </>
            )}
          </div>
        </div>

        {/* side panel */}
        <aside style={{ borderLeft: '1px solid rgba(0,255,136,.1)', padding: '20px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* occupancy meter */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: 'rgba(0,255,136,.5)', marginBottom: 8 }}>LOT OCCUPANCY</div>
            <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1, color: pct > 85 ? '#ff4444' : pct > 60 ? '#f59e0b' : '#00ff88', letterSpacing: -1 }}>
              {pct}<span style={{ fontSize: 18, color: 'rgba(0,255,136,.4)' }}>%</span>
            </div>
            <div style={{ marginTop: 10, height: 6, background: 'rgba(0,255,136,.1)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2, transition: 'width .6s ease',
                width: `${pct}%`,
                background: pct > 85 ? '#ff4444' : pct > 60 ? '#f59e0b' : '#00ff88',
              }} />
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,255,136,.4)', letterSpacing: 1 }}>
              {inside} PARKED · {cap != null ? cap - inside : '?'} OPEN
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(0,255,136,.08)' }} />

          {/* stats */}
          {[
            { label: 'DETECTED', value: occ?.count ?? '—' },
            { label: 'IN-LOT', value: inside },
            { label: 'CAPACITY', value: cap ?? '—' },
            { label: 'PEAK', value: occ?.peak ?? '—' },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: 'rgba(0,255,136,.35)', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#00ff88', letterSpacing: -0.5 }}>{value}</div>
            </div>
          ))}

          <div style={{ borderTop: '1px solid rgba(0,255,136,.08)' }} />

          {/* status */}
          <div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: 'rgba(0,255,136,.35)', marginBottom: 8 }}>FEED STATUS</div>
            {[
              { label: 'SOURCE', value: 'LARIX RTMP' },
              { label: 'MODEL', value: 'YOLO11x' },
              { label: 'REFRESH', value: '~3s' },
              { label: 'LAST UPDATE', value: ago != null ? `${ago}s ago` : '—' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, letterSpacing: .5 }}>
                <span style={{ color: 'rgba(0,255,136,.35)' }}>{label}</span>
                <span style={{ color: 'rgba(0,255,136,.7)' }}>{value}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
