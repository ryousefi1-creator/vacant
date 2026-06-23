'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// ── output types consumed by the caller ──────────────────────────────────────
export type StallPoly = { poly: [number, number][] };
export type RoadSeg   = { line: [[number, number], [number, number]] };
// Camera perspective: the 4 ground corners of the parking area (image px) plus
// whether to apply bird's-eye correction before detection. Feeds push.py's
// lot_quad + detect_topdown, which rectifies an angled view so the AI sees cars
// from above — far/clustered cars detect far more reliably.
export type Perspective = { quad: [number, number][] | null; topdown: boolean };

// ── internal element types ────────────────────────────────────────────────────
type Rot = 0 | 90;

// Road block: the lane rectangle + optional stall rows above/below it.
// Moving the road moves the stall rows with it.
type RoadEl = {
  id: string; kind: 'road';
  x: number; y: number; rot: Rot;
  len: number;          // length along its axis (px)
  roadH: number;        // width of the driving lane (px)
  topCount: number;     // stalls on the "top" side (0 = none)
  botCount: number;     // stalls on the "bottom" side (0 = none)
  stallW: number;       // each stall's width (px)
  stallH: number;       // each stall's depth (px)
};

// Standalone row: a row of stalls with no road attachment.
type RowEl = {
  id: string; kind: 'row';
  x: number; y: number; rot: Rot;
  count: number;
  stallW: number;
  stallH: number;
};

type AnyEl = RoadEl | RowEl;

// ── defaults ──────────────────────────────────────────────────────────────────
const SNAP       = 20;
const DEF_LEN    = 480;   // road default length (px)
const DEF_ROADH  = 60;    // road default height (px)
const DEF_STALLW = 80;    // stall width (px)
const DEF_STALLH = 50;    // stall depth (px)
const DEF_COUNT  = 6;     // default stalls per row
const GREEN      = '#10b981';
const ROAD_C     = '#94a3b8';
const SEL_C      = '#f59e0b';

function snapV(v: number) { return Math.round(v / SNAP) * SNAP; }
function uid()             { return Math.random().toString(36).slice(2, 9); }

// rotate point (px,py) around (cx,cy) by deg (0 or 90)
function rotPt(px: number, py: number, cx: number, cy: number, deg: number): [number, number] {
  if (deg === 0) return [px, py];
  const r   = (deg * Math.PI) / 180;
  const dx  = px - cx, dy = py - cy;
  return [
    Math.round(cx + dx * Math.cos(r) - dy * Math.sin(r)),
    Math.round(cy + dx * Math.sin(r) + dy * Math.cos(r)),
  ];
}

// ── geometry helpers ──────────────────────────────────────────────────────────
function roadBBox(el: RoadEl) {
  const topH  = el.topCount > 0 ? el.stallH : 0;
  const botH  = el.botCount > 0 ? el.stallH : 0;
  const totalH = topH + el.roadH + botH;
  const w     = el.rot === 0 ? el.len    : totalH;
  const h     = el.rot === 0 ? totalH   : el.len;
  return { x: el.x, y: el.y, w, h };
}

function rowBBox(el: RowEl) {
  const w = el.rot === 0 ? el.count * el.stallW : el.stallH;
  const h = el.rot === 0 ? el.stallH            : el.count * el.stallW;
  return { x: el.x, y: el.y, w, h };
}

// Convert road element → stall polygons
function roadToStalls(el: RoadEl): StallPoly[] {
  const topH = el.topCount > 0 ? el.stallH : 0;
  const polys: StallPoly[] = [];
  const cx = el.x + (el.rot === 0 ? el.len / 2 : (topH + el.roadH + (el.botCount > 0 ? el.stallH : 0)) / 2);
  const cy = el.y + (el.rot === 0 ? (topH + el.roadH + (el.botCount > 0 ? el.stallH : 0)) / 2 : el.len / 2);

  // top row (y < road)
  if (el.topCount > 0) {
    for (let i = 0; i < el.topCount; i++) {
      const corners = makeStallCorners(el.x + i * el.stallW, el.y, el.stallW, el.stallH);
      polys.push({ poly: corners.map(([px, py]) => rotPt(px, py, cx, cy, el.rot)) as [number, number][] });
    }
  }
  // bottom row (y > road)
  if (el.botCount > 0) {
    const ry = el.y + topH + el.roadH;
    for (let i = 0; i < el.botCount; i++) {
      const corners = makeStallCorners(el.x + i * el.stallW, ry, el.stallW, el.stallH);
      polys.push({ poly: corners.map(([px, py]) => rotPt(px, py, cx, cy, el.rot)) as [number, number][] });
    }
  }
  return polys;
}

