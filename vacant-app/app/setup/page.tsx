'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { DrawnStall, DrawnRoad } from './LotEditor';

const LotEditor = dynamic(() => import('./LotEditor'), {
  ssr: false,
  loading: () => (
    <div style={{ background: '#0d1b2a', borderRadius: 14, aspectRatio: '16/9',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5568', fontSize: 13 }}>
      Loading editor…
    </div>
  ),
});

const GREEN = '#10b981';
const DARK  = '#0d1b2a';
const FONT  = 'var(--font-geist-sans), system-ui, sans-serif';

type LotData  = { id: string; name: string; url: string };
type OccData  = { ts: number; count: number; inside: number | null; capacity: number | null; image: string | null };

// ── small shared components ───────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1800); }}
      style={{ border: 'none', background: ok ? '#d1fae5' : '#e8edf1', color: ok ? '#047857' : '#6b7a8d',
        borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
      {ok ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function Code({ label, text }: { label?: string; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f7f9fb', borderRadius: 10, padding: '10px 14px', border: '1px solid #e7ecf0' }}>
        <code style={{ flex: 1, fontSize: 13, color: DARK, fontFamily: 'monospace', wordBreak: 'break-all' }}>{text}</code>
        <CopyBtn text={text} />
      </div>
    </div>
  );
}

function Block({ n, title, note, children }: { n: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#ecfdf5', color: '#059669',
        fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 3 }}>
        {n}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, color: DARK, marginBottom: note ? 3 : 8 }}>{title}</div>
        {note && <div style={{ fontSize: 13, color: '#6b7a8d', marginBottom: 10, lineHeight: 1.65 }}>{note}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
      </div>
    </div>
  );
}

function StepDot({ i, step, label }: { i: number; step: number; label: string }) {
  const done   = step > i;
  const active = step === i;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 12, fontWeight: 800,
        background: done ? GREEN : active ? DARK : '#f0f4f6',
        color: done || active ? '#fff' : '#9aa6b2',
        boxShadow: active ? `0 0 0 4px rgba(16,185,129,.18)` : 'none',
        transition: 'all .2s',
      }}>
        {done ? '✓' : i + 1}
      </div>
      <span style={{ fontSize: 13.5, fontWeight: active ? 700 : 500, color: active ? DARK : done ? '#6b7a8d' : '#9aa6b2' }}>
        {label}
      </span>
    </div>
  );
}

// ── main wizard ───────────────────────────────────────────────────────────

const STEPS = ['Name your lot', 'Set up streaming', 'Connect camera', 'Map your lot', 'Done!'];

