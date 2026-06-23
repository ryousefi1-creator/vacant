'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Suspense } from 'react';
import Assistant from './Assistant';

const GREEN = '#10b981';
const DARK  = '#0d1b2a';
const FONT  = 'var(--font-geist-sans), system-ui, sans-serif';

// ── camera brand catalog ──────────────────────────────────────────────────────
type Brand = {
  id:          string;
  name:        string;
  emoji:       string;
  tag:         string;
  category:    'Pro / Enterprise' | 'Consumer / Prosumer' | 'Other';
  protocol:    'rtsp' | 'rtmp';
  defaultPort: string;
  defaultUser: string;
  buildUrl:    (ip: string, port: string, user: string, pass: string) => string;
  enableSteps: string[];
  tip?:        string;
  warning?:    string;
};

const BRANDS: Brand[] = [
  {
    id: 'hikvision', name: 'Hikvision', emoji: '🔵',
    tag: 'DS-2CD • DS-2DE • NVR',
    category: 'Pro / Enterprise', protocol: 'rtsp',
    defaultPort: '554', defaultUser: 'admin',
    buildUrl: (ip, port, user, pass) =>
      `rtsp://${user}:${pass}@${ip}:${port}/Streaming/Channels/101`,
    enableSteps: [
      'Open a browser → navigate to http://[camera-IP]',
      'Log in (default: admin / 12345 or admin / admin)',
      'Configuration → Network → Advanced Settings → Integration Protocol',
      'Check "Enable RTSP" — leave port at 554',
      'Click Save (no reboot required on most firmware)',
    ],
    tip: 'NVR channel 1 = /Channels/101, ch 2 = /Channels/201. Sub-stream (faster AI) = /102 or /202.',
  },
  {
    id: 'dahua', name: 'Dahua', emoji: '🟢',
    tag: 'IPC-HDW • SD • NVR',
    category: 'Pro / Enterprise', protocol: 'rtsp',
    defaultPort: '554', defaultUser: 'admin',
    buildUrl: (ip, port, user, pass) =>
      `rtsp://${user}:${pass}@${ip}:${port}/cam/realmonitor?channel=1&subtype=0`,
    enableSteps: [
      'Open browser → http://[camera-IP]',
      'Log in (default: admin / admin — may have been set on first boot)',
      'Setup → Network → Connection → confirm RTSP port 554',
      'RTSP is enabled by default on all Dahua cameras',
    ],
    tip: 'subtype=0 = full HD; subtype=1 = sub-stream (recommended for faster AI detection). NVRs use same URL format.',
  },
  {
    id: 'axis', name: 'Axis', emoji: '⬛',
    tag: 'P-series • Q-series • M-series',
    category: 'Pro / Enterprise', protocol: 'rtsp',
    defaultPort: '554', defaultUser: 'root',
    buildUrl: (ip, port, user, pass) =>
      `rtsp://${user}:${pass}@${ip}:${port}/axis-media/media.amp`,
    enableSteps: [
      'Open browser → http://[camera-IP]',
      'Log in as root (default password is printed on the camera label)',
      'Setup → System Options → Network → RTSP → confirm port 554',
      'RTSP is enabled by default on all Axis cameras',
    ],
    tip: 'Append ?resolution=640x360 to the URL to request a lower resolution for faster detection.',
  },
  {
    id: 'uniview', name: 'Uniview / UNV', emoji: '🟣',
    tag: 'IPC • NVR',
    category: 'Pro / Enterprise', protocol: 'rtsp',
    defaultPort: '554', defaultUser: 'admin',
    buildUrl: (ip, port, user, pass) =>
      `rtsp://${user}:${pass}@${ip}:${port}/media/video1`,
    enableSteps: [
      'Open browser → http://[camera-IP]',
      'Log in (default: admin / 123456)',
      'Configuration → Network → Streaming → RTSP → enable port 554',
      'Click Save and Apply',
    ],
  },
  {
    id: 'hanwha', name: 'Hanwha / Samsung', emoji: '🔷',
    tag: 'XNV • QNV • SNO',
    category: 'Pro / Enterprise', protocol: 'rtsp',
    defaultPort: '554', defaultUser: 'admin',
    buildUrl: (ip, port, user, pass) =>
      `rtsp://${user}:${pass}@${ip}:${port}/profile1/media.smp`,
    enableSteps: [
      'Open browser → http://[camera-IP]',
      'Log in (default: admin / no password, or 4321)',
      'Setup → Network → Network Service → RTSP → enable, port 554',
      'Save — a reboot may be required',
    ],
    tip: '/profile2/media.smp gives lower resolution — better performance for parking AI.',
  },
  {
    id: 'reolink', name: 'Reolink', emoji: '🔴',
    tag: 'RLC • E-series • Duo',
    category: 'Consumer / Prosumer', protocol: 'rtsp',
    defaultPort: '554', defaultUser: 'admin',
    buildUrl: (ip, port, user, pass) =>
      `rtsp://${user}:${pass}@${ip}:${port}/h264Preview_01_main`,
    enableSteps: [
      'Open the Reolink app or camera web interface at http://[camera-IP]',
      'Device Settings → Network → Advanced → enable RTSP',
      'Camera IP is displayed on the app home screen',
      'Password = what you set during initial setup',
    ],
    tip: 'Use /h264Preview_01_sub for lower resolution — recommended for AI detection performance.',
  },
  {
    id: 'amcrest', name: 'Amcrest', emoji: '🟡',
    tag: 'IP8M • ProHD • UHD',
    category: 'Consumer / Prosumer', protocol: 'rtsp',
    defaultPort: '554', defaultUser: 'admin',
    buildUrl: (ip, port, user, pass) =>
      `rtsp://${user}:${pass}@${ip}:${port}/cam/realmonitor?channel=1&subtype=0`,
    enableSteps: [
      'Open browser → http://[camera-IP]',
      'Log in (default: admin / admin)',
      'Setup → Network → More Settings → confirm RTSP port 554',
      'RTSP is enabled by default on all Amcrest cameras',
    ],
    tip: 'Amcrest uses Dahua hardware — RTSP URL format is identical.',
  },
  {
    id: 'wyze', name: 'Wyze Cam', emoji: '⬜',
    tag: 'v3 • Pro • Pan',
    category: 'Consumer / Prosumer', protocol: 'rtsp',
    defaultPort: '554', defaultUser: 'admin',
    buildUrl: (ip, port, user, pass) =>
      `rtsp://${user}:${pass}@${ip}:${port}/live`,
    enableSteps: [
      'Download RTSP firmware from support.wyze.com (search "RTSP firmware download")',
      'In Wyze app: Account → Firmware Upgrade → select the .bin file and flash',
      'After flashing: Device Settings → Advanced Settings → RTSP → Enable',
      'The app will display your stream URL and credentials after enabling',
    ],
    warning: 'Wyze RTSP firmware is unofficial and may disable some Wyze cloud features.',
  },
  {
    id: 'rtsp', name: 'Generic RTSP', emoji: '📡',
    tag: 'ONVIF-compatible',
    category: 'Consumer / Prosumer', protocol: 'rtsp',
    defaultPort: '554', defaultUser: 'admin',
    buildUrl: (ip, port, user, pass) =>
      `rtsp://${user}:${pass}@${ip}:${port}/stream`,
    enableSteps: [
      'Check your camera manual for the exact RTSP URL path',
      'Common paths: /stream  /live  /video1  /h264/ch1/main',
      'ONVIF cameras: try port 80 with path /onvif/media/media.amp',
      'You can paste the full RTSP URL directly using the override option below',
    ],
    tip: 'Any RTSP-capable or ONVIF-compatible camera works. Try /stream first if unsure.',
  },
  {
    id: 'phone', name: 'Phone / Larix App', emoji: '📱',
    tag: 'iOS • Android • RTMP',
    category: 'Other', protocol: 'rtmp',
    defaultPort: '1935', defaultUser: '',
    buildUrl: () => '',
    enableSteps: [],
  },
];

