'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const GREEN = '#10b981';
const DARK  = '#0d1b2a';
const FONT  = 'var(--font-geist-sans), system-ui, sans-serif';

type Camera = {
  brand:       string;
  brandId:     string;
  name:        string;
  emoji:       string;
  price:       string;
  priceNum:    number;
  tier:        'Budget' | 'Mid-range' | 'Pro';
  resolution:  string;
  outdoor:     boolean;
  nightVision: boolean;
  poe:         boolean;
  wifi:        boolean;
  rtsp:        boolean;
  onvif:       boolean;
  fov:         string;
  best:        string;
  amazon:      string;
};

const CAMERAS: Camera[] = [
  {
    brand: 'Reolink', brandId: 'reolink', name: 'RLC-510A', emoji: '🟠',
    price: '$40', priceNum: 40, tier: 'Budget',
    resolution: '5MP', outdoor: true, nightVision: true, poe: true, wifi: false,
    rtsp: true, onvif: true, fov: '80°',
    best: 'Best value for a small lot',
    amazon: 'https://www.amazon.com/s?k=Reolink+RLC-510A+PoE+Camera',
  },
  {
    brand: 'Reolink', brandId: 'reolink', name: 'E1 Outdoor PoE', emoji: '🟠',
    price: '$45', priceNum: 45, tier: 'Budget',
    resolution: '5MP', outdoor: true, nightVision: true, poe: true, wifi: true,
    rtsp: true, onvif: false, fov: '85°',
    best: 'WiFi + PoE flexibility',
    amazon: 'https://www.amazon.com/s?k=Reolink+E1+Outdoor+PoE+IP+camera',
  },
  {
    brand: 'Amcrest', brandId: 'amcrest', name: 'IP5M-T1179EW', emoji: '🟡',
    price: '$50', priceNum: 50, tier: 'Budget',
    resolution: '5MP', outdoor: true, nightVision: true, poe: true, wifi: false,
    rtsp: true, onvif: true, fov: '98°',
    best: 'Wide angle, great for small lots',
    amazon: 'https://www.amazon.com/s?k=Amcrest+IP5M-T1179EW+outdoor+PoE+camera',
  },
  {
    brand: 'Reolink', brandId: 'reolink', name: 'RLC-810A', emoji: '🟠',
    price: '$70', priceNum: 70, tier: 'Mid-range',
    resolution: '4K 8MP', outdoor: true, nightVision: true, poe: true, wifi: false,
    rtsp: true, onvif: true, fov: '80°',
    best: 'Top pick for medium lots',
    amazon: 'https://www.amazon.com/s?k=Reolink+RLC-810A+4K+PoE',
  },
  {
    brand: 'Dahua', brandId: 'dahua', name: 'IPC-HDW2831T-AS', emoji: '🟢',
    price: '$80', priceNum: 80, tier: 'Mid-range',
    resolution: '4K 8MP', outdoor: true, nightVision: true, poe: true, wifi: false,
    rtsp: true, onvif: true, fov: '102°',
    best: 'Wide-angle 4K — covers more of your lot',
    amazon: 'https://www.amazon.com/s?k=Dahua+IPC-HDW2831T+4K+PoE+camera',
  },
  {
    brand: 'Amcrest', brandId: 'amcrest', name: 'UHD 4K IP8M-2496EW', emoji: '🟡',
    price: '$90', priceNum: 90, tier: 'Mid-range',
    resolution: '4K 8MP', outdoor: true, nightVision: true, poe: true, wifi: false,
    rtsp: true, onvif: true, fov: '90°',
    best: 'Great night vision for dark lots',
    amazon: 'https://www.amazon.com/s?k=Amcrest+4K+IP+outdoor+PoE+camera+8MP',
  },
  {
    brand: 'Hikvision', brandId: 'hikvision', name: 'DS-2CD2143G2-I', emoji: '🔵',
    price: '$120', priceNum: 120, tier: 'Pro',
    resolution: '4MP AcuSense', outdoor: true, nightVision: true, poe: true, wifi: false,
    rtsp: true, onvif: true, fov: '103°',
    best: 'AI false-alarm filtering built in',
    amazon: 'https://www.amazon.com/s?k=Hikvision+DS-2CD2143G2+AcuSense+camera',
  },
  {
    brand: 'Dahua', brandId: 'dahua', name: 'IPC-HDW3849H-AS-PV', emoji: '🟢',
    price: '$140', priceNum: 140, tier: 'Pro',
    resolution: '4K Full Color', outdoor: true, nightVision: true, poe: true, wifi: false,
    rtsp: true, onvif: true, fov: '102°',
    best: 'Color night vision — spot vehicles at night',
    amazon: 'https://www.amazon.com/s?k=Dahua+4K+Full+Color+PoE+outdoor+camera',
  },
];