// Convert row element → stall polygons
function rowToStalls(el: RowEl): StallPoly[] {
  const cx = el.x + (el.rot === 0 ? el.count * el.stallW / 2 : el.stallH / 2);
  const cy = el.y + (el.rot === 0 ? el.stallH / 2            : el.count * el.stallW / 2);
  return Array.from({ length: el.count }, (_, i) => {
    const corners = makeStallCorners(el.x + i * el.stallW, el.y, el.stallW, el.stallH);
    return { poly: corners.map(([px, py]) => rotPt(px, py, cx, cy, el.rot)) as [number, number][] };
  });
}

function makeStallCorners(x: number, y: number, w: number, h: number): [number, number][] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

// Convert road element → road center-line segment
function roadToSeg(el: RoadEl): RoadSeg {
  const topH = el.topCount > 0 ? el.stallH : 0;
  const cy   = el.y + topH + el.roadH / 2;
  const cx   = el.x + el.len / 2;
  const bcx  = el.x + (topH + el.roadH + (el.botCount > 0 ? el.stallH : 0)) / 2;
  const [x1, y1] = rotPt(el.x,         cy, cx, el.rot === 0 ? cy : bcx, el.rot);
  const [x2, y2] = rotPt(el.x + el.len, cy, cx, el.rot === 0 ? cy : bcx, el.rot);
  return { line: [[x1, y1], [x2, y2]] };
}

// ── SVG coordinate helper ─────────────────────────────────────────────────────
function svgPt(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const pt  = svg.createSVGPoint();
  pt.x      = clientX;
  pt.y      = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const tr  = pt.matrixTransform(ctm.inverse());
  return { x: tr.x, y: tr.y };
}

// ── palette definitions ───────────────────────────────────────────────────────
const PALETTE = [
  {
    id: 'road_stalls',
    label: 'Road + Auto-Fill',
    sub: 'Lane with rows on both sides',
    icon: '🛣️',
    color: '#f0fdf4',
    border: '#86efac',
  },
  {
    id: 'road',
    label: 'Road Only',
    sub: 'Driving lane, no stalls',
    icon: '🛤️',
    color: '#f8fafc',
    border: '#cbd5e1',
  },
  {
    id: 'row',
    label: 'Parking Row',
    sub: 'Standalone stall row',
    icon: '🅿️',
    color: '#ecfdf5',
    border: '#6ee7b7',
  },
] as const;

// ── component props ───────────────────────────────────────────────────────────
type Props = {
  imageUrl: string | null;
  imageW: number;
  imageH: number;
  onChange: (stalls: StallPoly[], roads: RoadSeg[], perspective: Perspective) => void;
};

const PERSP_C = '#38bdf8';  // perspective quad color (sky blue, distinct from green stalls / amber select)