export default function SetupPage() {
  const [step,     setStep]     = useState(0);
  const [lot,      setLot]      = useState<LotData | null>(null);
  const [occ,      setOcc]      = useState<OccData | null>(null);
  const [name,     setName]     = useState('');
  const [creating, setCreating] = useState(false);
  const [createErr,setCreateErr]= useState<string | null>(null);
  const [network,  setNetwork]  = useState<'local' | 'remote'>('local');
  const [localIp,  setLocalIp]  = useState('192.168.1.X');

  // drawn layout + the pixel dimensions of the detection image it was drawn on
  const [drawnStalls,  setDrawnStalls]  = useState<DrawnStall[]>([]);
  const [drawnRoads,   setDrawnRoads]   = useState<DrawnRoad[]>([]);
  const [drawFrameW,   setDrawFrameW]   = useState(800);
  const [drawFrameH,   setDrawFrameH]   = useState(450);
  const [saving, setSaving] = useState(false);

  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const connected = occ && Date.now() - occ.ts < 15_000;

  // poll occupancy once we have a lot
  useEffect(() => {
    if (!lot) return;
    const poll = async () => {
      try {
        const data = await fetch('/api/occupancy', { cache: 'no-store' }).then(r => r.json());
        if (data[lot.id]) setOcc(data[lot.id]);
      } catch {}
    };
    poll();
    pollRef.current = setInterval(poll, 1500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [lot]);

  // auto-advance from connect → map when stream detected
  useEffect(() => {
    if (step === 2 && connected) {
      const t = setTimeout(() => setStep(3), 1000);
      return () => clearTimeout(t);
    }
  }, [step, connected]);

  // ── step 0: create lot ───────────────────────────────────────────────────
  async function createLot() {
    if (!name.trim()) return;
    setCreating(true); setCreateErr(null);
    try {
      // derive ID client-side to build stream URL
      const id = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'LOT';
      const r  = await fetch('/api/lots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: `rtmp://localhost:1935/live/${id}`, capacity: 0 }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || 'failed');
      const lots: LotData[] = await fetch('/api/lots').then(r => r.json());
      const created = lots.find(l => l.id === j.id) ?? { id: j.id, name: name.trim(), url: `rtmp://localhost:1935/live/${j.id}` };
      setLot(created);
      setStep(1);
    } catch (err) { setCreateErr(String(err)); }
    finally { setCreating(false); }
  }

  // ── step 3: save drawn layout ────────────────────────────────────────────
  async function saveLayout() {
    if (!lot) return;
    setSaving(true);

    // Convert DrawnStall rectangles → calib stall polygon format
    const stalls = drawnStalls.map(s => ({
      poly: [
        [Math.round(s.x),         Math.round(s.y)],
        [Math.round(s.x + s.w),   Math.round(s.y)],
        [Math.round(s.x + s.w),   Math.round(s.y + s.h)],
        [Math.round(s.x),         Math.round(s.y + s.h)],
      ] as [number, number][],
    }));
    const roads = drawnRoads.map(r => ({
      line: [[Math.round(r.x1), Math.round(r.y1)], [Math.round(r.x2), Math.round(r.y2)]] as [number, number][],
    }));

    await fetch('/api/lots', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: lot.id,
        stalls: stalls.length ? stalls : null,
        roads,
        capacity: stalls.length,
        // pixel dimensions of detection image the stalls were drawn on — push.py scales to actual frame
        _stall_draw_width:  drawFrameW,
        _stall_draw_height: drawFrameH,
      }),
    });
    setSaving(false);
    setStep(4);
  }

  const rtmpPath  = lot ? `/live/${lot.id}` : '/live/YOUR_LOT_ID';
  const localUrl  = `rtmp://${localIp}:1935${rtmpPath}`;

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#eef3f1', fontFamily: FONT, color: DARK }}>
      {/* header */}
      <header style={{ padding: '16px 28px', background: '#fff', borderBottom: '1px solid #e7ecf0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" style={{ textDecoration: 'none', fontWeight: 800, fontSize: 20, color: DARK, letterSpacing: '-.3px' }}>
          Vac<span style={{ color: GREEN }}>ant</span>
        </Link>
        <Link href="/manage" style={{ fontSize: 13, fontWeight: 600, color: '#6b7a8d', textDecoration: 'none' }}>
          ← Back to Lot Manager
        </Link>
      </header>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 20px',
        display: 'grid', gridTemplateColumns: '200px 1fr', gap: 40, alignItems: 'start' }}>

        {/* step sidebar */}
        <div style={{ position: 'sticky', top: 40, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 2 }}>Setup wizard</div>
          {STEPS.map((label, i) => <StepDot key={i} i={i} step={step} label={label} />)}

          {lot && (
            <div style={{ marginTop: 12, background: '#ecfdf5', borderRadius: 12, padding: '12px 14px',
              border: '1px solid #a7f3d0', fontSize: 12.5, color: '#065f46', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Lot ID</div>
              <code style={{ fontFamily: 'monospace', fontSize: 12 }}>{lot.id}</code>
            </div>
          )}
        </div>

        {/* step card */}
        <div style={{ background: '#fff', borderRadius: 22, border: '1px solid #e7ecf0',
          padding: '38px 40px', boxShadow: '0 6px 32px rgba(13,27,42,.07)' }}>

          {/* ── STEP 0: name ── */}
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
              <Heading title="Name your parking lot"
                sub="This shows up on the dashboard. You can always rename it later." />

              <Field label="Lot name">
                <input autoFocus value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createLot()}
                  placeholder="e.g. HW Parking 2, Main Street Lot"
                  style={inputStyle()} />
              </Field>

              {createErr && <Err msg={createErr} />}

              <Btn onClick={createLot} disabled={!name.trim() || creating} loading={creating}>
                Continue →
              </Btn>
            </div>
          )}

          {/* ── STEP 1: stream setup ── */}
          {step === 1 && lot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
              <Heading title="Set up your camera stream"
                sub="You'll stream from the Larix app (free, iOS & Android) to this computer. Pick where you'll be streaming from:" />

              {/* local vs remote toggle */}
              <div style={{ display: 'flex', background: '#f0f4f6', borderRadius: 12, padding: 4, gap: 0 }}>
                {(['local', 'remote'] as const).map(v => (
                  <button key={v} onClick={() => setNetwork(v)} style={{
                    flex: 1, border: 'none', borderRadius: 10, padding: '10px', fontSize: 14, fontWeight: 700,
                    cursor: 'pointer', transition: 'all .15s',
                    background: network === v ? '#fff' : 'transparent',
                    color: network === v ? DARK : '#9aa6b2',
                    boxShadow: network === v ? '0 2px 8px rgba(13,27,42,.1)' : 'none',
                  }}>
                    {v === 'local' ? '📶  Same WiFi (easiest)' : '🌐  Remote / cellular'}
                  </button>
                ))}
              </div>

              {network === 'local' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                  <Block n="1" title="Install mediamtx — the RTMP receiver"
                    note="This runs on your Mac or PC and accepts the video from your phone.">
                    <Code text="brew install mediamtx" />
                    <Code label="Then start it in a terminal:" text="mediamtx" />
                    <Note>Keep this terminal window open while streaming.</Note>
                  </Block>

                  <Block n="2" title="Find your computer's local IP address">
                    <Code label="Run in a new terminal:" text="ipconfig getifaddr en0" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                      <span style={{ fontSize: 13, color: '#6b7a8d', flexShrink: 0 }}>Your IP:</span>
                      <input value={localIp} onChange={e => setLocalIp(e.target.value)}
                        style={{ ...inputStyle(), width: 180, padding: '7px 10px', fontSize: 13, fontFamily: 'monospace' }} />
                      <span style={{ fontSize: 12, color: '#9aa6b2' }}>← enter it here</span>
                    </div>
                  </Block>

                  <Block n="3" title="Open Larix Broadcaster on your phone"
                    note="Go to Settings → Connections → + (new connection) and enter these values:">
                    <Code label="Stream URL" text={localUrl} />
                    <Note>Connection type: <b>RTMP</b> · Name: anything you like</Note>
                    <Note warn>Make sure your phone and this computer are on the <b>same WiFi</b>.</Note>
                  </Block>

                  <Block n="4" title="Start the AI detection worker"
                    note="Run this in your project folder. Keep it running while the lot is being monitored.">
                    <Code label="Run in terminal:" text="python scripts/push.py" />
                  </Block>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                  <Note warn>Remote streaming lets your phone stream from any network — cellular, different WiFi, etc.
                    Uses Cloudflare Tunnel (free, no card).</Note>

                  <Block n="1" title="Install cloudflared">
                    <Code text="brew install cloudflared" />
                  </Block>

                  <Block n="2" title="Open a tunnel to your RTMP port"
                    note="Run this and leave it open. Cloudflare will print a public URL.">
                    <Code text="cloudflared tunnel --url tcp://localhost:1935" />
                    <Note>The URL looks like <code style={monoSnip()}>tcp://abc123.cfargotunnel.com:443</code><br />
                      Copy just the host and port part — you'll use it in the next step.</Note>
                  </Block>

                  <Block n="3" title="Set Larix stream URL to the tunnel address"
                    note="In Larix → Settings → Connections → new. Replace HOST:PORT with what Cloudflare gave you:">
                    <Code label="Stream URL template" text={`rtmp://HOST:PORT${rtmpPath}`} />
                  </Block>

                  <Block n="4" title="Start the AI detection worker">
                    <Code label="Run in your project folder:" text="python scripts/push.py" />
                    <Note>Also update the lot's stream URL in Lot Manager to use <code style={monoSnip()}>rtmp://localhost:1935{rtmpPath}</code> (the worker reads locally via mediamtx).</Note>
                  </Block>
                </div>
              )}

              <Btn onClick={() => setStep(2)}>I've started streaming — check connection →</Btn>
            </div>
          )}

          {/* ── STEP 2: verify connection ── */}
          {step === 2 && lot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <Heading title="Waiting for your camera stream…"
                sub="Point your phone at the parking lot and press Start in Larix. The status below updates live." />

              <LiveStatus connected={!!connected} count={occ?.count ?? null} />

              {occ?.image && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase',
                    letterSpacing: '1px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN, display: 'inline-block' }} />
                    Live detection preview
                  </div>
                  <div style={{ borderRadius: 14, overflow: 'hidden', border: `2px solid ${GREEN}`, aspectRatio: '16/9' }}>
                    <img src={occ.image} alt="live" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ fontSize: 12, color: '#9aa6b2', marginTop: 6 }}>
                    The AI is already detecting vehicles. Next you'll draw stall boundaries.
                  </div>
                </div>
              )}

              <Checklist items={[
                { label: 'mediamtx is running', done: !!connected, hint: 'Run mediamtx in a terminal' },
                { label: 'Larix is streaming',  done: !!connected, hint: `Check stream URL ends with ${rtmpPath}` },
                { label: 'push.py is running',  done: !!connected, hint: 'Run python scripts/push.py' },
              ]} />

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setStep(1)} style={secondaryBtn()}>← Back</button>
                <Btn onClick={() => setStep(3)}>
                  {connected ? 'Stream detected — continue →' : 'Skip for now →'}
                </Btn>
              </div>
            </div>
          )}

          {/* ── STEP 3: map your lot ── */}
          {step === 3 && lot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <Heading title="Map your parking lot"
                sub="Draw where your parking stalls and roads are. The AI will use this exact layout to track occupancy — no guesswork." />

              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12,
                padding: '12px 16px', fontSize: 13, color: '#166534', lineHeight: 1.7 }}>
                <b>How to use:</b> Select <b>Parking Stall</b>, then click and drag to draw a rectangle over each spot
                on the camera image. Draw <b>Road / Lane</b> lines for driving areas. The AI will immediately
                know exactly where every stall is.
              </div>

              <LotEditor
                imageUrl={occ?.image ?? null}
                onChange={(stalls, roads, fw, fh) => {
                  setDrawnStalls(stalls); setDrawnRoads(roads);
                  setDrawFrameW(fw); setDrawFrameH(fh);
                }}
              />

              {drawnStalls.length === 0 && (
                <Note warn>
                  No stalls drawn yet. You can also skip this and let the AI auto-detect stalls
                  by watching where cars park — it takes a few minutes of live traffic.
                </Note>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setStep(2)} style={secondaryBtn()}>← Back</button>
                <Btn onClick={saveLayout} loading={saving}
                  disabled={saving}>
                  {drawnStalls.length > 0
                    ? `Save ${drawnStalls.length} stall${drawnStalls.length !== 1 ? 's' : ''} & finish →`
                    : 'Skip — auto-detect stalls →'}
                </Btn>
              </div>
            </div>
          )}

          {/* ── STEP 4: done ── */}
          {step === 4 && lot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28, textAlign: 'center', padding: '10px 0' }}>
              <div>
                <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
                <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: '-.5px' }}>
                  {lot.name} is live!
                </div>
                <div style={{ color: '#6b7a8d', fontSize: 15, marginTop: 10, lineHeight: 1.7, maxWidth: 440, margin: '10px auto 0' }}>
                  {drawnStalls.length > 0
                    ? `${drawnStalls.length} stalls are mapped. The AI will track each one in real time.`
                    : 'The AI will auto-detect stall boundaries as cars park over the next few minutes.'}
                </div>
              </div>

              {occ?.image && (
                <div style={{ borderRadius: 16, overflow: 'hidden', border: `3px solid ${GREEN}`,
                  aspectRatio: '16/9', maxWidth: 520, margin: '0 auto', width: '100%' }}>
                  <img src={occ.image} alt="live" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link href="/" style={{ padding: '13px 26px', borderRadius: 12,
                  background: 'linear-gradient(160deg,#10b981,#059669)', color: '#fff',
                  fontWeight: 700, fontSize: 15, textDecoration: 'none',
                  boxShadow: '0 4px 16px rgba(16,185,129,.3)' }}>
                  Go to Dashboard
                </Link>
                <Link href="/manage" style={{ padding: '13px 26px', borderRadius: 12,
                  background: '#f0f4f6', color: DARK, fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>
                  Lot Manager
                </Link>
                <button onClick={() => { setStep(0); setLot(null); setName(''); setDrawnStalls([]); setDrawnRoads([]); setOcc(null); }}
                  style={{ padding: '13px 26px', borderRadius: 12, border: '1.5px solid #e1e7ec',
                    background: '#fff', color: '#6b7a8d', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                  Add another lot
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── small sub-components ──────────────────────────────────────────────────

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 23, letterSpacing: '-.4px' }}>{title}</div>
      <div style={{ color: '#6b7a8d', fontSize: 14, marginTop: 7, lineHeight: 1.65 }}>{sub}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 11.5, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase', letterSpacing: '1px' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return <div style={{ color: '#ef4444', fontSize: 13, fontWeight: 600, background: '#fff5f5', borderRadius: 8, padding: '8px 12px' }}>{msg}</div>;
}

function Note({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <div style={{ fontSize: 12.5, color: warn ? '#92400e' : '#6b7a8d', lineHeight: 1.65,
      background: warn ? '#fffbeb' : '#f7f9fb', borderRadius: 9, padding: '9px 13px',
      border: warn ? '1px solid #fde68a' : '1px solid #e7ecf0' }}>
      {children}
    </div>
  );
}

function Btn({ onClick, disabled, loading, children }: {
  onClick?: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled || loading}
      style={{ border: 'none', borderRadius: 12, padding: '13px 20px', fontSize: 15, fontWeight: 700,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        background: disabled || loading ? '#a7f3d0' : 'linear-gradient(160deg,#10b981,#059669)',
        color: '#fff', boxShadow: disabled || loading ? 'none' : '0 4px 16px rgba(16,185,129,.3)',
        transition: 'all .15s' }}>
      {loading ? 'Saving…' : children}
    </button>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    border: '2px solid #e1e7ec', borderRadius: 11, padding: '11px 14px', fontSize: 15,
    outline: 'none', color: DARK, transition: 'border-color .15s', width: '100%',
    boxSizing: 'border-box', fontFamily: 'inherit',
  };
}

function secondaryBtn(): React.CSSProperties {
  return {
    border: '1.5px solid #e1e7ec', background: '#fff', color: '#6b7a8d',
    borderRadius: 12, padding: '13px 18px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
  };
}

function monoSnip(): React.CSSProperties {
  return { background: '#f0f4f6', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12 };
}

function LiveStatus({ connected, count }: { connected: boolean; count: number | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: connected ? '#f0fdf4' : '#f8fafc',
      borderRadius: 16, padding: '18px 22px', border: `2px solid ${connected ? '#86efac' : '#e1e7ec'}`, transition: 'all .3s' }}>
      <div style={{ fontSize: 40, transition: 'all .3s' }}>{connected ? '✅' : '⏳'}</div>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, color: connected ? '#065f46' : '#4a5568' }}>
          {connected ? 'Stream connected!' : 'Waiting for stream…'}
        </div>
        <div style={{ fontSize: 13, color: '#6b7a8d', marginTop: 3 }}>
          {connected
            ? `${count ?? 0} vehicle${count !== 1 ? 's' : ''} detected · advancing automatically…`
            : 'Make sure Larix is streaming and push.py is running.'}
        </div>
      </div>
    </div>
  );
}

function Checklist({ items }: { items: { label: string; done: boolean; hint: string }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>
        Checklist
      </div>
      {items.map(({ label, done, hint }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '10px 12px', borderRadius: 10, background: done ? '#f0fdf4' : '#fafafa',
          border: `1px solid ${done ? '#86efac' : '#e7ecf0'}`, transition: 'all .3s' }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800,
            background: done ? GREEN : '#e8edf1', color: done ? '#fff' : '#9aa6b2', transition: 'all .3s' }}>
            {done ? '✓' : '○'}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: done ? '#065f46' : '#4a5568' }}>{label}</div>
            {!done && <div style={{ fontSize: 12, color: '#9aa6b2', marginTop: 2 }}>{hint}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