type Accessory = { name: string; price: string; desc: string; amazon: string };
const ACCESSORIES: Accessory[] = [
  {
    name: 'TP-Link TL-SG1005P PoE Switch',
    price: '~$30',
    desc: 'Power up to 4 PoE cameras with one cable each. No separate power adapter needed.',
    amazon: 'https://www.amazon.com/s?k=TP-Link+TL-SG1005P+PoE+switch',
  },
  {
    name: 'TP-Link TL-PoE150S Injector',
    price: '~$18',
    desc: 'Power a single PoE camera if you only need one and already have a regular switch.',
    amazon: 'https://www.amazon.com/s?k=TP-Link+TL-PoE150S+PoE+injector',
  },
  {
    name: 'Outdoor Cat6 Ethernet Cable (100ft)',
    price: '~$20',
    desc: 'UV-resistant, direct-burial rated. Run PoE from your switch to the camera.',
    amazon: 'https://www.amazon.com/s?k=outdoor+direct+burial+cat6+ethernet+cable+100ft',
  },
];

const TIER_COLOR: Record<string, string> = {
  Budget:     '#ecfdf5',
  'Mid-range': '#eff6ff',
  Pro:        '#faf5ff',
};
const TIER_TEXT: Record<string, string> = {
  Budget:     '#047857',
  'Mid-range': '#1d4ed8',
  Pro:        '#7c3aed',
};

function SpecBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: ok ? '#ecfdf5' : '#f0f4f6',
      color: ok ? '#047857' : '#9aa6b2',
    }}>
      {ok ? '✓' : '·'} {label}
    </span>
  );
}

function CameraCard({ cam, onAdd }: { cam: Camera; onAdd: (cam: Camera) => void }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 18, border: '1px solid #e7ecf0',
      boxShadow: '0 2px 14px rgba(13,27,42,.06)', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* header */}
      <div style={{ padding: '18px 18px 12px', borderBottom: '1px solid #f0f4f7' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 22 }}>{cam.emoji}</span>
              <span style={{ fontWeight: 800, fontSize: 16, color: DARK }}>{cam.brand}</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: '#4a5568' }}>{cam.name}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 18, color: DARK }}>{cam.price}</span>
            <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: TIER_COLOR[cam.tier], color: TIER_TEXT[cam.tier] }}>
              {cam.tier}
            </span>
          </div>
        </div>

        {cam.best && (
          <div style={{ marginTop: 10, padding: '7px 10px', background: '#f0fdf4', borderRadius: 8,
            fontSize: 12, color: '#047857', fontWeight: 600, borderLeft: `3px solid ${GREEN}` }}>
            {cam.best}
          </div>
        )}
      </div>

      {/* specs */}
      <div style={{ padding: '12px 18px', flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase',
          letterSpacing: '1px', marginBottom: 8 }}>Specs</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 700,
            background: '#1d4ed8', color: '#fff' }}>{cam.resolution}</span>
          <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            background: '#f0f4f6', color: DARK }}>{cam.fov} FOV</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          <SpecBadge label="Outdoor" ok={cam.outdoor} />
          <SpecBadge label="Night vision" ok={cam.nightVision} />
          <SpecBadge label="PoE" ok={cam.poe} />
          {cam.wifi && <SpecBadge label="WiFi" ok />}
          <SpecBadge label="RTSP" ok={cam.rtsp} />
          <SpecBadge label="ONVIF" ok={cam.onvif} />
        </div>
      </div>

      {/* actions */}
      <div style={{ padding: '12px 18px', borderTop: '1px solid #f0f4f7', display: 'flex', gap: 8 }}>
        <a
          href={cam.amazon}
          target="_blank"
          rel="noopener noreferrer"
          style={{ flex: 1, border: '1.5px solid #e1e7ec', background: '#fff', color: DARK,
            borderRadius: 10, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            textDecoration: 'none', textAlign: 'center' }}>
          View on Amazon →
        </a>
        <button
          onClick={() => onAdd(cam)}
          style={{ flex: 1, border: 'none', background: 'linear-gradient(160deg,#10b981,#059669)',
            color: '#fff', borderRadius: 10, padding: '9px', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', boxShadow: '0 3px 10px rgba(16,185,129,.25)' }}>
          Add to Vacant →
        </button>
      </div>
    </div>
  );
}

