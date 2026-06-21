'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { StallPoly, RoadSeg } from './LotBuilder';

// LotBuilder uses SVG pointer events — safe to load with SSR disabled for consistency
const LotBuilder = dynamic(() => import('./LotBuilder'), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0d1b2a', borderRadius: 14, color: '#4a5568', fontSize: 13 }}>
      Loading builder…
    </div>
  ),
});

type OccData = { image: string | null; ts: number };

const GREEN = '#10b981';
const DARK  = '#0d1b2a';
const FONT  = 'var(--font-geist-sans), system-ui, sans-serif';

function BuilderInner() {
  const router = useRouter();
  const params = useSearchParams();
  const lotId  = params.get('id') ?? '';
  const back   = params.get('back') ?? '/manage';

  const [lotName, setLotName] = useState(lotId);
  const [image,   setImage]   = useState<string | null>(null);
  const [imageW,  setImageW]  = useState(800);
  const [imageH,  setImageH]  = useState(450);
  const [stalls,  setStalls]  = useState<StallPoly[]>([]);
  const [roads,   setRoads]   = useState<RoadSeg[]>([]);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [count,   setCount]   = useState({ stalls: 0, roads: 0 });

  const onChangeRef = useRef<(s: StallPoly[], r: RoadSeg[]) => void>(() => {});
  onChangeRef.current = (s, r) => {
    setStalls(s); setRoads(r);
    setCount({ stalls: s.length, roads: r.length });
  };
  const onChange = useCallback((s: StallPoly[], r: RoadSeg[]) => onChangeRef.current(s, r), []);

  // load lot name + live image
  useEffect(() => {
    if (!lotId) return;
    fetch('/api/lots').then(r => r.json()).then((lots: { id: string; name: string }[]) => {
      const lot = lots.find(l => l.id === lotId);
      if (lot) setLotName(lot.name);
    }).catch(() => {});

    const pollImage = async () => {
      try {
        const data: Record<string, OccData> = await fetch('/api/occupancy', { cache: 'no-store' }).then(r => r.json());
        const lot = data[lotId];
        if (lot?.image) {
          setImage(lot.image);
          // detect image natural dimensions from the data URL
          const img = new Image();
          img.onload = () => { setImageW(img.naturalWidth); setImageH(img.naturalHeight); };
          img.src = lot.image;
        }
      } catch {}
    };
    pollImage();
    const id = setInterval(pollImage, 3000);
    return () => clearInterval(id);
  }, [lotId]);

  async function save() {
    if (!lotId) return;
    setSaving(true);
    await fetch('/api/lots', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: lotId,
        stalls: stalls.length ? stalls : null,
        roads,
        capacity: stalls.length,
        _stall_draw_width:  imageW,
        _stall_draw_height: imageH,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function saveAndBack() {
    await save();
    router.push(back);
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: FONT, color: DARK, background: '#eef3f1' }}>

      {/* header */}
      <header style={{ padding: '12px 24px', background: '#fff', borderBottom: '1px solid #e7ecf0',
        display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>

        <Link href={back} style={{ textDecoration: 'none', fontWeight: 800, fontSize: 18, color: DARK, letterSpacing: '-.3px' }}>
          Vac<span style={{ color: GREEN }}>ant</span>
        </Link>

        <span style={{ color: '#c5cfd8' }}>›</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#4a5568' }}>Lot Builder</span>
        {lotName && (
          <>
            <span style={{ color: '#c5cfd8' }}>›</span>
            <span style={{ fontWeight: 600, fontSize: 14, color: DARK }}>{lotName}</span>
          </>
        )}

        <div style={{ flex: 1 }} />

        {/* stall count badge */}
        {count.stalls > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0fdf4',
            border: '1px solid #86efac', borderRadius: 20, padding: '5px 14px', fontSize: 13, color: '#065f46' }}>
            <span style={{ width: 8, height: 8, background: GREEN, borderRadius: '50%', display: 'inline-block' }} />
            <b>{count.stalls}</b> stall{count.stalls !== 1 ? 's' : ''} mapped
          </div>
        )}

        <button onClick={save} disabled={saving || count.stalls === 0} style={{
          border: 'none', borderRadius: 9, padding: '8px 18px', fontSize: 13, fontWeight: 700,
          cursor: count.stalls === 0 || saving ? 'not-allowed' : 'pointer',
          background: saved ? '#a7f3d0' : count.stalls > 0 ? '#f0f4f6' : '#f0f4f6',
          color: saved ? '#047857' : DARK, transition: 'all .15s',
        }}>
          {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
        </button>

        <button onClick={saveAndBack} disabled={saving || count.stalls === 0} style={{
          border: 'none', borderRadius: 9, padding: '8px 18px', fontSize: 13, fontWeight: 700,
          cursor: count.stalls === 0 || saving ? 'not-allowed' : 'pointer',
          background: count.stalls > 0 ? 'linear-gradient(160deg,#10b981,#059669)' : '#e8edf1',
          color: count.stalls > 0 ? '#fff' : '#9aa6b2',
          boxShadow: count.stalls > 0 ? '0 3px 10px rgba(16,185,129,.3)' : 'none',
          transition: 'all .15s',
        }}>
          {saving ? 'Saving…' : 'Save & go back →'}
        </button>
      </header>

      {/* how-to banner */}
      <div style={{ background: '#f0fdf4', borderBottom: '1px solid #86efac',
        padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 16,
        fontSize: 13, color: '#065f46', flexShrink: 0 }}>
        <span style={{ fontWeight: 700 }}>How to use:</span>
        <span>①  Drag <b>Road + Auto-Fill</b> from the left panel onto your parking lot image.</span>
        <span>②  Adjust stall count, road length, which sides have stalls.</span>
        <span>③  Add more roads or standalone rows as needed.</span>
        <span>④  Click <b>Save</b> — the AI uses this layout immediately.</span>
        {!image && (
          <span style={{ marginLeft: 'auto', color: '#92400e', background: '#fffbeb',
            padding: '3px 10px', borderRadius: 20, border: '1px solid #fde68a', fontSize: 12 }}>
            No live feed — start streaming for a camera background
          </span>
        )}
      </div>

      {/* builder */}
      <div style={{ flex: 1, padding: '16px 20px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <LotBuilder imageUrl={image} imageW={imageW} imageH={imageH} onChange={onChange} />
      </div>
    </div>
  );
}

export default function BuilderPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh',
        background: '#eef3f1', fontSize: 14, color: '#6b7a8d' }}>
        Loading…
      </div>
    }>
      <BuilderInner />
    </Suspense>
  );
}
