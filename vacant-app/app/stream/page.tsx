'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const HLS_URL = 'http://localhost:8888/live/mylot/index.m3u8';

type OccData = {
  id: string; name: string; inside: number | null; count: number;
  capacity: number | null; peak: number | null; ts: number;
  image: string | null;
};

function Clock() {
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hlsState, setHlsState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [occ, setOcc] = useState<OccData | null>(null);
  const [detectionFrame, setDetectionFrame] = useState<string | null>(null);
  const [showDetection, setShowDetection] = useState(false);
  const [now, setNow] = useState(Date.now());

  // HLS player
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: import('hls.js').default | null = null;

    async function init() {
      const Hls = (await import('hls.js')).default;
      if (Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: true, maxBufferLength: 2, liveSyncDurationCount: 1 });
        hls.loadSource(HLS_URL);
        hls.attachMedia(video!);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setHlsState('live');
          video!.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_e: unknown, data: import('hls.js').ErrorData) => {
          if (data.fatal) setHlsState('offline');
        });
      } else if (video?.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = HLS_URL;
        video.addEventListener('loadedmetadata', () => { setHlsState('live'); video!.play().catch(() => {}); });
        video.addEventListener('error', () => setHlsState('offline'));
      }
    }
    init();
    return () => { hls?.destroy(); };
  }, []);

  // Detection data + annotated frame
  useEffect(() => {
    let on = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/occupancy', { cache: 'no-store' });
        const data = await r.json();
        const lot: OccData | undefined = data['mylot'];
        if (!lot || !on) return;
        setOcc(lot);
        if (lot.image) setDetectionFrame(lot.image);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 500);
    const clockId = setInterval(() => setNow(Date.now()), 1000);
    return () => { on = false; clearInterval(id); clearInterval(clockId); };
  }, []);

  const inside = occ?.inside ?? occ?.count ?? 0;
  const cap = occ?.capacity ?? null;
  const pct = cap ? Math.min(100, Math.round((inside / cap) * 100)) : 0;
  const ago = occ?.ts ? Math.round((now - occ.ts) / 1000) : null;
  const detectionLive = ago != null && ago < 10;
  const hlsLive = hlsState === 'live';

  const barColor = pct > 85 ? '#ff4444' : pct > 60 ? '#f59e0b' : '#00ff88';

  return (
    <div style={{ minHeight: '100vh', background: '#080f18', display: 'flex', flexDirection: 'column', fontFamily: '"Courier New", monospace', color: '#00ff88' }}>

      {/* top bar */}
      <header style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(0,255,136,.12)', background: 'rgba(0,255,136,.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/" style={{ color: '#3a8c60', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>← DASHBOARD</Link>
          <span style={{ color: '#1a3d28' }}>|</span>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>CAM-01 · MY PARKING LOT</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ color: '#3a8c60', fontSize: 11, letterSpacing: 1 }}><Clock /></span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ label: 'LIVE', on: hlsLive }, { label: 'AI', on: detectionLive }].map(({ label, on }) => (
              <span key={label} style={{ padding: '2px 9px', borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: 1, background: on ? 'rgba(0,255,136,.15)' : 'rgba(255,60,60,.1)', color: on ? '#00ff88' : '#ff4444', border: `1px solid ${on ? 'rgba(0,255,136,.35)' : 'rgba(255,60,60,.3)'}` }}>
                {on ? '●' : '○'} {label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 240px', overflow: 'hidden' }}>

        {/* camera */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'hidden' }}>

          {/* scanlines */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10, backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.07) 2px,rgba(0,0,0,.07) 4px)' }} />

          <div style={{ width: '100%', maxWidth: 960, position: 'relative' }}>
            <div style={{ borderRadius: 4, overflow: 'hidden', background: '#030810', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(0,255,136,.18)', boxShadow: '0 0 60px rgba(0,255,136,.05)' }}>

              {/* HLS video — always mounted, hidden when showing detection frame */}
              <video ref={videoRef} muted playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: (!showDetection && hlsLive) ? 'block' : 'none' }} />

              {/* Detection frame */}
              {showDetection && detectionFrame && (
                <img src={detectionFrame} alt="detection" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              )}

              {/* No signal */}
              {!hlsLive && !detectionFrame && (
                <div style={{ textAlign: 'center', zIndex: 2 }}>
                  <div style={{ color: 'rgba(0,255,136,.25)', fontSize: 42, marginBottom: 10 }}>⬛</div>
                  <div style={{ color: 'rgba(0,255,136,.45)', fontSize: 12, letterSpacing: 2 }}>NO SIGNAL</div>
                  <div style={{ color: 'rgba(0,255,136,.2)', fontSize: 10, marginTop: 6, letterSpacing: 1 }}>Start Larix to stream</div>
                </div>
              )}

              {/* HUD */}
              {(hlsLive || detectionFrame) && (
                <>
                  <div style={{ position: 'absolute', top: 10, left: 12, zIndex: 5, fontSize: 10, color: 'rgba(0,255,136,.65)', letterSpacing: 1, textShadow: '0 0 8px rgba(0,255,136,.6)' }}>
                    {showDetection ? 'YOLO11x · DETECTION VIEW' : 'LIVE · LARIX RTMP → HLS'}
                  </div>
                  <div style={{ position: 'absolute', bottom: 10, left: 12, zIndex: 5, fontSize: 11, color: 'rgba(0,255,136,.6)', letterSpacing: 1 }}>
                    VEHICLES: <span style={{ color: barColor, fontWeight: 700 }}>{occ?.count ?? '—'}</span>
                  </div>
                  <div style={{ position: 'absolute', bottom: 10, right: 12, zIndex: 5, fontSize: 11, color: 'rgba(0,255,136,.6)', letterSpacing: 1 }}>
                    IN-LOT: <span style={{ color: '#00ff88', fontWeight: 700 }}>{inside}</span>{cap != null && <span style={{ color: 'rgba(0,255,136,.35)' }}> / {cap}</span>}
                  </div>
                </>
              )}
            </div>

            {/* view toggle */}
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center' }}>
              {[{ label: '▶ LIVE FEED', val: false }, { label: '⬡ DETECTION VIEW', val: true }].map(({ label, val }) => (
                <button key={label} onClick={() => setShowDetection(val)} style={{ cursor: 'pointer', border: `1px solid ${showDetection === val ? 'rgba(0,255,136,.5)' : 'rgba(0,255,136,.15)'}`, background: showDetection === val ? 'rgba(0,255,136,.12)' : 'transparent', color: showDetection === val ? '#00ff88' : 'rgba(0,255,136,.4)', borderRadius: 3, padding: '5px 14px', fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* side panel */}
        <aside style={{ borderLeft: '1px solid rgba(0,255,136,.08)', padding: '20px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: 'rgba(0,255,136,.4)', marginBottom: 6 }}>OCCUPANCY</div>
            <div style={{ fontSize: 52, fontWeight: 700, lineHeight: 1, color: barColor, letterSpacing: -1 }}>
              {pct}<span style={{ fontSize: 16, color: 'rgba(0,255,136,.35)' }}>%</span>
            </div>
            <div style={{ marginTop: 8, height: 5, background: 'rgba(0,255,136,.08)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 2, transition: 'width .5s ease' }} />
            </div>
            <div style={{ marginTop: 5, fontSize: 10, color: 'rgba(0,255,136,.35)', letterSpacing: 1 }}>{inside} PARKED · {cap != null ? cap - inside : '?'} OPEN</div>
          </div>

          <div style={{ borderTop: '1px solid rgba(0,255,136,.07)' }} />

          {[
            ['DETECTED', occ?.count ?? '—'],
            ['IN-LOT', inside],
            ['CAPACITY', cap ?? '—'],
            ['PEAK', occ?.peak ?? '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: 'rgba(0,255,136,.3)', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#00ff88' }}>{value}</div>
            </div>
          ))}

          <div style={{ borderTop: '1px solid rgba(0,255,136,.07)' }} />

          {[
            ['VIDEO', hlsLive ? 'LIVE' : 'OFFLINE'],
            ['AI UPDATE', ago != null ? `${ago}s AGO` : '—'],
            ['INFER SIZE', '640px'],
            ['MODEL', 'YOLO11x'],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, letterSpacing: .5 }}>
              <span style={{ color: 'rgba(0,255,136,.3)' }}>{label}</span>
              <span style={{ color: 'rgba(0,255,136,.65)' }}>{value}</span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
