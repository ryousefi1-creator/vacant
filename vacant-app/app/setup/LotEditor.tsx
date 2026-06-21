'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type DrawnStall = { x: number; y: number; w: number; h: number; id: number };
export type DrawnRoad  = { x1: number; y1: number; x2: number; y2: number; id: number };

type Tool = 'stall' | 'road' | 'erase';

type Props = {
  imageUrl: string | null;
  onChange: (stalls: DrawnStall[], roads: DrawnRoad[]) => void;
};

const GREEN = '#10b981';
const BLUE  = '#3b82f6';

export default function LotEditor({ imageUrl, onChange }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const imgRef      = useRef<HTMLImageElement | null>(null);
  const stateRef    = useRef<{ stalls: DrawnStall[]; roads: DrawnRoad[] }>({ stalls: [], roads: [] });
  const dragRef     = useRef<{ x: number; y: number } | null>(null);
  const nextId      = useRef(0);

  const [tool,    setTool]    = useState<Tool>('stall');
  const [counts,  setCounts]  = useState({ stalls: 0, roads: 0 });

  // ── helpers ─────────────────────────────────────────────────────────────
  function canvasCoords(e: MouseEvent | React.MouseEvent): { x: number; y: number } {
    const c    = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width)  * c.width,
      y: ((e.clientY - rect.top)  / rect.height) * c.height,
    };
  }

  // ── draw ─────────────────────────────────────────────────────────────────
  const render = useCallback((preview?: { stall?: DrawnStall; road?: DrawnRoad }) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);

    if (imgRef.current?.complete) {
      ctx.drawImage(imgRef.current, 0, 0, c.width, c.height);
    } else {
      ctx.fillStyle = '#0d1b2a';
      ctx.fillRect(0, 0, c.width, c.height);
    }

    const { stalls, roads } = stateRef.current;

    // roads
    const allRoads = preview?.road ? [...roads, preview.road] : roads;
    allRoads.forEach((r, i) => {
      const isP = preview?.road && i === roads.length;
      ctx.save();
      ctx.strokeStyle = isP ? 'rgba(59,130,246,0.5)' : 'rgba(59,130,246,0.9)';
      ctx.lineWidth = 6;
      ctx.setLineDash(isP ? [6, 4] : [12, 6]);
      ctx.shadowColor = BLUE; ctx.shadowBlur = isP ? 0 : 8;
      ctx.beginPath(); ctx.moveTo(r.x1, r.y1); ctx.lineTo(r.x2, r.y2); ctx.stroke();
      ctx.restore();
      // road label
      if (!isP) {
        ctx.fillStyle = BLUE; ctx.font = `bold ${labelSz(c)}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('ROAD', (r.x1 + r.x2) / 2, (r.y1 + r.y2) / 2 - 10);
      }
    });

    // stalls
    const allStalls = preview?.stall ? [...stalls, preview.stall] : stalls;
    allStalls.forEach((s, i) => {
      const isP = preview?.stall && i === stalls.length;
      ctx.save();
      ctx.fillStyle   = isP ? 'rgba(16,185,129,0.12)' : 'rgba(16,185,129,0.28)';
      ctx.strokeStyle = isP ? 'rgba(16,185,129,0.5)' : GREEN;
      ctx.lineWidth   = 2.5;
      if (isP) ctx.setLineDash([5, 4]);
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      if (!isP) {
        const sz = labelSz(c);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${sz}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4;
        ctx.fillText(String(i + 1), s.x + s.w / 2, s.y + s.h / 2);
      }
      ctx.restore();
    });
  }, []);

  function labelSz(c: HTMLCanvasElement) { return Math.max(9, Math.round(c.width / 36)); }

  // ── image load ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!imageUrl) { render(); return; }
    const img   = new Image();
    img.onload  = () => { imgRef.current = img; render(); };
    img.onerror = () => render();
    img.src     = imageUrl;
  }, [imageUrl, render]);

  // ── mouse handlers ────────────────────────────────────────────────────────
  function onDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y } = canvasCoords(e);
    if (tool === 'erase') {
      const s = stateRef.current;
      const before = s.stalls.length + s.roads.length;
      s.stalls = s.stalls.filter(st => !(x >= st.x && x <= st.x + st.w && y >= st.y && y <= st.y + st.h));
      s.roads  = s.roads.filter(r => {
        const dx = r.x2 - r.x1, dy = r.y2 - r.y1, len2 = dx * dx + dy * dy;
        if (len2 === 0) return true;
        const t = Math.max(0, Math.min(1, ((x - r.x1) * dx + (y - r.y1) * dy) / len2));
        const cx = r.x1 + t * dx, cy = r.y1 + t * dy;
        return Math.hypot(x - cx, y - cy) > 20;
      });
      if (s.stalls.length + s.roads.length !== before) {
        setCounts({ stalls: s.stalls.length, roads: s.roads.length });
        notify();
        render();
      }
      return;
    }
    dragRef.current = { x, y };
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    const { x, y } = canvasCoords(e);
    const { x: sx, y: sy } = dragRef.current;
    if (tool === 'stall') {
      render({ stall: { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy), id: -1 } });
    } else if (tool === 'road') {
      render({ road: { x1: sx, y1: sy, x2: x, y2: y, id: -1 } });
    }
  }

  function onUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    const { x, y } = canvasCoords(e);
    const { x: sx, y: sy } = dragRef.current;
    dragRef.current = null;
    const dx = x - sx, dy = y - sy;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) { render(); return; }
    const id = nextId.current++;
    const s  = stateRef.current;
    if (tool === 'stall') {
      s.stalls = [...s.stalls, { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(dx), h: Math.abs(dy), id }];
    } else if (tool === 'road') {
      s.roads = [...s.roads, { x1: sx, y1: sy, x2: x, y2: y, id }];
    }
    setCounts({ stalls: s.stalls.length, roads: s.roads.length });
    notify();
    render();
  }

  function notify() {
    const { stalls, roads } = stateRef.current;
    onChange([...stalls], [...roads]);
  }

  function clearAll() {
    stateRef.current = { stalls: [], roads: [] };
    setCounts({ stalls: 0, roads: 0 });
    onChange([], []);
    render();
  }

  const DARK = '#0d1b2a';
  const FONT = 'var(--font-geist-sans), system-ui, sans-serif';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: FONT }}>
      {/* toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {([
          { key: 'stall', icon: 'P', label: 'Parking Stall',  color: GREEN },
          { key: 'road',  icon: '↔', label: 'Road / Lane',    color: BLUE  },
          { key: 'erase', icon: '✕', label: 'Erase',          color: '#ef4444' },
        ] as const).map(({ key, icon, label, color }) => (
          <button key={key} onClick={() => setTool(key)} style={{
            border: `2px solid ${tool === key ? color : '#e1e7ec'}`,
            background: tool === key ? color : '#fff',
            color: tool === key ? '#fff' : '#6b7a8d',
            borderRadius: 9, padding: '7px 14px', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            transition: 'all .12s',
          }}>
            <span style={{ fontWeight: 900 }}>{icon}</span> {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={clearAll} style={{
          border: '1.5px solid #e1e7ec', background: '#fff', color: '#6b7a8d',
          borderRadius: 9, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>Clear all</button>
      </div>

      {/* hint */}
      <div style={{ fontSize: 12.5, color: '#9aa6b2', background: '#f7f9fb', borderRadius: 8, padding: '8px 12px', lineHeight: 1.6 }}>
        {tool === 'stall'
          ? 'Click and drag on the camera image to draw a parking stall rectangle.'
          : tool === 'road'
          ? 'Click and drag to draw a road or driving lane line.'
          : 'Click on a stall or road to remove it.'}
      </div>

      {/* canvas */}
      <div style={{ borderRadius: 14, overflow: 'hidden', border: '2px solid #e7ecf0', background: '#0d1b2a',
        cursor: tool === 'erase' ? 'not-allowed' : 'crosshair' }}>
        <canvas
          ref={canvasRef}
          width={640} height={360}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
          style={{ display: 'block', width: '100%', userSelect: 'none' }}
        />
      </div>

      {/* counts */}
      <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#6b7a8d' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, background: GREEN, borderRadius: 2, display: 'inline-block' }} />
          <b style={{ color: DARK }}>{counts.stalls}</b> parking stall{counts.stalls !== 1 ? 's' : ''}
        </span>
        {counts.roads > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, background: BLUE, borderRadius: 2, display: 'inline-block' }} />
            <b style={{ color: DARK }}>{counts.roads}</b> road{counts.roads !== 1 ? 's' : ''}
          </span>
        )}
        {counts.stalls === 0 && (
          <span style={{ color: '#fbbf24', fontWeight: 600 }}>Draw at least one stall to continue</span>
        )}
      </div>
    </div>
  );
}