const CAT_ORDER: Brand['category'][] = [
  'Pro / Enterprise',
  'Consumer / Prosumer',
  'Other',
];

// ── types ─────────────────────────────────────────────────────────────────────
type LotData  = { id: string; name: string; url: string };
type OccData  = { ts: number; count: number; image: string | null };
type CamState = {
  brandId:   string;
  ip:        string;
  port:      string;
  user:      string;
  pass:      string;
  useCustom: boolean;
  customUrl: string;
};

// ── shared UI components ───────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1800); }}
      style={{ border: 'none', background: ok ? '#d1fae5' : '#e8edf1', color: ok ? '#047857' : '#6b7a8d',
        borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
      {ok ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function Code({ label, text }: { label?: string; text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase', letterSpacing: '1px' }}>
          {label}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f7f9fb', borderRadius: 10,
        padding: '10px 14px', border: '1px solid #e7ecf0' }}>
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
        fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, marginTop: 3 }}>
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
      <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800,
        background: done ? GREEN : active ? DARK : '#f0f4f6',
        color: done || active ? '#fff' : '#9aa6b2',
        boxShadow: active ? '0 0 0 4px rgba(16,185,129,.18)' : 'none',
        transition: 'all .2s' }}>
        {done ? '✓' : i + 1}
      </div>
      <span style={{ fontSize: 13.5, fontWeight: active ? 700 : 500,
        color: active ? DARK : done ? '#6b7a8d' : '#9aa6b2' }}>
        {label}
      </span>
    </div>
  );
}

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
      <label style={{ fontSize: 11.5, fontWeight: 700, color: '#9aa6b2',
        textTransform: 'uppercase', letterSpacing: '1px' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Err({ msg }: { msg: string }) {
  return (
    <div style={{ color: '#ef4444', fontSize: 13, fontWeight: 600,
      background: '#fff5f5', borderRadius: 8, padding: '8px 12px' }}>
      {msg}
    </div>
  );
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
    outline: 'none', color: DARK, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
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
      <div style={{ fontSize: 40 }}>{connected ? '✅' : '⏳'}</div>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, color: connected ? '#065f46' : '#4a5568' }}>
          {connected ? 'Stream connected!' : 'Waiting for stream…'}
        </div>
        <div style={{ fontSize: 13, color: '#6b7a8d', marginTop: 3 }}>
          {connected
            ? `${count ?? 0} vehicle${count !== 1 ? 's' : ''} detected · advancing automatically…`
            : 'Make sure the camera is reachable and push.py is running.'}
        </div>
      </div>
    </div>
  );
}

