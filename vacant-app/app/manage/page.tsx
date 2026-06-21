'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Occ = {
  ts: number; id: string; name: string; inside: number | null;
  capacity: number | null; stalls: unknown[] | null; image: string | null;
};
type Calib = { id: string; name: string; url: string; capacity: number; stalls?: unknown[] | null };

const FONT  = 'var(--font-geist-sans), system-ui, sans-serif';
const GREEN = '#10b981';
const DARK  = '#0d1b2a';

// ── tiny helpers ────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      style={{ border: 'none', background: copied ? '#d1fae5' : '#f0f4f6', color: copied ? '#047857' : '#6b7a8d',
        borderRadius: 7, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// ── lot card ─────────────────────────────────────────────────────────────────

function LotCard({ calib, occ, onDelete, onRefresh }: {
  calib: Calib; occ: Occ | null; onDelete: () => void; onRefresh: () => void;
}) {
  const [editing,   setEditing]   = useState(false);
  const [name,      setName]      = useState(calib.name);
  const [url,       setUrl]       = useState(calib.url);
  const [cap,       setCap]       = useState(String(calib.capacity || ''));
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [recal,     setRecal]     = useState(false);
  const [recalDone, setRecalDone] = useState(false);
  const [showImg,   setShowImg]   = useState(false);

  const live      = occ && Date.now() - occ.ts < 15_000;
  const hasStalls = !!(occ?.stalls?.length || calib.stalls?.length);
  const taken     = occ?.stalls ? occ.stalls.filter((s: any) => s.taken).length : (occ?.inside ?? null);
  const cap2      = occ?.stalls?.length ?? occ?.capacity ?? calib.capacity ?? null;
  const open      = cap2 != null && taken != null ? cap2 - taken : null;

  const health = [
    { label: 'Stream', ok: !!live },
    { label: 'AI',     ok: !!live },
    { label: 'Stalls', ok: hasStalls },
  ];

  async function save() {
    setSaving(true);
    await fetch('/api/lots', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: calib.id, name, url, capacity: Number(cap) || 0 }),
    });
    setSaving(false); setEditing(false); onRefresh();
  }

  async function del() {
    if (!confirm(`Delete "${calib.name}"? This removes the calib file permanently.`)) return;
    setDeleting(true);
    await fetch(`/api/lots?id=${calib.id}`, { method: 'DELETE' });
    onDelete();
  }

  async function recalibrate() {
    setRecal(true); setRecalDone(false);
    await fetch(`/api/recalibrate?id=${calib.id}`, { method: 'POST' });
    setRecal(false); setRecalDone(true);
    setTimeout(() => setRecalDone(false), 3000);
    onRefresh();
  }

  return (
    <div style={{ background: '#fff', borderRadius: 18, border: '1px solid #e7ecf0', overflow: 'hidden',
      boxShadow: '0 2px 14px rgba(13,27,42,.06)', display: 'flex', flexDirection: 'column' }}>

      {/* thumbnail */}
      <div onClick={() => occ?.image && setShowImg(true)} style={{
        background: '#0d1b2a', aspectRatio: '16/9', display: 'flex', alignItems: 'center',
        justifyContent: 'center', cursor: occ?.image ? 'zoom-in' : 'default',
        position: 'relative', overflow: 'hidden' }}>
        {occ?.image
          ? <img src={occ.image} alt="feed" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : (
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#374151', fontSize: 28, marginBottom: 6 }}>📷</div>
              <div style={{ color: '#4a5568', fontSize: 12 }}>no feed yet</div>
            </div>
          )}
        <div style={{ position: 'absolute', top: 8, left: 8, right: 8,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700,
            background: live ? '#10b981' : '#374151', color: '#fff' }}>
            {live ? '● LIVE' : '○ OFFLINE'}
          </span>
          {open != null && (
            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 800,
              background: 'rgba(0,0,0,.55)', color: open > 0 ? '#4ade80' : '#f87171' }}>
              {open} open
            </span>
          )}
        </div>
      </div>

      {/* health bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #f0f4f7' }}>
        {health.map(({ label, ok }) => (
          <div key={label} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 5, padding: '7px 0', fontSize: 11, fontWeight: 700,
            color: ok ? '#059669' : '#9aa6b2',
            borderRight: label !== 'Stalls' ? '1px solid #f0f4f7' : 'none',
            background: ok ? '#f0fdf4' : 'transparent', transition: 'all .3s' }}>
            <span>{ok ? '✓' : '○'}</span> {label}
          </div>
        ))}
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Name',        val: name, set: setName, mono: false },
              { label: 'Stream URL',  val: url,  set: setUrl,  mono: true  },
              { label: 'Stall Count', val: cap,  set: setCap,  mono: false },
            ].map(({ label, val, set, mono }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#9aa6b2',
                  textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</span>
                <input value={val} onChange={e => set(e.target.value)} style={{
                  border: '1.5px solid #e1e7ec', borderRadius: 8, padding: '7px 10px',
                  fontSize: mono ? 12 : 13, fontFamily: mono ? 'monospace' : FONT,
                  outline: 'none', color: DARK }} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={save} disabled={saving} style={{
                flex: 1, border: 'none', background: 'linear-gradient(160deg,#10b981,#059669)', color: '#fff',
                borderRadius: 8, padding: '8px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} style={{
                flex: 1, border: '1.5px solid #e1e7ec', background: 'transparent', color: '#6b7a8d',
                borderRadius: 8, padding: '8px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15.5, color: DARK }}>{calib.name}</div>
                <div style={{ fontSize: 11, color: '#9aa6b2', fontFamily: 'monospace', marginTop: 2 }}>{calib.id}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f7f9fb', borderRadius: 8, padding: '7px 10px' }}>
              <span style={{ flex: 1, fontSize: 11.5, fontFamily: 'monospace', color: '#4a5568',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {calib.url}
              </span>
              <CopyBtn text={calib.url} />
            </div>

            {!live && (
              <div style={{ fontSize: 11.5, color: '#9aa6b2', lineHeight: 1.55, background: '#f7f9fb', borderRadius: 8, padding: '8px 10px' }}>
                Offline — start streaming and run <code style={{ background: '#e8edf1', padding: '1px 4px', borderRadius: 4 }}>push.py</code> to go live.
                {' '}<Link href="/setup" style={{ color: GREEN, fontWeight: 700, textDecoration: 'none' }}>Setup guide →</Link>
              </div>
            )}

            {!hasStalls && live && (
              <div style={{ fontSize: 11.5, color: '#92400e', lineHeight: 1.55, background: '#fffbeb',
                borderRadius: 8, padding: '8px 10px', border: '1px solid #fde68a' }}>
                No stall layout yet.{' '}
                <Link href={`/builder?id=${calib.id}&back=/manage`}
                  style={{ color: '#b45309', fontWeight: 700, textDecoration: 'none' }}>
                  Map stalls in builder →
                </Link>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 2, flexWrap: 'wrap' }}>
              <button onClick={() => setEditing(true)} style={{
                flex: 1, border: '1.5px solid #e1e7ec', background: 'transparent', color: DARK,
                borderRadius: 8, padding: '7px', fontSize: 12, fontWeight: 600, cursor: 'pointer', minWidth: 60 }}>
                Edit
              </button>
              <button onClick={recalibrate} disabled={recal}
                title="Clear learned stall positions and re-detect from scratch"
                style={{ flex: 1, border: '1.5px solid #e1e7ec',
                  background: recalDone ? '#f0fdf4' : 'transparent',
                  color: recalDone ? '#059669' : '#6b7a8d',
                  borderRadius: 8, padding: '7px', fontSize: 12, fontWeight: 600,
                  cursor: recal ? 'wait' : 'pointer', minWidth: 60 }}>
                {recal ? '…' : recalDone ? '✓ Reset' : '↺ Recal'}
              </button>
              <button onClick={del} disabled={deleting} style={{
                flex: 1, border: '1.5px solid #fee2e2', background: '#fff5f5', color: '#dc2626',
                borderRadius: 8, padding: '7px', fontSize: 12, fontWeight: 600, cursor: 'pointer', minWidth: 60 }}>
                {deleting ? '…' : 'Delete'}
              </button>
            </div>
          </>
        )}
      </div>

      {showImg && occ?.image && (
        <div onClick={() => setShowImg(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
          <img src={occ.image} alt="full" style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 12 }} />
        </div>
      )}
    </div>
  );
}

// ── quick-add side panel ──────────────────────────────────────────────────────

type MBrand = {
  id: string; name: string; emoji: string;
  buildUrl: (ip: string, user: string, pass: string) => string;
  defaultUser: string;
  needsIp: boolean;
};

const MINI_BRANDS: MBrand[] = [
  { id: 'reolink',   name: 'Reolink',   emoji: '🟠', defaultUser: 'admin',
    needsIp: true,
    buildUrl: (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/h264Preview_01_main` },
  { id: 'hikvision', name: 'Hikvision', emoji: '🔵', defaultUser: 'admin',
    needsIp: true,
    buildUrl: (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/Streaming/Channels/101` },
  { id: 'dahua',     name: 'Dahua',     emoji: '🟢', defaultUser: 'admin',
    needsIp: true,
    buildUrl: (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/cam/realmonitor?channel=1&subtype=0` },
  { id: 'amcrest',   name: 'Amcrest',   emoji: '🟡', defaultUser: 'admin',
    needsIp: true,
    buildUrl: (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/cam/realmonitor?channel=1&subtype=0` },
  { id: 'axis',      name: 'Axis',      emoji: '⬛', defaultUser: 'root',
    needsIp: true,
    buildUrl: (ip, u, p) => `rtsp://${u}:${p}@${ip}:554/axis-media/media.amp` },
  { id: 'phone',     name: 'Phone',     emoji: '📱', defaultUser: '',
    needsIp: false,
    buildUrl: () => 'rtmp://localhost:1935/live/lot' },
  { id: 'custom',    name: 'Custom',    emoji: '🔧', defaultUser: '',
    needsIp: false,
    buildUrl: () => '' },
];

const EMPTY_FORM = { name: '', url: '', capacity: '' };

function QuickAddPanel({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const router   = useRouter();
  const [form,   setForm]    = useState(EMPTY_FORM);
  const [adding, setAdding]  = useState(false);
  const [err,    setErr]     = useState<string | null>(null);
  const [done,   setDone]    = useState<string | null>(null);
  const nameRef  = useRef<HTMLInputElement>(null);

  // camera quick-connect state
  const [brand,    setBrand]    = useState<MBrand | null>(null);
  const [camIp,    setCamIp]    = useState('');
  const [camUser,  setCamUser]  = useState('admin');
  const [camPass,  setCamPass]  = useState('');
  const [showPass, setShowPass] = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [testRes,  setTestRes]  = useState<{ ok: boolean; frame?: boolean; width?: number; height?: number; error?: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [foundIps, setFoundIps] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setTimeout(() => nameRef.current?.focus(), 280);
      setDone(null); setErr(null);
    } else {
      setBrand(null); setCamIp(''); setCamUser('admin'); setCamPass('');
      setTestRes(null); setFoundIps([]);
    }
  }, [open]);

  // auto-build URL when brand / IP / creds change
  useEffect(() => {
    if (!brand || !brand.needsIp) return;
    if (!camIp) return;
    setForm(f => ({ ...f, url: brand.buildUrl(camIp, camUser, camPass) }));
  }, [brand, camIp, camUser, camPass]);

  function selectBrand(b: MBrand) {
    setBrand(b);
    setCamUser(b.defaultUser);
    setTestRes(null);
    if (!b.needsIp) {
      setForm(f => ({ ...f, url: b.buildUrl('', b.defaultUser, '') }));
    } else {
      setForm(f => ({ ...f, url: '' }));
    }
  }

  async function scanNetwork() {
    setScanning(true); setFoundIps([]);
    try {
      const r = await fetch('/api/discover');
      const j = await r.json();
      setFoundIps(j.found ?? []);
    } catch { setFoundIps([]); }
    finally { setScanning(false); }
  }

  async function testConnection() {
    if (!form.url) return;
    setTesting(true); setTestRes(null);
    try {
      const r = await fetch('/api/camera-test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.url }),
      });
      const j = await r.json();
      setTestRes(j);
    } catch { setTestRes({ ok: false, error: 'request failed' }); }
    finally { setTesting(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true); setErr(null);
    try {
      const r = await fetch('/api/lots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, url: form.url, capacity: Number(form.capacity) || 0,
          ...(brand && brand.id !== 'custom' ? { camera_brand: brand.id } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || 'failed');
      setForm(EMPTY_FORM);
      setDone(j.id);
      onCreated();
    } catch (e) { setErr(String(e)); }
    finally { setAdding(false); }
  }

  const inp: React.CSSProperties = {
    border: '1.5px solid #e1e7ec', borderRadius: 10, padding: '9px 12px', fontSize: 13,
    outline: 'none', color: DARK, width: '100%', boxSizing: 'border-box', fontFamily: FONT,
  };

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(13,27,42,.45)', zIndex: 98,
          backdropFilter: 'blur(3px)', opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none', transition: 'opacity .25s ease' }}
      />

      {/* panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 440,
        background: '#fff', zIndex: 99, overflowY: 'auto',
        boxShadow: '-10px 0 50px rgba(13,27,42,.18)',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform .28s cubic-bezier(.25,.46,.45,.94)',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* panel header */}
        <div style={{ padding: '22px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 19, color: DARK, letterSpacing: '-.3px' }}>Quick Add Lot</div>
            <div style={{ fontSize: 13, color: '#9aa6b2', marginTop: 3 }}>
              {brand ? `${brand.emoji} ${brand.name} — edit URL if needed` : 'Pick a camera brand or paste a URL directly.'}
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: '#f0f4f6', color: '#6b7a8d',
            width: 34, height: 34, borderRadius: '50%', cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            ✕
          </button>
        </div>

        {/* panel body */}
        <div style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {done ? (
            /* success state */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
              textAlign: 'center', paddingTop: 20 }}>
              <div style={{ fontSize: 52 }}>✅</div>
              <div style={{ fontWeight: 800, fontSize: 19, color: DARK }}>Lot created!</div>
              <div style={{ fontSize: 13.5, color: '#6b7a8d', lineHeight: 1.6 }}>
                Start streaming and run <code style={{ background: '#f0f4f6', padding: '2px 6px', borderRadius: 5 }}>push.py</code> to go live.
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button onClick={() => { setDone(null); setBrand(null); setForm(EMPTY_FORM); }} style={{
                  border: '1.5px solid #e1e7ec', background: '#fff', color: DARK,
                  borderRadius: 10, padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                  Add another
                </button>
                <Link href={`/builder?id=${done}&back=/manage`}
                  style={{ borderRadius: 10, padding: '10px 18px', fontSize: 13.5, fontWeight: 700,
                    textDecoration: 'none', background: 'linear-gradient(160deg,#10b981,#059669)', color: '#fff',
                    boxShadow: '0 3px 12px rgba(16,185,129,.3)' }}>
                  Map layout →
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* lot name */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2',
                  textTransform: 'uppercase', letterSpacing: '1px' }}>Lot name</label>
                <input ref={nameRef} required value={form.name} placeholder="e.g. Main Street Lot"
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  style={inp} />
              </div>

              {/* brand picker */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2',
                    textTransform: 'uppercase', letterSpacing: '1px' }}>Camera brand</label>
                  {brand && (
                    <button type="button" onClick={() => { setBrand(null); setForm(f => ({ ...f, url: '' })); setCamIp(''); }}
                      style={{ border: 'none', background: 'none', color: '#9aa6b2', fontSize: 11.5,
                        fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {MINI_BRANDS.map(b => (
                    <button key={b.id} type="button" onClick={() => selectBrand(b)} style={{
                      border: brand?.id === b.id ? `2px solid ${GREEN}` : '1.5px solid #e1e7ec',
                      background: brand?.id === b.id ? '#ecfdf5' : '#fafbfc',
                      borderRadius: 10, padding: '8px 4px', fontSize: 11, fontWeight: 700,
                      color: brand?.id === b.id ? '#047857' : '#4a5568',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column',
                      alignItems: 'center', gap: 3,
                    }}>
                      <span style={{ fontSize: 18 }}>{b.emoji}</span>
                      <span>{b.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* IP + creds (shown when a brand with needsIp is selected) */}
              {brand?.needsIp && (
                <div style={{ background: '#f7f9fb', borderRadius: 12, padding: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#4a5568' }}>Camera IP address</span>
                    <button type="button" onClick={scanNetwork} disabled={scanning}
                      style={{ border: '1.5px solid #e1e7ec', background: '#fff', color: '#4a5568',
                        borderRadius: 8, padding: '4px 11px', fontSize: 11.5, fontWeight: 700,
                        cursor: scanning ? 'wait' : 'pointer' }}>
                      {scanning ? '⏳ Scanning…' : '🔍 Scan network'}
                    </button>
                  </div>

                  {foundIps.length > 0 && (
                    <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {foundIps.map(ip => (
                        <button key={ip} type="button" onClick={() => setCamIp(ip)} style={{
                          border: camIp === ip ? `2px solid ${GREEN}` : '1.5px solid #c5cfd8',
                          background: camIp === ip ? '#ecfdf5' : '#fff',
                          color: camIp === ip ? '#047857' : '#374151',
                          borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          fontFamily: 'monospace',
                        }}>
                          {ip}
                        </button>
                      ))}
                    </div>
                  )}

                  {foundIps.length === 0 && !scanning && (
                    <input
                      value={camIp}
                      onChange={e => setCamIp(e.target.value)}
                      placeholder="192.168.1.x"
                      style={{ ...inp, fontFamily: 'monospace', marginBottom: 8 }}
                    />
                  )}

                  {foundIps.length > 0 && (
                    <input
                      value={camIp}
                      onChange={e => setCamIp(e.target.value)}
                      placeholder="or type IP manually"
                      style={{ ...inp, fontFamily: 'monospace', marginBottom: 8 }}
                    />
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div>
                      <label style={{ fontSize: 10.5, fontWeight: 700, color: '#9aa6b2', display: 'block', marginBottom: 3 }}>Username</label>
                      <input value={camUser} onChange={e => setCamUser(e.target.value)}
                        style={{ ...inp, padding: '7px 10px' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10.5, fontWeight: 700, color: '#9aa6b2', display: 'block', marginBottom: 3 }}>Password</label>
                      <div style={{ position: 'relative' }}>
                        <input
                          type={showPass ? 'text' : 'password'}
                          value={camPass}
                          onChange={e => setCamPass(e.target.value)}
                          placeholder="••••••"
                          style={{ ...inp, padding: '7px 32px 7px 10px' }}
                        />
                        <button type="button" onClick={() => setShowPass(v => !v)}
                          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                            border: 'none', background: 'none', cursor: 'pointer', color: '#9aa6b2', fontSize: 13 }}>
                          {showPass ? '🙈' : '👁'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* stream URL */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2',
                    textTransform: 'uppercase', letterSpacing: '1px' }}>Stream URL</label>
                  {form.url && (
                    <button type="button" onClick={testConnection} disabled={testing || !form.url}
                      style={{ border: '1.5px solid #e1e7ec', background: testing ? '#f0fdf4' : '#fff',
                        color: testing ? '#047857' : '#4a5568', borderRadius: 8, padding: '3px 10px',
                        fontSize: 11.5, fontWeight: 700, cursor: testing ? 'wait' : 'pointer' }}>
                      {testing ? '⏳ Testing…' : '▷ Test'}
                    </button>
                  )}
                </div>
                <input required value={form.url}
                  placeholder={brand?.id === 'phone' ? 'rtmp://localhost:1935/live/lot' : 'rtsp://admin:pass@192.168.1.x:554/stream'}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  style={{ ...inp, fontFamily: 'monospace', fontSize: 12 }} />

                {testRes && (
                  <div style={{
                    padding: '8px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600,
                    background: testRes.ok ? '#f0fdf4' : '#fff5f5',
                    border: `1px solid ${testRes.ok ? '#86efac' : '#fecaca'}`,
                    color: testRes.ok ? '#047857' : '#dc2626',
                  }}>
                    {testRes.ok
                      ? `✓ Connected${testRes.frame ? ` — got a frame (${testRes.width}×${testRes.height})` : ''}`
                      : `✗ ${testRes.error ?? 'Could not connect'}`}
                  </div>
                )}

                <span style={{ fontSize: 11.5, color: '#9aa6b2' }}>
                  RTSP for IP cameras · RTMP for phone streaming
                </span>
              </div>

              {/* stall count */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2',
                  textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Stall count{' '}
                  <span style={{ color: '#c5cfd8', textTransform: 'none', fontWeight: 500 }}>(0 = auto-detect)</span>
                </label>
                <input type="number" min="0" value={form.capacity} placeholder="0"
                  onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                  style={{ ...inp, width: 110 }} />
              </div>

              {err && (
                <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 9,
                  padding: '10px 14px', fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
                  {err}
                </div>
              )}

              <button type="submit" disabled={adding} style={{
                border: 'none', borderRadius: 11, padding: '12px', fontWeight: 700, fontSize: 14,
                cursor: adding ? 'not-allowed' : 'pointer',
                background: adding ? '#a7f3d0' : 'linear-gradient(160deg,#10b981,#059669)',
                color: '#fff', boxShadow: adding ? 'none' : '0 4px 14px rgba(16,185,129,.3)' }}>
                {adding ? 'Creating…' : '+ Create Lot'}
              </button>
            </form>
          )}
        </div>

        {/* panel footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #f0f4f7', flexShrink: 0, display: 'flex', gap: 8 }}>
          <button onClick={() => { onClose(); router.push('/cameras'); }} style={{
            flex: 1, border: '1.5px solid #e1e7ec', background: '#fff', color: '#4a5568',
            borderRadius: 10, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Browse cameras →
          </button>
          <button onClick={() => { onClose(); router.push('/setup'); }} style={{
            flex: 1, border: 'none', background: DARK, color: '#fff',
            borderRadius: 10, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Setup wizard →
          </button>
        </div>
      </div>
    </>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function ManagePage() {
  const router = useRouter();
  const [calibs,     setCAlibs]     = useState<Calib[]>([]);
  const [occ,        setOcc]        = useState<Record<string, Occ>>({});
  const [panelOpen,  setPanelOpen]  = useState(false);
  const [tunnel,     setTunnel]     = useState(false);
  const [userEmail,  setUserEmail]  = useState<string | null>(null);

  // auth — only runs if Supabase env vars are configured
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  async function refresh() {
    const [c, o] = await Promise.all([
      fetch('/api/lots').then(r => r.json()).catch(() => []),
      fetch('/api/occupancy').then(r => r.json()).catch(() => ({})),
    ]);
    setCAlibs(Array.isArray(c) ? c : []);
    setOcc(o || {});
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  // close panel on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanelOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div style={{ minHeight: '100vh',
      background: 'radial-gradient(900px 600px at 78% -8%, rgba(16,185,129,.12), transparent 60%), #eef3f1',
      fontFamily: FONT, color: DARK }}>

      {/* header */}
      <header style={{ padding: '14px 28px', background: '#fff', borderBottom: '1px solid #e7ecf0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ textDecoration: 'none', fontWeight: 800, fontSize: 20, color: DARK, letterSpacing: '-.3px' }}>
            Vac<span style={{ color: GREEN }}>ant</span>
          </Link>
          <span style={{ color: '#c5cfd8' }}>›</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#4a5568' }}>Lot Manager</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {[{ href: '/', label: 'Dashboard' }, { href: '/map', label: 'Map' }, { href: '/cameras', label: 'Cameras' }].map(({ href, label }) => (
            <Link key={href} href={href} style={{ padding: '6px 14px', borderRadius: 9, background: '#f0f4f6',
              color: DARK, fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>{label}</Link>
          ))}

          {/* separator */}
          <div style={{ width: 1, height: 20, background: '#e1e7ec' }} />

          {/* quick-add panel trigger */}
          <button onClick={() => setPanelOpen(true)} style={{
            border: '1.5px solid #e1e7ec', background: '#fff', color: DARK,
            borderRadius: 9, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            + Quick add
          </button>

          {/* wizard button */}
          <button onClick={() => router.push('/setup')} style={{
            border: 'none', borderRadius: 9, padding: '7px 16px', fontSize: 12.5, fontWeight: 700,
            background: 'linear-gradient(160deg,#10b981,#059669)', color: '#fff', cursor: 'pointer',
            boxShadow: '0 3px 10px rgba(16,185,129,.28)' }}>
            + Setup wizard
          </button>

          {/* user badge + sign out */}
          {userEmail && (
            <>
              <div style={{ width: 1, height: 20, background: '#e1e7ec' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ background: '#f0fdf4', border: '1px solid #86efac',
                  borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 600, color: '#047857',
                  maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {userEmail}
                </div>
                <button onClick={signOut} style={{
                  border: '1.5px solid #e1e7ec', background: '#fff', color: '#6b7a8d',
                  borderRadius: 9, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* main content */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px' }}>

        {/* title row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
          <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-.3px' }}>
            Your Lots{' '}
            <span style={{ fontSize: 14, color: '#9aa6b2', fontWeight: 600 }}>
              {calibs.length} configured
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setPanelOpen(true)} style={{
              border: '1.5px solid #e1e7ec', background: '#fff', color: DARK,
              borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              + Quick add
            </button>
            <button onClick={() => router.push('/setup')} style={{
              border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 700,
              background: 'linear-gradient(160deg,#10b981,#059669)', color: '#fff', cursor: 'pointer',
              boxShadow: '0 3px 10px rgba(16,185,129,.28)', display: 'flex', alignItems: 'center', gap: 6 }}>
              + Set up new lot
            </button>
          </div>
        </div>

        {/* empty state */}
        {calibs.length === 0 && (
          <div style={{ background: '#fff', borderRadius: 18, border: '2px dashed #c5cfd8',
            padding: '60px 24px', textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🅿️</div>
            <div style={{ fontWeight: 800, fontSize: 18, color: DARK, marginBottom: 6 }}>No parking lots yet</div>
            <div style={{ color: '#9aa6b2', fontSize: 14, marginBottom: 24 }}>
              Use the guided wizard for step-by-step setup, or quick-add if you already have a stream URL.
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setPanelOpen(true)} style={{
                border: '1.5px solid #e1e7ec', background: '#fff', color: DARK,
                borderRadius: 12, padding: '11px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                Quick add
              </button>
              <button onClick={() => router.push('/setup')} style={{
                border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 14, fontWeight: 700,
                background: 'linear-gradient(160deg,#10b981,#059669)', color: '#fff', cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(16,185,129,.3)' }}>
                Setup wizard →
              </button>
            </div>
          </div>
        )}

        {/* lot cards grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20, marginBottom: 28 }}>
          {calibs.map(c => (
            <LotCard key={c.id} calib={c} occ={occ[c.id] ?? null} onDelete={refresh} onRefresh={refresh} />
          ))}
        </div>

        {/* cloudflare collapse */}
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e7ecf0', overflow: 'hidden' }}>
          <button onClick={() => setTunnel(t => !t)} style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: FONT, fontWeight: 700, fontSize: 14, color: DARK }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🌐</span>
              Stream from anywhere — Cloudflare Tunnel setup
            </div>
            <span style={{ color: '#9aa6b2', fontSize: 18 }}>{tunnel ? '▲' : '▼'}</span>
          </button>
          {tunnel && (
            <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ margin: 0, color: '#6b7a8d', fontSize: 13, lineHeight: 1.6 }}>
                Cloudflare Tunnel gives you a public URL so you can access your dashboard or stream from anywhere —
                no port forwarding or static IP required. Free, no credit card.
              </p>
              {[
                { step: '1', title: 'Install cloudflared', cmd: 'brew install cloudflared' },
                { step: '2', title: 'Open a tunnel to your dashboard', cmd: 'cloudflared tunnel --url http://localhost:3000' },
                { step: '3', title: 'Optional: tunnel for remote phone streaming', cmd: 'cloudflared tunnel --url tcp://localhost:1935' },
              ].map(({ step, title, cmd }) => (
                <div key={step} style={{ display: 'flex', gap: 12 }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#ecfdf5', color: '#059669',
                    fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {step}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: DARK, marginBottom: 6 }}>{title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f7f9fb', borderRadius: 8, padding: '8px 12px' }}>
                      <code style={{ flex: 1, fontSize: 12, color: '#4a5568', whiteSpace: 'pre' }}>{cmd}</code>
                      <CopyBtn text={cmd} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* slide-in panel */}
      <QuickAddPanel open={panelOpen} onClose={() => setPanelOpen(false)} onCreated={refresh} />
    </div>
  );
}