// ── main component ────────────────────────────────────────────────────────────
export default function LotBuilder({ imageUrl, imageW, imageH, onChange }: Props) {
  const svgRef      = useRef<SVGSVGElement>(null);
  const [elems,     setElems]     = useState<AnyEl[]>([]);
  const [selId,     setSelId]     = useState<string | null>(null);
  const [dragging,  setDragging]  = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [grid,      setGrid]      = useState(true);
  const [dragOver,  setDragOver]  = useState(false);
  // ── camera perspective ──────────────────────────────────────────────────────
  const [quadOn,     setQuadOn]     = useState(false);
  const [quad,       setQuad]       = useState<[number, number][] | null>(null);
  const [topdown,    setTopdown]    = useState(false);
  const [cornerDrag, setCornerDrag] = useState<number | null>(null);

  const vw = imageW || 800;
  const vh = imageH || 450;

  // notify parent whenever elements OR perspective change
  useEffect(() => {
    const stalls: StallPoly[] = elems.flatMap(e =>
      e.kind === 'road' ? roadToStalls(e) : rowToStalls(e)
    );
    const roads: RoadSeg[] = elems
      .filter((e): e is RoadEl => e.kind === 'road')
      .map(roadToSeg);
    onChange(stalls, roads, { quad: quadOn ? quad : null, topdown: quadOn && topdown });
  }, [elems, onChange, quadOn, quad, topdown]);

  function enablePerspective(on: boolean) {
    setQuadOn(on);
    if (on && !quad) {
      // sensible starting quad: a centered trapezoid the user nudges onto the lot
      setQuad([
        [Math.round(vw * 0.20), Math.round(vh * 0.36)],
        [Math.round(vw * 0.80), Math.round(vh * 0.36)],
        [Math.round(vw * 0.92), Math.round(vh * 0.88)],
        [Math.round(vw * 0.08), Math.round(vh * 0.88)],
      ]);
    }
  }

  const sel = selId ? elems.find(e => e.id === selId) ?? null : null;

  // ── pointer drag on canvas elements ──────────────────────────────────────
  function startDrag(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svgPt(svg, e.clientX, e.clientY);
    const el = elems.find(x => x.id === id)!;
    setDragging({ id, ox: pt.x - el.x, oy: pt.y - el.y });
    setSelId(id);
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    // perspective corner takes priority over element drag
    if (cornerDrag !== null) {
      const pt = svgPt(svg, e.clientX, e.clientY);
      const nx = Math.max(0, Math.min(vw, Math.round(pt.x)));
      const ny = Math.max(0, Math.min(vh, Math.round(pt.y)));
      setQuad(q => {
        if (!q) return q;
        const c = q.slice() as [number, number][];
        c[cornerDrag] = [nx, ny];
        return c;
      });
      return;
    }
    if (!dragging) return;
    const pt  = svgPt(svg, e.clientX, e.clientY);
    const nx  = snapV(pt.x - dragging.ox);
    const ny  = snapV(pt.y - dragging.oy);
    setElems(prev => prev.map(el =>
      el.id === dragging.id ? { ...el, x: nx, y: ny } : el
    ));
  }

  function onPointerUp() {
    setDragging(null);
    setCornerDrag(null);
  }

  function startCornerDrag(e: React.PointerEvent, i: number) {
    e.stopPropagation();
    setCornerDrag(i);
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  // ── drop from palette ─────────────────────────────────────────────────────
  function onDrop(e: React.DragEvent<SVGSVGElement>) {
    e.preventDefault();
    setDragOver(false);
    const ptype = e.dataTransfer.getData('ptype') as 'road_stalls' | 'road' | 'row';
    const svg   = svgRef.current;
    if (!svg || !ptype) return;
    const pt    = svgPt(svg, e.clientX, e.clientY);
    const x     = snapV(Math.max(0, pt.x - DEF_LEN / 2));
    const y     = snapV(Math.max(0, pt.y - DEF_ROADH / 2));
    const id    = uid();

    if (ptype === 'road_stalls') {
      setElems(prev => [...prev, {
        id, kind: 'road', x, y: snapV(y - DEF_STALLH), rot: 0,
        len: DEF_LEN, roadH: DEF_ROADH,
        topCount: DEF_COUNT, botCount: DEF_COUNT,
        stallW: DEF_STALLW, stallH: DEF_STALLH,
      } as RoadEl]);
    } else if (ptype === 'road') {
      setElems(prev => [...prev, {
        id, kind: 'road', x, y, rot: 0,
        len: DEF_LEN, roadH: DEF_ROADH,
        topCount: 0, botCount: 0,
        stallW: DEF_STALLW, stallH: DEF_STALLH,
      } as RoadEl]);
    } else if (ptype === 'row') {
      setElems(prev => [...prev, {
        id, kind: 'row', x, y: snapV(pt.y - DEF_STALLH / 2), rot: 0,
        count: DEF_COUNT, stallW: DEF_STALLW, stallH: DEF_STALLH,
      } as RowEl]);
    }
  }

  // ── element mutations ─────────────────────────────────────────────────────
  function mutate(id: string, patch: Partial<AnyEl>) {
    setElems(prev => prev.map(e => e.id === id ? { ...e, ...patch } as AnyEl : e));
  }

  function deleteEl(id: string) {
    setElems(prev => prev.filter(e => e.id !== id));
    if (selId === id) setSelId(null);
  }

  function rotateEl(id: string) {
    const el = elems.find(e => e.id === id);
    if (!el) return;
    const newRot: Rot = el.rot === 0 ? 90 : 0;
    mutate(id, { rot: newRot });
  }

  // ── total stall count for display ─────────────────────────────────────────
  const totalStalls = elems.reduce((sum, e) => {
    if (e.kind === 'road') return sum + e.topCount + e.botCount;
    return sum + e.count;
  }, 0);

  const FONT = 'var(--font-geist-sans), system-ui, sans-serif';
  const DARK = '#0d1b2a';

  // ── render SVG element ────────────────────────────────────────────────────
  function renderEl(el: AnyEl) {
    const isSel = el.id === selId;
    const sColor = isSel ? SEL_C : GREEN;

    if (el.kind === 'road') {
      const topH  = el.topCount > 0 ? el.stallH : 0;
      const botH  = el.botCount > 0 ? el.stallH : 0;
      const totalH = topH + el.roadH + botH;
      const cx    = el.x + el.len / 2;
      const cy    = el.y + totalH / 2;
      const tf    = el.rot !== 0 ? `rotate(90,${cx},${cy})` : '';

      return (
        <g key={el.id} transform={tf}
          onPointerDown={e => startDrag(e, el.id)} onClick={() => setSelId(el.id)}
          style={{ cursor: dragging?.id === el.id ? 'grabbing' : 'grab' }}>

          {/* top stall row */}
          {el.topCount > 0 && Array.from({ length: el.topCount }, (_, i) => {
            const sx = el.x + i * el.stallW;
            const sy = el.y;
            return (
              <g key={`t${i}`}>
                <rect x={sx} y={sy} width={el.stallW} height={el.stallH}
                  fill="rgba(16,185,129,0.22)" stroke={sColor} strokeWidth={isSel ? 2 : 1.5} rx={1} />
                <text x={sx + el.stallW / 2} y={sy + el.stallH / 2 + 4}
                  textAnchor="middle" fontSize={11} fill={sColor} fontWeight="700" fontFamily="monospace">
                  P
                </text>
              </g>
            );
          })}

          {/* road */}
          <rect x={el.x} y={el.y + topH} width={el.len} height={el.roadH}
            fill={ROAD_C} stroke={isSel ? SEL_C : '#64748b'} strokeWidth={isSel ? 2 : 1} rx={2} />
          {/* road center dashes */}
          {Array.from({ length: Math.floor(el.len / 40) }, (_, i) => (
            <line key={i}
              x1={el.x + 20 + i * 40} y1={el.y + topH + el.roadH / 2}
              x2={el.x + 34 + i * 40} y2={el.y + topH + el.roadH / 2}
              stroke="#fff" strokeWidth={2} />
          ))}

          {/* bottom stall row */}
          {el.botCount > 0 && Array.from({ length: el.botCount }, (_, i) => {
            const sx = el.x + i * el.stallW;
            const sy = el.y + topH + el.roadH;
            return (
              <g key={`b${i}`}>
                <rect x={sx} y={sy} width={el.stallW} height={el.stallH}
                  fill="rgba(16,185,129,0.22)" stroke={sColor} strokeWidth={isSel ? 2 : 1.5} rx={1} />
                <text x={sx + el.stallW / 2} y={sy + el.stallH / 2 + 4}
                  textAnchor="middle" fontSize={11} fill={sColor} fontWeight="700" fontFamily="monospace">
                  P
                </text>
              </g>
            );
          })}

          {/* selection outline */}
          {isSel && (
            <rect x={el.x - 3} y={el.y - 3} width={el.len + 6} height={totalH + 6}
              fill="none" stroke={SEL_C} strokeWidth={2} strokeDasharray="6 3" rx={4} />
          )}
        </g>
      );
    }

    // standalone row
    const el2 = el as RowEl;
    const totalW = el2.count * el2.stallW;
    const cx     = el2.x + totalW / 2;
    const cy     = el2.y + el2.stallH / 2;
    const tf     = el2.rot !== 0 ? `rotate(90,${cx},${cy})` : '';
    return (
      <g key={el2.id} transform={tf}
        onPointerDown={e => startDrag(e, el2.id)} onClick={() => setSelId(el2.id)}
        style={{ cursor: dragging?.id === el2.id ? 'grabbing' : 'grab' }}>
        {Array.from({ length: el2.count }, (_, i) => {
          const sx = el2.x + i * el2.stallW;
          return (
            <g key={i}>
              <rect x={sx} y={el2.y} width={el2.stallW} height={el2.stallH}
                fill="rgba(16,185,129,0.22)" stroke={sColor} strokeWidth={isSel ? 2 : 1.5} rx={1} />
              <text x={sx + el2.stallW / 2} y={el2.y + el2.stallH / 2 + 4}
                textAnchor="middle" fontSize={11} fill={sColor} fontWeight="700" fontFamily="monospace">
                P
              </text>
            </g>
          );
        })}
        {isSel && (
          <rect x={el2.x - 3} y={el2.y - 3} width={totalW + 6} height={el2.stallH + 6}
            fill="none" stroke={SEL_C} strokeWidth={2} strokeDasharray="6 3" rx={4} />
        )}
      </g>
    );
  }

  // ── selected element controls ─────────────────────────────────────────────
  function SelControls() {
    if (!sel) return null;
    const isRoad = sel.kind === 'road';

    return (
      <div style={{ background: '#fff', border: '1.5px solid #e7ecf0', borderRadius: 14,
        padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12,
        boxShadow: '0 4px 20px rgba(13,27,42,.10)', fontFamily: FONT }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: DARK }}>
            {isRoad ? '🛣️ Road Block' : '🅿️ Parking Row'}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <CtrlBtn onClick={() => rotateEl(sel.id)} title="Rotate 90°">↻ Rotate</CtrlBtn>
            <CtrlBtn onClick={() => deleteEl(sel.id)} danger title="Delete">✕ Delete</CtrlBtn>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {isRoad && sel.kind === 'road' && (
            <>
              <CountCtrl label="Road length"
                value={sel.len} step={DEF_STALLW}
                onDec={() => mutate(sel.id, { len: Math.max(DEF_STALLW * 2, (sel as RoadEl).len - DEF_STALLW) })}
                onInc={() => mutate(sel.id, { len: (sel as RoadEl).len + DEF_STALLW })} />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Stall rows
                </div>
                {[
                  { label: 'Top row',    count: sel.topCount, key: 'topCount' },
                  { label: 'Bottom row', count: sel.botCount, key: 'botCount' },
                ].map(({ label, count, key }) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={count > 0}
                      onChange={e => mutate(sel.id, { [key]: e.target.checked ? DEF_COUNT : 0 })}
                      style={{ width: 15, height: 15, accentColor: GREEN }} />
                    <span style={{ fontSize: 12.5, color: '#4a5568', minWidth: 70 }}>{label}</span>
                    {count > 0 && (
                      <CountCtrl label="" value={count} step={1}
                        onDec={() => mutate(sel.id, { [key]: Math.max(1, count - 1) })}
                        onInc={() => mutate(sel.id, { [key]: count + 1 })} />
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {!isRoad && sel.kind === 'row' && (
            <CountCtrl label="Stall count"
              value={sel.count} step={1}
              onDec={() => mutate(sel.id, { count: Math.max(1, (sel as RowEl).count - 1) })}
              onInc={() => mutate(sel.id, { count: (sel as RowEl).count + 1 })} />
          )}
        </div>
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', gap: 16, height: '100%', fontFamily: FONT }}>

      {/* palette */}
      <div style={{ width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Drag onto canvas →
        </div>
        {PALETTE.map(p => (
          <div key={p.id} draggable
            onDragStart={e => { e.dataTransfer.setData('ptype', p.id); e.dataTransfer.effectAllowed = 'copy'; }}
            style={{ background: p.color, border: `2px solid ${p.border}`, borderRadius: 12,
              padding: '12px 14px', cursor: 'grab', userSelect: 'none',
              transition: 'transform .1s, box-shadow .1s',
            }}
            onMouseDown={e => (e.currentTarget.style.transform = 'scale(.97)')}
            onMouseUp={e => (e.currentTarget.style.transform = '')}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{p.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: DARK }}>{p.label}</div>
            <div style={{ fontSize: 11.5, color: '#6b7a8d', marginTop: 2, lineHeight: 1.4 }}>{p.sub}</div>
          </div>
        ))}

        <div style={{ borderTop: '1px solid #e7ecf0', paddingTop: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#6b7a8d', cursor: 'pointer' }}>
            <input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)}
              style={{ accentColor: GREEN }} />
            Show grid
          </label>
        </div>

        {/* camera perspective */}
        <div style={{ borderTop: '1px solid #e7ecf0', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Camera perspective
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#4a5568', cursor: 'pointer' }}>
            <input type="checkbox" checked={quadOn} onChange={e => enablePerspective(e.target.checked)}
              style={{ accentColor: PERSP_C }} />
            Mark parking area
          </label>
          {quadOn && (
            <>
              <div style={{ fontSize: 11.5, color: '#6b7a8d', lineHeight: 1.5 }}>
                Drag the 4 blue dots onto the corners of the parking ground.
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12.5,
                color: '#4a5568', cursor: 'pointer', background: '#f0f9ff', border: '1px solid #bae6fd',
                borderRadius: 9, padding: '8px 10px' }}>
                <input type="checkbox" checked={topdown} onChange={e => setTopdown(e.target.checked)}
                  style={{ accentColor: PERSP_C, marginTop: 1 }} />
                <span><b>Bird&apos;s-eye correction</b><br />
                  <span style={{ fontSize: 11.5, color: '#6b7a8d' }}>Straightens an angled view before AI detection — improves accuracy on far/clustered cars.</span>
                </span>
              </label>
            </>
          )}
        </div>

        {elems.length > 0 && (
          <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '10px 12px',
            border: '1px solid #86efac', fontSize: 12.5, color: '#065f46', lineHeight: 1.6 }}>
            <b>{totalStalls}</b> stalls<br />
            <b>{elems.filter(e => e.kind === 'road').length}</b> road{elems.filter(e => e.kind === 'road').length !== 1 ? 's' : ''}
          </div>
        )}

        {elems.length > 0 && (
          <button onClick={() => { setElems([]); setSelId(null); }}
            style={{ border: '1.5px solid #fee2e2', background: '#fff5f5', color: '#dc2626',
              borderRadius: 9, padding: '7px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Clear all
          </button>
        )}
      </div>

      {/* canvas + controls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>

        {/* SVG canvas */}
        <div style={{ borderRadius: 14, overflow: 'hidden', border: dragOver ? `2px solid ${GREEN}` : '2px solid #e7ecf0',
          background: '#0d1b2a', transition: 'border-color .15s', flex: 1 }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${vw} ${vh}`}
            style={{ display: 'block', width: '100%', height: '100%' }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={e => { if (e.target === svgRef.current) setSelId(null); }}
          >
            {/* background camera image */}
            {imageUrl ? (
              <image href={imageUrl} x={0} y={0} width={vw} height={vh} preserveAspectRatio="xMidYMid slice" />
            ) : (
              <rect x={0} y={0} width={vw} height={vh} fill="#1a2744" />
            )}

            {/* dim overlay so elements are visible */}
            <rect x={0} y={0} width={vw} height={vh} fill="rgba(0,0,0,0.25)" />

            {/* grid */}
            {grid && (
              <g opacity={0.18}>
                {Array.from({ length: Math.floor(vw / SNAP) + 1 }, (_, i) => (
                  <line key={`gv${i}`} x1={i * SNAP} y1={0} x2={i * SNAP} y2={vh} stroke="#fff" strokeWidth={0.5} />
                ))}
                {Array.from({ length: Math.floor(vh / SNAP) + 1 }, (_, i) => (
                  <line key={`gh${i}`} x1={0} y1={i * SNAP} x2={vw} y2={i * SNAP} stroke="#fff" strokeWidth={0.5} />
                ))}
              </g>
            )}

            {/* empty state hint */}
            {elems.length === 0 && (
              <text x={vw / 2} y={vh / 2} textAnchor="middle" fontSize={16}
                fill="rgba(255,255,255,0.4)" fontFamily={FONT} fontWeight={600}>
                Drag elements from the left panel to build your lot
              </text>
            )}

            {/* elements */}
            {elems.map(renderEl)}

            {/* camera-perspective quad */}
            {quadOn && quad && (
              <g>
                <polygon
                  points={quad.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill={`${PERSP_C}22`} stroke={PERSP_C} strokeWidth={2.5} strokeDasharray="8 4" />
                {/* edge midpoint guides */}
                {quad.map((p, i) => {
                  const n = quad[(i + 1) % 4];
                  return <line key={`e${i}`} x1={p[0]} y1={p[1]} x2={n[0]} y2={n[1]} stroke={PERSP_C} strokeWidth={1} opacity={0.5} />;
                })}
                {/* draggable corner handles */}
                {quad.map(([x, y], i) => (
                  <g key={`c${i}`}>
                    <circle cx={x} cy={y} r={11} fill={PERSP_C} stroke="#fff" strokeWidth={2.5}
                      style={{ cursor: cornerDrag === i ? 'grabbing' : 'grab' }}
                      onPointerDown={e => startCornerDrag(e, i)} />
                    <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={800}
                      fill="#fff" style={{ pointerEvents: 'none' }}>{i + 1}</text>
                  </g>
                ))}
              </g>
            )}
          </svg>
        </div>

        {/* selected element controls */}
        <SelControls />

        {elems.length === 0 && (
          <div style={{ fontSize: 12, color: '#9aa6b2', textAlign: 'center', lineHeight: 1.7 }}>
            Tip: Drag <b>Road + Auto-Fill</b> to create a road with stalls already placed on both sides.
            Drag more roads, adjust stall counts, and the AI will know exactly where every spot is.
          </div>
        )}
      </div>
    </div>
  );
}

// ── small control components ──────────────────────────────────────────────────
function CtrlBtn({ children, onClick, danger, title }: {
  children: React.ReactNode; onClick: () => void; danger?: boolean; title?: string;
}) {
  return (
    <button onClick={onClick} title={title} style={{
      border: `1.5px solid ${danger ? '#fee2e2' : '#e1e7ec'}`,
      background: danger ? '#fff5f5' : '#fff',
      color: danger ? '#dc2626' : '#4a5568',
      borderRadius: 8, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    }}>
      {children}
    </button>
  );
}

function CountCtrl({ label, value, step, onDec, onInc }: {
  label: string; value: number; step: number; onDec: () => void; onInc: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <div style={{ fontSize: 11, fontWeight: 700, color: '#9aa6b2', textTransform: 'uppercase', letterSpacing: '1px' }}>
          {label}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={onDec} style={countBtnStyle()}>−</button>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', minWidth: 28, textAlign: 'center' }}>
          {value}
        </span>
        <button onClick={onInc} style={countBtnStyle()}>+</button>
      </div>
    </div>
  );
}

function countBtnStyle(): React.CSSProperties {
  return {
    border: '1.5px solid #e1e7ec', background: '#f7f9fb', color: '#0d1b2a',
    borderRadius: 7, width: 28, height: 28, fontSize: 16, fontWeight: 700,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0,
  };
}