const TIERS = ['All', 'Budget', 'Mid-range', 'Pro'] as const;

export default function CamerasPage() {
  const router  = useRouter();
  const [tier,  setTier]  = useState<string>('All');
  const [toast, setToast] = useState<string | null>(null);

  function handleAdd(cam: Camera) {
    setToast(`Opening setup wizard for ${cam.brand} ${cam.name}…`);
    setTimeout(() => setToast(null), 2500);
    router.push(`/setup?brand=${cam.brandId}`);
  }

  const filtered = tier === 'All' ? CAMERAS : CAMERAS.filter(c => c.tier === tier);

  return (
    <div style={{ minHeight: '100vh',
      background: 'radial-gradient(900px 600px at 70% -10%, rgba(16,185,129,.12), transparent 60%), #eef3f1',
      fontFamily: FONT, color: DARK }}>

      {/* toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: DARK, color: '#fff', padding: '10px 22px', borderRadius: 30,
          fontSize: 13.5, fontWeight: 700, zIndex: 999, boxShadow: '0 8px 30px rgba(0,0,0,.25)' }}>
          {toast}
        </div>
      )}

      {/* header */}
      <header style={{ padding: '14px 28px', background: '#fff', borderBottom: '1px solid #e7ecf0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ textDecoration: 'none', fontWeight: 800, fontSize: 20, color: DARK, letterSpacing: '-.3px' }}>
            Vac<span style={{ color: GREEN }}>ant</span>
          </Link>
          <span style={{ color: '#c5cfd8' }}>›</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#4a5568' }}>Camera Marketplace</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ href: '/manage', label: 'Manage' }, { href: '/setup', label: 'Setup wizard' }].map(({ href, label }) => (
            <Link key={href} href={href} style={{ padding: '6px 14px', borderRadius: 9, background: '#f0f4f6',
              color: DARK, fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>{label}</Link>
          ))}
        </div>
      </header>

      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '32px 28px' }}>

        {/* hero */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#ecfdf5',
            border: '1px solid #a7f3d0', borderRadius: 30, padding: '6px 16px',
            fontSize: 12.5, fontWeight: 700, color: '#047857', marginBottom: 16 }}>
            📷 Compatible cameras — all support RTSP
          </div>
          <h1 style={{ margin: 0, fontWeight: 900, fontSize: 34, letterSpacing: '-.5px', color: DARK, marginBottom: 10 }}>
            Find the right camera for your lot
          </h1>
          <p style={{ margin: 0, fontSize: 16, color: '#6b7a8d', maxWidth: 560, marginInline: 'auto', lineHeight: 1.6 }}>
            Every camera below works plug-and-play with Vacant. Pick one, mount it overlooking your lot,
            and Vacant handles the rest — free, forever.
          </p>
        </div>

        {/* filter tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {TIERS.map(t => (
            <button key={t} onClick={() => setTier(t)} style={{
              border: tier === t ? `2px solid ${GREEN}` : '2px solid #e1e7ec',
              background: tier === t ? '#ecfdf5' : '#fff',
              color: tier === t ? '#047857' : '#6b7a8d',
              borderRadius: 30, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>
              {t}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12.5, color: '#9aa6b2', fontWeight: 600 }}>
            {filtered.length} camera{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* camera grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20, marginBottom: 44 }}>
          {filtered.map(cam => (
            <CameraCard key={`${cam.brand}-${cam.name}`} cam={cam} onAdd={handleAdd} />
          ))}
        </div>

        {/* free phone option */}
        <div style={{ background: 'linear-gradient(135deg, #0d1b2a 0%, #1a2e45 100%)', borderRadius: 20,
          padding: '28px 32px', marginBottom: 44, color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📱</div>
              <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Start for free with your phone</div>
              <div style={{ fontSize: 14, color: '#a8c0d2', lineHeight: 1.7, maxWidth: 500 }}>
                Already have an old iPhone or Android? Mount it overlooking your lot and stream live video
                to Vacant using the free Larix Broadcaster app. No hardware to buy. Perfect for testing.
              </div>
              <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {['RTMP streaming', 'Free app', 'Any phone', 'iOS & Android'].map(label => (
                  <span key={label} style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                    background: 'rgba(255,255,255,.1)', color: '#a8c0d2' }}>{label}</span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
              <a href="https://apps.apple.com/us/app/larix-broadcaster/id1169945219"
                target="_blank" rel="noopener noreferrer"
                style={{ padding: '10px 20px', background: '#fff', color: DARK, borderRadius: 12,
                  fontWeight: 700, fontSize: 13.5, textDecoration: 'none', textAlign: 'center' }}>
                App Store (iPhone)
              </a>
              <a href="https://play.google.com/store/apps/details?id=com.wmspanel.larix_broadcaster"
                target="_blank" rel="noopener noreferrer"
                style={{ padding: '10px 20px', background: 'rgba(255,255,255,.15)', color: '#fff',
                  borderRadius: 12, fontWeight: 700, fontSize: 13.5, textDecoration: 'none', textAlign: 'center',
                  border: '1.5px solid rgba(255,255,255,.3)' }}>
                Google Play (Android)
              </a>
              <button onClick={() => router.push('/setup?brand=phone')}
                style={{ padding: '10px 20px', background: `linear-gradient(135deg,${GREEN},#059669)`,
                  color: '#fff', borderRadius: 12, fontWeight: 700, fontSize: 13.5, cursor: 'pointer',
                  border: 'none', boxShadow: '0 4px 14px rgba(16,185,129,.35)' }}>
                Set up phone stream →
              </button>
            </div>
          </div>
        </div>

        {/* accessories */}
        <div style={{ marginBottom: 44 }}>
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 6 }}>Required accessories</div>
          <div style={{ color: '#9aa6b2', fontSize: 13.5, marginBottom: 20 }}>
            PoE cameras need a switch or injector to receive power over the ethernet cable.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {ACCESSORIES.map(acc => (
              <div key={acc.name} style={{ background: '#fff', borderRadius: 14, border: '1px solid #e7ecf0',
                padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: DARK, flex: 1 }}>{acc.name}</div>
                  <span style={{ fontWeight: 800, fontSize: 15, color: DARK, flexShrink: 0 }}>{acc.price}</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#6b7a8d', lineHeight: 1.55 }}>{acc.desc}</div>
                <a href={acc.amazon} target="_blank" rel="noopener noreferrer"
                  style={{ marginTop: 4, color: GREEN, fontWeight: 700, fontSize: 12.5, textDecoration: 'none' }}>
                  Find on Amazon →
                </a>
              </div>
            ))}
          </div>
        </div>

        {/* bottom CTA */}
        <div style={{ background: '#fff', borderRadius: 18, border: '1px solid #e7ecf0',
          padding: '24px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 5 }}>Already have a camera?</div>
            <div style={{ color: '#6b7a8d', fontSize: 13.5 }}>
              If you have an existing RTSP camera, set it up directly with the guided wizard.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => router.push('/manage')} style={{
              border: '1.5px solid #e1e7ec', background: '#fff', color: DARK,
              borderRadius: 12, padding: '11px 22px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
              Quick add
            </button>
            <button onClick={() => router.push('/setup')} style={{
              border: 'none', borderRadius: 12, padding: '12px 24px', fontSize: 13.5, fontWeight: 700,
              background: 'linear-gradient(160deg,#10b981,#059669)', color: '#fff', cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(16,185,129,.3)' }}>
              Setup wizard →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