function Checklist({ items }: { items: { label: string; done: boolean; hint: string }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#9aa6b2',
        textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>
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

// ── wizard ─────────────────────────────────────────────────────────────────────

const STEPS = [
  'Name',
  'Camera type',
  'Connect camera',
  'Remote access',
  'Verify stream',
  'Map layout',
  'Done!',
];

function SetupWizard() {
  const [step,      setStep]      = useState(0);
  const [lot,       setLot]       = useState<LotData | null>(null);
  const [occ,       setOcc]       = useState<OccData | null>(null);
  const [name,      setName]      = useState('');
  const [creating,  setCreating]  = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [localIp,   setLocalIp]   = useState('192.168.1.X');
  const [showPass,  setShowPass]  = useState(false);
  const [urlSaving, setUrlSaving] = useState(false);
  const [cameraErr, setCameraErr] = useState<string | null>(null);
  const [hoveredBrand, setHoveredBrand] = useState<string | null>(null);
  const [cam, setCam] = useState<CamState>(() => {
    const initBrandId = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('brand') ?? ''
      : '';
    const initBrand = BRANDS.find(b => b.id === initBrandId);
    return {
      brandId: initBrand ? initBrandId : '',
      ip: '', port: initBrand?.defaultPort ?? '554',
      user: initBrand?.defaultUser ?? 'admin',
      pass: '', useCustom: false, customUrl: '',
    };
  });

  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const connected = occ && Date.now() - occ.ts < 15_000;
  const brand     = BRANDS.find(b => b.id === cam.brandId);
  const isPhone   = brand?.protocol === 'rtmp';
  const builtUrl  = (brand && !isPhone)
    ? brand.buildUrl(cam.ip, cam.port, cam.user, cam.pass)
    : '';
  const finalUrl  = cam.useCustom ? cam.customUrl : builtUrl;

  // poll occupancy once lot is created
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

  // auto-advance from verify step when stream is live
  useEffect(() => {
    if (step === 4 && connected) {
      const t = setTimeout(() => setStep(5), 1000);
      return () => clearTimeout(t);
    }
  }, [step, connected]);

  async function createLot() {
    if (!name.trim()) return;
    setCreating(true); setCreateErr(null);
    try {
      const id = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'LOT';
      const r = await fetch('/api/lots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: `rtmp://localhost:1935/live/${id}`, capacity: 0 }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || 'failed');
      const lots: LotData[] = await fetch('/api/lots').then(r => r.json());
      const created = lots.find(l => l.id === j.id) ?? { id: j.id, name: name.trim(), url: '' };
      setLot(created);
      setStep(1);
    } catch (err) { setCreateErr(String(err)); }
    finally { setCreating(false); }
  }

  function selectBrand(id: string) {
    const b = BRANDS.find(br => br.id === id)!;
    setCam(c => ({ ...c, brandId: id, port: b.defaultPort, user: b.defaultUser }));
    setStep(2);
  }

  async function saveCameraAndNext() {
    if (!lot || !brand) return;
    setCameraErr(null);
    if (!isPhone) {
      const urlToCheck = cam.useCustom ? cam.customUrl : builtUrl;
      if (!urlToCheck.startsWith('rtsp://')) {
        setCameraErr('Please enter a valid RTSP URL starting with rtsp://');
        return;
      }
    }
    setUrlSaving(true);
    try {
      const urlToSave = isPhone
        ? `rtmp://localhost:1935/live/${lot.id}`
        : finalUrl;
      const res = await fetch('/api/lots', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lot.id, url: urlToSave, camera_brand: cam.brandId }),
      });
      if (!res.ok) throw new Error('Save failed');
      setStep(3);
    } catch (err) { setCameraErr(String(err)); }
    finally { setUrlSaving(false); }
  }

  const rtmpPath    = lot ? `/live/${lot.id}` : '/live/YOUR_LOT_ID';
  const localRtmpUrl = `rtmp://${localIp}:1935${rtmpPath}`;

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

      <div style={{ maxWidth: 980, margin: '0 auto', padding: '40px 20px',
        display: 'grid', gridTemplateColumns: '200px 1fr', gap: 40, alignItems: 'start' }}>

        {/* sidebar */}
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

          {brand && (
            <div style={{ background: '#f0f4f6', borderRadius: 12, padding: '12px 14px',
              fontSize: 12.5, color: '#4a5568', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>Camera</div>
              {brand.emoji} {brand.name}
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
                sub="This appears on your dashboard. You can rename it later." />
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

          {/* ── STEP 1: brand picker ── */}
          {step === 1 && lot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
              <Heading title="Choose your camera type"
                sub="Select the brand or type of camera you're connecting. This gives you exact setup instructions and a pre-built stream URL." />

              {CAT_ORDER.map(cat => {
                const inCat = BRANDS.filter(b => b.category === cat);
                return (
                  <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2',
                      textTransform: 'uppercase', letterSpacing: '1px' }}>
                      {cat}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 10 }}>
                      {inCat.map(b => (
                        <button
                          key={b.id}
                          onClick={() => selectBrand(b.id)}
                          onMouseEnter={() => setHoveredBrand(b.id)}
                          onMouseLeave={() => setHoveredBrand(null)}
                          style={{
                            border: `2px solid ${hoveredBrand === b.id ? GREEN : '#e7ecf0'}`,
                            borderRadius: 14, padding: '16px 12px',
                            background: hoveredBrand === b.id ? '#f0fdf4' : '#fafafa',
                            cursor: 'pointer', textAlign: 'left', transition: 'all .13s',
                            display: 'flex', flexDirection: 'column', gap: 4,
                          }}>
                          <span style={{ fontSize: 26 }}>{b.emoji}</span>
                          <span style={{ fontWeight: 700, fontSize: 14, color: DARK }}>{b.name}</span>
                          <span style={{ fontSize: 11, color: '#9aa6b2', lineHeight: 1.4 }}>{b.tag}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── STEP 2: camera setup ── */}
          {step === 2 && lot && brand && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ fontSize: 38 }}>{brand.emoji}</div>
                <Heading
                  title={`Connect ${brand.name}`}
                  sub={isPhone
                    ? 'Stream live video from your phone to this computer using the free Larix app (iOS & Android).'
                    : `Enter your camera's network details. The camera must be on the same network as this computer running push.py.`}
                />
              </div>

              {brand.warning && <Note warn>{brand.warning}</Note>}

              {isPhone ? (
                /* ── Phone / Larix instructions ── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                  <Block n="1" title="Install mediamtx — the RTMP receiver"
                    note="Runs on your Mac/PC and accepts the live stream from Larix.">
                    <Code text="brew install mediamtx" />
                    <Code label="Start it in a terminal (keep this window open):" text="mediamtx" />
                  </Block>

                  <Block n="2" title="Find this computer's IP address">
                    <Code label="Run in a new terminal:" text="ipconfig getifaddr en0" />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                      <span style={{ fontSize: 13, color: '#6b7a8d', flexShrink: 0 }}>Your IP:</span>
                      <input value={localIp} onChange={e => setLocalIp(e.target.value)}
                        style={{ ...inputStyle(), width: 180, padding: '7px 10px', fontSize: 13, fontFamily: 'monospace' }} />
                      <span style={{ fontSize: 12, color: '#9aa6b2' }}>← enter it here</span>
                    </div>
                  </Block>

                  <Block n="3" title="Configure Larix Broadcaster on your phone"
                    note="Open Larix → Settings → Connections → + (new). Connection type: RTMP.">
                    <Code label="Stream URL" text={localRtmpUrl} />
                    <Note warn>Phone and this computer must be on the same WiFi for local streaming.</Note>
                  </Block>
                </div>
              ) : (
                /* ── RTSP camera setup ── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  {/* Enable RTSP steps */}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: DARK, marginBottom: 12 }}>
                      Step A — Enable RTSP on the camera
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {brand.enableSteps.map((s, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                            background: '#ecfdf5', color: '#059669', fontWeight: 800, fontSize: 11,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                            {i + 1}
                          </div>
                          <span style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Credentials form */}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: DARK, marginBottom: 14 }}>
                      Step B — Enter camera credentials
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12, marginBottom: 12 }}>
                      <Field label="Camera IP address">
                        <input
                          value={cam.ip}
                          onChange={e => setCam(c => ({ ...c, ip: e.target.value, useCustom: false }))}
                          placeholder="192.168.1.100"
                          style={{ ...inputStyle(), fontFamily: 'monospace' }} />
                      </Field>
                      <Field label="Port">
                        <input
                          value={cam.port}
                          onChange={e => setCam(c => ({ ...c, port: e.target.value, useCustom: false }))}
                          style={{ ...inputStyle(), fontFamily: 'monospace' }} />
                      </Field>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Field label="Username">
                        <input
                          value={cam.user}
                          onChange={e => setCam(c => ({ ...c, user: e.target.value, useCustom: false }))}
                          autoComplete="off"
                          style={{ ...inputStyle(), fontFamily: 'monospace' }} />
                      </Field>
                      <Field label="Password">
                        <div style={{ position: 'relative' }}>
                          <input
                            type={showPass ? 'text' : 'password'}
                            value={cam.pass}
                            onChange={e => setCam(c => ({ ...c, pass: e.target.value, useCustom: false }))}
                            autoComplete="new-password"
                            style={{ ...inputStyle(), fontFamily: 'monospace', paddingRight: 44 }} />
                          <button
                            type="button"
                            onClick={() => setShowPass(v => !v)}
                            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                              border: 'none', background: 'none', cursor: 'pointer', color: '#9aa6b2', fontSize: 14 }}>
                            {showPass ? '🙈' : '👁'}
                          </button>
                        </div>
                      </Field>
                    </div>
                  </div>

                  {/* Auto-built URL preview */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: DARK }}>Stream URL</div>

                    {!cam.useCustom && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                        background: builtUrl ? '#f0fdf4' : '#f7f9fb', borderRadius: 10,
                        padding: '10px 14px', border: `1px solid ${builtUrl ? '#86efac' : '#e7ecf0'}` }}>
                        <code style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all',
                          color: builtUrl ? DARK : '#9aa6b2' }}>
                          {builtUrl || '← Fill in camera IP and credentials above'}
                        </code>
                        {builtUrl && <CopyBtn text={builtUrl} />}
                      </div>
                    )}

                    {cam.useCustom && (
                      <Field label="Custom URL">
                        <input
                          value={cam.customUrl}
                          onChange={e => setCam(c => ({ ...c, customUrl: e.target.value }))}
                          placeholder="rtsp://admin:pass@192.168.1.x:554/stream"
                          style={{ ...inputStyle(), fontFamily: 'monospace', fontSize: 13 }} />
                      </Field>
                    )}

                    <button
                      type="button"
                      onClick={() => setCam(c => ({
                        ...c, useCustom: !c.useCustom, customUrl: !c.useCustom ? builtUrl : '',
                      }))}
                      style={{ alignSelf: 'flex-start', border: 'none', background: 'none',
                        color: GREEN, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                      {cam.useCustom ? '↺ Use auto-built URL' : '✎ Enter a custom URL instead'}
                    </button>

                    {brand.tip && <Note>💡 {brand.tip}</Note>}
                  </div>
                </div>
              )}

              {cameraErr && <Err msg={cameraErr} />}

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setStep(1)} style={secondaryBtn()}>← Back</button>
                <Btn
                  onClick={saveCameraAndNext}
                  loading={urlSaving}
                  disabled={!isPhone && !cam.ip.trim() && !cam.customUrl.trim()}>
                  {isPhone ? 'Continue →' : 'Save & continue →'}
                </Btn>
              </div>
            </div>
          )}

          {/* ── STEP 3: Cloudflare (required) ── */}
          {step === 3 && lot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
              <Heading title="Set up remote access"
                sub="Cloudflare Tunnel gives you a secure public HTTPS URL for your dashboard — no port forwarding or static IP needed. This is required." />

              <div style={{ background: '#fffbeb', borderRadius: 14, padding: '14px 18px',
                border: '1px solid #fde68a', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <div style={{ fontSize: 13, color: '#92400e', fontWeight: 600, lineHeight: 1.6 }}>
                  Without this step, your dashboard is only accessible on this local machine.
                  Cloudflare Tunnel is <b>free</b> and takes about 2 minutes to set up.
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <Block n="1" title="Install cloudflared">
                  <Code label="macOS (Homebrew):" text="brew install cloudflared" />
                  <Code label="Windows (winget):" text="winget install Cloudflare.cloudflared" />
                  <Code label="Linux (Debian/Ubuntu):" text="sudo apt install cloudflared" />
                </Block>

                <Block n="2" title="Open a tunnel to your dashboard"
                  note="Run this and leave the terminal open. Cloudflare will print a public HTTPS URL in ~10 seconds.">
                  <Code text="cloudflared tunnel --url http://localhost:3000" />
                  <Note>
                    You&apos;ll see a URL like: <code style={monoSnip()}>https://abc123.trycloudflare.com</code>
                    <br />Bookmark it — this is your public dashboard URL, accessible from any device.
                  </Note>
                </Block>

                {isPhone && (
                  <Block n="3" title="Optional: remote phone streaming"
                    note="Skip this if your phone is on the same WiFi as this computer.">
                    <Code text="cloudflared tunnel --url tcp://localhost:1935" />
                    <Note>
                      Use the TCP host printed by Cloudflare as the Larix stream URL instead of your local IP.
                      Format: <code style={monoSnip()}>{`rtmp://HOST:PORT${rtmpPath}`}</code>
                    </Note>
                  </Block>
                )}

                <Block
                  n={isPhone ? '4' : '3'}
                  title="Start the AI detection worker"
                  note="Open a new terminal in your Vacant project folder:">
                  <Code text="python scripts/push.py" />
                  {isPhone && (
                    <Note warn>Keep the mediamtx terminal from the previous step running too.</Note>
                  )}
                  <Note>This must stay running whenever you want live parking occupancy tracking.</Note>
                </Block>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setStep(2)} style={secondaryBtn()}>← Back</button>
                <Btn onClick={() => setStep(4)}>I&apos;ve set up the tunnel &amp; started push.py →</Btn>
              </div>
            </div>
          )}

          {/* ── STEP 4: verify stream ── */}
          {step === 4 && lot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <Heading title="Verify your camera stream"
                sub="Point your camera at the parking lot. The AI will start detecting vehicles within seconds." />

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
                    AI is detecting vehicles — stall mapping is next.
                  </div>
                </div>
              )}

              <Checklist items={[
                {
                  label: 'Cloudflare tunnel running',
                  done: !!connected,
                  hint: 'Run: cloudflared tunnel --url http://localhost:3000',
                },
                {
                  label: 'push.py running',
                  done: !!connected,
                  hint: 'Run: python scripts/push.py',
                },
                {
                  label: isPhone ? 'Larix is streaming' : 'Camera stream reachable',
                  done: !!connected,
                  hint: isPhone
                    ? 'Open Larix on your phone and press the broadcast button'
                    : 'Check camera IP and credentials in the previous step',
                },
              ]} />

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setStep(3)} style={secondaryBtn()}>← Back</button>
                <Btn onClick={() => setStep(5)}>
                  {connected ? 'Stream verified — continue →' : 'Skip for now →'}
                </Btn>
              </div>
            </div>
          )}

          {/* ── STEP 5: map layout ── */}
          {step === 5 && lot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <Heading title="Map your parking lot"
                sub="Design the layout by dragging roads and stall rows onto your camera feed. The AI knows exactly where every spot is." />

              <div style={{ background: 'linear-gradient(135deg,#0d1b2a 0%,#1a2e3d 100%)', borderRadius: 18,
                padding: '32px 28px', display: 'flex', gap: 24, alignItems: 'center' }}>
                <div style={{ fontSize: 52 }}>🛣️</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 19, color: '#fff', marginBottom: 6 }}>Open the Lot Builder</div>
                  <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.65)', lineHeight: 1.65 }}>
                    Drag <b style={{ color: '#4ade80' }}>Road + Auto-Fill</b> blocks onto your live camera image.
                    Stall rows appear automatically on both sides. Adjust and save — the AI uses this immediately.
                  </div>
                </div>
                <a href={`/builder?id=${lot.id}&back=/setup`} target="_blank" rel="noopener noreferrer"
                  style={{ border: 'none', borderRadius: 12, padding: '13px 22px', fontSize: 14, fontWeight: 700,
                    cursor: 'pointer', textDecoration: 'none', flexShrink: 0,
                    background: 'linear-gradient(160deg,#10b981,#059669)', color: '#fff',
                    boxShadow: '0 4px 18px rgba(16,185,129,.45)' }}>
                  Open Builder →
                </a>
              </div>

              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { n: '1', text: 'Drag "Road + Auto-Fill" from the left panel onto the parking image' },
                    { n: '2', text: 'Stall rows fill in automatically on both sides of the road' },
                    { n: '3', text: 'Adjust stall count, rotate 90°, drag elements to reposition' },
                    { n: '4', text: 'Click Save — the AI uses this layout immediately' },
                  ].map(({ n, text }) => (
                    <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#ecfdf5',
                        color: '#059669', fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{n}</div>
                      <span style={{ fontSize: 13, color: '#4a5568', lineHeight: 1.55 }}>{text}</span>
                    </div>
                  ))}
                </div>
                {occ?.image && (
                  <div style={{ width: 220, flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2',
                      letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>Live feed</div>
                    <div style={{ borderRadius: 10, overflow: 'hidden', border: `2px solid ${GREEN}`, aspectRatio: '16/9' }}>
                      <img src={occ.image} alt="live" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  </div>
                )}
              </div>

              <Note warn>
                The builder opens in a new tab. After saving your layout, come back here and click Continue.
                Or skip — the AI will auto-detect stalls by watching where cars park.
              </Note>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setStep(4)} style={secondaryBtn()}>← Back</button>
                <Btn onClick={() => setStep(6)}>Continue to finish →</Btn>
              </div>
            </div>
          )}

          {/* ── STEP 6: done ── */}
          {step === 6 && lot && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28, textAlign: 'center', padding: '10px 0' }}>
              <div>
                <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
                <div style={{ fontWeight: 800, fontSize: 26, letterSpacing: '-.5px' }}>{lot.name} is live!</div>
                <div style={{ color: '#6b7a8d', fontSize: 15, marginTop: 10, lineHeight: 1.7,
                  maxWidth: 440, margin: '10px auto 0' }}>
                  Visit the Lot Builder to map stalls, or the AI will auto-detect them over the next few minutes.
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
                <button
                  onClick={() => {
                    setStep(0); setLot(null); setName(''); setOcc(null);
                    setCam({ brandId: '', ip: '', port: '554', user: 'admin', pass: '', useCustom: false, customUrl: '' });
                  }}
                  style={{ padding: '13px 26px', borderRadius: 12, border: '1.5px solid #e1e7ec',
                    background: '#fff', color: '#6b7a8d', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                  Add another lot
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      <Assistant ctx={{
        step,
        stepName: STEPS[step] ?? '',
        lotId: lot?.id ?? null,
        lotName: lot?.name ?? null,
        cameraBrand: brand?.name ?? null,
        connected: !!connected,
        count: occ?.count ?? null,
      }} />
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#eef3f1', fontFamily: 'system-ui', fontSize: 14, color: '#6b7a8d' }}>
        Loading…
      </div>
    }>
      <SetupWizard />
    </Suspense>
  );
}
