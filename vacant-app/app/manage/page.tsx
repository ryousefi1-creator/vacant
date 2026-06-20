'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type Occ = {
  ts: number; id: string; name: string; inside: number | null;
  capacity: number | null; stalls: unknown[] | null; image: string | null;
};
type Calib = { id: string; name: string; url: string; capacity: number };

const FONT = 'var(--font-geist-sans), system-ui, sans-serif';
const GREEN = '#10b981'; const DARK = '#0d1b2a';

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      style={{ border: 'none', background: copied ? '#d1fae5' : '#f0f4f6', color: copied ? '#047857' : '#6b7a8d', borderRadius: 7, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function LotCard({ calib, occ, onDelete }: { calib: Calib; occ: Occ | null; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(calib.name);
  const [url, setUrl] = useState(calib.url);
  const [cap, setCap] = useState(String(calib.capacity || ''));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showImg, setShowImg] = useState(false);

  const live = occ && Date.now() - occ.ts < 15_000;
  const taken = occ?.stalls ? occ.stalls.filter((s: any) => s.taken).length : (occ?.inside ?? null);
  const cap2 = occ?.stalls?.length ?? occ?.capacity ?? calib.capacity ?? null;
  const open = cap2 != null && taken != null ? cap2 - taken : null;

  async function save() {
    setSaving(true);
    await fetch('/api/lots', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: calib.id, name, url, capacity: Number(cap) || 0 }) });
    setSaving(false); setEditing(false);
  }

  async function del() {
    if (!confirm(`Delete "${calib.name}"? This removes the calib file permanently.`)) return;
    setDeleting(true);
    await fetch(`/api/lots?id=${calib.id}`, { method: 'DELETE' });
    onDelete();
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e7ecf0', overflow: 'hidden',
      boxShadow: '0 2px 12px rgba(13,27,42,.06)', display: 'flex', flexDirection: 'column' }}>

      {/* camera thumbnail — click to enlarge */}
      <div onClick={() => occ?.image && setShowImg(true)} style={{
        background: '#0d1b2a', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: occ?.image ? 'zoom-in' : 'default', position: 'relative', overflow: 'hidden',
      }}>
        {occ?.image
          ? <img src={occ.image} alt="feed" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ color: '#4a5568', fontSize: 12 }}>no feed yet</span>}
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
          <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700,
            background: live ? '#10b981' : '#374151', color: '#fff' }}>
            {live ? '● LIVE' : '○ OFFLINE'}
          </span>
        </div>
      </div>

      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Name', val: name, set: setName, mono: false },
              { label: 'Stream URL', val: url, set: setUrl, mono: true },
              { label: 'Stall Count', val: cap, set: setCap, mono: false },
            ].map(({ label, val, set, mono }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</span>
                <input value={val} onChange={e => set(e.target.value)} style={{
                  border: '1.5px solid #e1e7ec', borderRadius: 8, padding: '7px 10px',
                  fontSize: mono ? 12 : 13, fontFamily: mono ? 'monospace' : FONT,
                  outline: 'none', color: DARK,
                }} />
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
                <div style={{ fontWeight: 800, fontSize: 16, color: DARK }}>{calib.name}</div>
                <div style={{ fontSize: 11, color: '#9aa6b2', fontFamily: 'monospace', marginTop: 2 }}>{calib.id}</div>
              </div>
              {open != null && (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color: open > 0 ? GREEN : '#ef4444', lineHeight: 1 }}>{open}</div>
                  <div style={{ fontSize: 10.5, color: '#9aa6b2', fontWeight: 600 }}>of {cap2} open</div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f7f9fb', borderRadius: 8, padding: '7px 10px' }}>
              <span style={{ flex: 1, fontSize: 11.5, fontFamily: 'monospace', color: '#4a5568', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {calib.url}
              </span>
              <CopyBtn text={calib.url} />
            </div>

            {!live && (
              <div style={{ fontSize: 11.5, color: '#9aa6b2', lineHeight: 1.5 }}>
                Not receiving data — make sure <code style={{ background: '#f0f4f6', padding: '1px 5px', borderRadius: 4 }}>push.py</code> is running and the stream is active.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
              <button onClick={() => setEditing(true)} style={{
                flex: 1, border: '1.5px solid #e1e7ec', background: 'transparent', color: '#0d1b2a',
                borderRadius: 8, padding: '7px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                Edit
              </button>
              <button onClick={del} disabled={deleting} style={{
                flex: 1, border: '1.5px solid #fee2e2', background: '#fff5f5', color: '#dc2626',
                borderRadius: 8, padding: '7px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                {deleting ? '…' : 'Delete'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* full-screen image overlay */}
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

const EMPTY = { name: '', url: '', capacity: '' };

export default function ManagePage() {
  const [calibs, setCAlibs] = useState<Calib[]>([]);
  const [occ, setOcc] = useState<Record<string, Occ>>({});
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [tunnel, setTunnel] = useState(false);

  async function refresh() {
    const [c, o] = await Promise.all([
      fetch('/api/lots').then(r => r.json()).catch(() => []),
      fetch('/api/occupancy').then(r => r.json()).catch(() => ({})),
    ]);
    setCAlibs(Array.isArray(c) ? c : []);
    setOcc(o || {});
  }

  useEffect(() => { refresh(); const id = setInterval(refresh, 4000); return () => clearInterval(id); }, []);

  async function addLot(e: React.FormEvent) {
    e.preventDefault(); setAdding(true); setAddErr(null);
    try {
      const r = await fetch('/api/lots', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, url: form.url, capacity: Number(form.capacity) || 0 }) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || 'failed');
      setForm(EMPTY); refresh();
    } catch (err) { setAddErr(String(err)); }
    finally { setAdding(false); }
  }

  const inp = (extra = {}) => ({
    style: { border: '1.5px solid #e1e7ec', borderRadius: 10, padding: '9px 12px', fontSize: 13,
      fontWeight: 500, outline: 'none', color: DARK, width: '100%', boxSizing: 'border-box' as const, ...extra },
    onFocus: (e: any) => e.target.style.borderColor = GREEN,
    onBlur:  (e: any) => e.target.style.borderColor = '#e1e7ec',
  });

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(900px 600px at 78% -8%, rgba(16,185,129,.12), transparent 60%), #eef3f1',
      fontFamily: FONT, color: DARK }}>

      {/* header */}
      <header style={{ padding: '16px 28px', background: '#fff', borderBottom: '1px solid #e7ecf0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ textDecoration: 'none', fontWeight: 800, fontSize: 20, color: DARK, letterSpacing: '-.3px' }}>
            Vac<span style={{ color: GREEN }}>ant</span>
          </Link>
          <span style={{ color: '#c5cfd8' }}>›</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#4a5568' }}>Lot Manager</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[{href:'/',label:'Dashboard'},{href:'/map',label:'Map'}].map(({href,label}) => (
            <Link key={href} href={href} style={{ padding: '6px 14px', borderRadius: 9, background: '#f0f4f6',
              color: '#0d1b2a', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>{label}</Link>
          ))}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 28, padding: '28px', maxWidth: 1200, margin: '0 auto', alignItems: 'start' }}>

        {/* left — lot cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-.3px' }}>
            Your Lots <span style={{ fontSize: 14, color: '#9aa6b2', fontWeight: 600 }}>{calibs.length} configured</span>
          </div>

          {calibs.length === 0 && (
            <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e7ecf0', padding: '40px 24px', textAlign: 'center', color: '#9aa6b2', fontSize: 14 }}>
              No lots yet — add one using the form →
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 18 }}>
            {calibs.map(c => (
              <LotCard key={c.id} calib={c} occ={occ[c.id] ?? null} onDelete={refresh} />
            ))}
          </div>

          {/* remote access section */}
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e7ecf0', overflow: 'hidden', marginTop: 8 }}>
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
                  By default, your stream only works on the same WiFi network.
                  Cloudflare Tunnel gives you a public RTMP URL so you can stream from anywhere — your phone&apos;s cellular, a different network, etc. Free, no credit card.
                </p>
                {[
                  { step: '1', title: 'Install cloudflared', cmd: 'brew install cloudflared' },
                  { step: '2', title: 'Open a tunnel to your RTMP port', cmd: 'cloudflared tunnel --url tcp://localhost:1935' },
                  { step: '3', title: 'Copy the public URL it prints', cmd: '# e.g. tcp://abc123.cfargotunnel.com:443\n# Use this as your stream host' },
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
                        {!cmd.startsWith('#') && <CopyBtn text={cmd} />}
                      </div>
                    </div>
                  </div>
                ))}
                <div style={{ background: '#fffbeb', borderRadius: 10, padding: '12px 14px', border: '1px solid #fde68a' }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5, color: '#92400e', marginBottom: 4 }}>In Larix Broadcaster</div>
                  <p style={{ margin: 0, fontSize: 12, color: '#78350f', lineHeight: 1.6 }}>
                    Set the stream URL to:<br />
                    <code>rtmp://&lt;your-tunnel-url&gt;/live/HWPARKING1</code><br />
                    (replace <code>localhost:1935</code> with the Cloudflare host:port)
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* right — add form */}
        <div style={{ position: 'sticky', top: 28 }}>
          <form onSubmit={addLot} style={{ background: '#fff', borderRadius: 18, border: '1px solid #e7ecf0',
            padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 16,
            boxShadow: '0 4px 20px rgba(13,27,42,.07)' }}>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-.3px' }}>Add Parking Lot</div>

            {[
              { label: 'Lot Name', key: 'name', placeholder: 'e.g. HWPARKING2', mono: false, required: true },
              { label: 'Stream URL', key: 'url', placeholder: 'rtmp://… or rtsp://…', mono: true, required: true },
            ].map(({ label, key, placeholder, mono, required }) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</label>
                <input required={required} value={(form as any)[key]} placeholder={placeholder}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  {...inp(mono ? { fontFamily: 'monospace', fontSize: 12 } : {})} />
              </div>
            ))}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Stall Count <span style={{ color: '#c5cfd8', textTransform: 'none' }}>(0 = auto-detect)</span>
              </label>
              <input type="number" min="0" value={form.capacity} placeholder="0"
                onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                {...inp()} style={{ ...inp().style, width: 120 }} />
            </div>

            {addErr && <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>{addErr}</div>}

            <button type="submit" disabled={adding} style={{
              border: 'none', padding: '11px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer',
              background: adding ? '#a7f3d0' : 'linear-gradient(160deg,#10b981,#059669)', color: '#fff',
              boxShadow: adding ? 'none' : '0 4px 14px rgba(16,185,129,.3)' }}>
              {adding ? 'Creating…' : '+ Create Lot'}
            </button>

            <div style={{ borderTop: '1px solid #f0f4f7', paddingTop: 14, fontSize: 11.5, color: '#a3adb8', lineHeight: 1.6 }}>
              The lot appears in push.py immediately (no restart). Stall layout is auto-detected, or run{' '}
              <code style={{ background: '#f0f4f6', padding: '1px 5px', borderRadius: 4 }}>stall_vision.py</code>{' '}
              for visual line detection.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
