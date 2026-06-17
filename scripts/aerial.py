"""
Vacant — clean bird's-eye layout for PAVED (painted-stall) lots.

The old demo_paved.aerial_preview warped/squished because its "homography" was a
minAreaRect box around the stall cloud — a rotate+scale, NOT a perspective
rectification. This module does it the RIGHT way:

  1. PROPER 4-corner ground-plane homography (hand-picked lot corners, like
     calibrate.py) → true top-down, perspective removed.
  2. DECOUPLE layout from occupancy: regularize the projected stalls into a clean
     non-overlapping (row, col) grid ONCE (a calibration artifact). Live CV only
     flips taken/open per stall id.
  3. Render a clean schematic that reads like a real parking-app map.

Diagnostic first so the quad can be eyeballed before the regularizer runs:
  .venv/bin/python scripts/aerial.py --frame <f.jpg> --xml <f.xml> --diag
"""
import argparse
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from pklot_eval import parse_spaces


def load(frame_path, xml_path):
    frame = cv2.imread(frame_path)
    assert frame is not None, f'cannot read {frame_path}'
    sp = parse_spaces(xml_path)
    assert sp, f'no stalls in {xml_path}'
    stalls = [{'poly': np.array(p, np.float32), 'occ': bool(o)} for o, p in sp]
    return frame, stalls


def centers(stalls):
    return np.array([s['poly'].mean(0) for s in stalls], np.float32)


def order_quad(pts):
    """[TL,TR,BR,BL] by image position (top two by x, bottom two by x)."""
    pts = np.array(pts, np.float32)
    pts = pts[np.argsort(pts[:, 1])]
    top = pts[:2][np.argsort(pts[:2, 0])]
    bot = pts[2:][np.argsort(pts[2:, 0])]
    return np.array([top[0], top[1], bot[1], bot[0]], np.float32)


def homography(quad, mw, mh):
    src = np.array(quad, np.float32)
    dst = np.array([[0, 0], [mw, 0], [mw, mh], [0, mh]], np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def project(H, pts):
    a = np.array(pts, np.float32).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(a, H).reshape(-1, 2)


def draw_grid(viz, step=100):
    h, w = viz.shape[:2]
    for x in range(0, w, step):
        cv2.line(viz, (x, 0), (x, h), (60, 60, 60), 1)
        cv2.putText(viz, str(x), (x + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (180, 255, 255), 1)
    for y in range(0, h, step):
        cv2.line(viz, (0, y), (w, y), (60, 60, 60), 1)
        cv2.putText(viz, str(y), (2, y + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (180, 255, 255), 1)


def image_diag(frame, stalls, quad, out, grid=False):
    viz = frame.copy()
    if grid:
        draw_grid(viz)
    for s in stalls:
        poly = s['poly'].astype(np.int32)
        cv2.polylines(viz, [poly], True, (40, 40, 220) if s['occ'] else (70, 200, 70), 2)
        ctr = s['poly'].mean(0).astype(int)
        cv2.circle(viz, tuple(ctr), 3, (0, 220, 255), -1)
    q = quad.astype(np.int32)
    cv2.polylines(viz, [q], True, (0, 255, 255), 2)
    for i, p in enumerate(q):
        cv2.circle(viz, tuple(p), 7, (255, 0, 255), -1)
        cv2.putText(viz, 'TL TR BR BL'.split()[i], tuple(p + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 255), 2)
    cv2.imwrite(out, viz)


def topdown_diag(stalls, quad, out, mw=1000):
    pts = np.vstack([s['poly'] for s in stalls])
    # estimate map height from the quad's v/u extent
    H0 = homography(quad, mw, mw)
    pr = project(H0, pts)
    mh = int(mw * (np.ptp(pr[:, 1]) / (np.ptp(pr[:, 0]) + 1e-6)))
    mh = max(200, min(1400, mh))
    H = homography(quad, mw, mh)
    sc = 900 / mw
    img = np.full((int(mh * sc) + 40, int(mw * sc) + 40, 3), 50, np.uint8)
    for s in stalls:
        pp = (project(H, s['poly']) * sc + 20).astype(np.int32)
        cv2.fillPoly(img, [pp], (45, 45, 150) if s['occ'] else (70, 150, 70))
        cv2.polylines(img, [pp], True, (235, 240, 245), 1)
    cv2.imwrite(out, img)
    return H, mw, mh


# ----------------------------------------------------------------------------
# Regularizer: rectified stalls -> clean non-overlapping (row, col) grid.
# Decoupled from occupancy: this is a CALIBRATION artifact computed once.
# ----------------------------------------------------------------------------

def _rot(theta):
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, -s], [s, c]], np.float32)


def _axial_mean(angs):
    """Mean of undirected angles (mod pi) — robust for 'which way do rows run'."""
    return 0.5 * np.arctan2(np.mean(np.sin(2 * angs)), np.mean(np.cos(2 * angs)))


def _nn_angles(cents):
    angs = []
    for i in range(len(cents)):
        d = np.linalg.norm(cents - cents[i], axis=1)
        d[i] = 1e18
        v = cents[d.argmin()] - cents[i]
        angs.append(np.arctan2(v[1], v[0]))
    return np.array(angs)


def _cluster_1d(vals, gap):
    """Sorted-gap clustering: returns list of index-lists, one per cluster."""
    order = np.argsort(vals)
    clusters, cur = [], [order[0]]
    for k in order[1:]:
        if vals[k] - vals[cur[-1]] > gap:
            clusters.append(cur)
            cur = [k]
        else:
            cur.append(k)
    clusters.append(cur)
    return clusters


def _derotate(pts):
    th = _axial_mean(_nn_angles(pts))
    mean = pts.mean(0)
    rc = (pts - mean) @ _rot(-th).T
    return rc, th, mean


def _rot_sizes(polys, th, mean):
    """median (along-row, cross-row) stall size in the de-rotated frame."""
    R = _rot(-th).T
    ws, hs = [], []
    for p in polys:
        q = (np.asarray(p, np.float32) - mean) @ R
        ws.append(np.ptp(q[:, 0]))
        hs.append(np.ptp(q[:, 1]))
    return float(np.median(ws)), float(np.median(hs))


def _anchor_rows(rc, h0):
    """rows (index lists) sorted far->near, keeping only non-fragment 'anchor' rows
    for robust geometry (a lone straggler stall is not an anchor)."""
    rows = _cluster_1d(rc[:, 1], gap=0.55 * h0)
    rows.sort(key=lambda r: rc[r, 1].mean())
    med = float(np.median([len(r) for r in rows]))
    anchors = [r for r in rows if len(r) >= max(2, 0.4 * med)]
    return rows, anchors or rows


def fit_quad(stalls):
    """Proper perspective trapezoid: take the FAR and NEAR anchor rows and use their
    extreme stalls as the 4 ground-rectangle corners. In image space the far edge is
    shorter than the near edge (perspective) — so mapping this trapezoid to a
    rectangle genuinely removes foreshortening. (minAreaRect can't: its source is
    already a rectangle, so it only rotates+scales.)"""
    cents = centers(stalls)
    rc, th, mean = _derotate(cents)
    w0, h0 = _rot_sizes([s['poly'] for s in stalls], th, mean)
    _, anchors = _anchor_rows(rc, h0)
    far, near = np.array(anchors[0]), np.array(anchors[-1])
    fl, fr = far[rc[far, 0].argmin()], far[rc[far, 0].argmax()]
    nl, nr = near[rc[near, 0].argmin()], near[rc[near, 0].argmax()]
    return order_quad(np.array([cents[fl], cents[fr], cents[nr], cents[nl]], np.float32))


def _blocks(cents, link):
    """Connected components of stalls (union-find on a proximity graph). Stalls within
    a block are linked; a wide empty gap (a horseshoe's tree island between two arms,
    or two separate aisles) breaks the link -> separate blocks. Simple rectangular lots
    return one block."""
    n = len(cents)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for i in range(n):
        d = np.linalg.norm(cents - cents[i], axis=1)
        for j in np.where(d <= link)[0]:
            if j > i:
                parent[find(i)] = find(int(j))
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def _dissolve_rows(sub_rc, h0):
    """cluster a block's stalls into rows (far->near) and dissolve fragment rows into
    the nearest real row, so nothing floats in its own mini-row. Returns (rows, pitch)."""
    rows = _cluster_1d(sub_rc[:, 1], gap=0.55 * h0)
    rows.sort(key=lambda r: float(np.mean(sub_rc[r, 1])))
    med = float(np.median([len(r) for r in rows]))
    thresh = max(2, 0.35 * med)
    big = [list(r) for r in rows if len(r) >= thresh] or [list(r) for r in rows]
    bc = [float(np.mean(sub_rc[r, 1])) for r in big]
    for r in rows:
        if len(r) >= thresh:
            continue
        for i in r:
            big[int(np.argmin([abs(sub_rc[i, 1] - c) for c in bc]))].append(i)
    row_pitch = float(np.median(np.diff(sorted(bc)))) if len(bc) > 1 else h0
    return big, bc, row_pitch


def build_layout(stalls, quad=None):
    """Clean, decoupled layout. Project stalls through a PROPER homography, split into
    BLOCKS (so a horseshoe's two arms aren't flattened into shared rows), then per block
    cluster into even rows, dissolve stragglers, and even-space each row — each block
    placed at its REAL position so left/right + the tree gap are preserved. Returns
    (layout, meta) where layout = [{row,col,gx,gy,occ,src}] in stall-width units; occ is
    carried per stall id so live CV only flips taken/open later."""
    if quad is None:
        quad = fit_quad(stalls)
    H = homography(quad, 1000, 1000)            # square dst ok: affine x/y, evenness kept
    td = [project(H, s['poly']) for s in stalls]
    occ = [bool(s['occ']) for s in stalls]
    cents = np.array([p.mean(0) for p in td], np.float32)
    rc, th, mean = _derotate(cents)
    w0, h0 = _rot_sizes(td, th, mean)
    pitch_x = w0

    # link just under a typical drive-aisle so a simple lot stays ONE block (perfectly
    # even rows) but a horseshoe's tree-island gap / detached section splits off.
    blocks = _blocks(rc, link=2.5 * max(w0, h0))
    out, n_rows = [], 0
    for blk in blocks:
        blk = np.array(blk)
        sub = rc[blk]
        big, bc, row_pitch = _dissolve_rows(sub, h0)
        y0 = min(bc)
        for r_idx, members in enumerate(big):
            members = sorted(set(members), key=lambda i: sub[i, 0])
            nm = len(members)
            cx = float(np.median([sub[i, 0] for i in members]))   # block-row centroid (keeps real x offset)
            gy = (y0 + r_idx * row_pitch) / pitch_x               # even rows, anchored at the block's real depth
            for j, i in enumerate(members):
                gx = (cx + (j - (nm - 1) / 2.0) * pitch_x) / pitch_x
                out.append({'row': n_rows + r_idx, 'col': j, 'gx': gx, 'gy': gy,
                            'occ': occ[int(blk[i])], 'src': int(blk[i])})
        n_rows += len(big)
    return out, {'n_rows': n_rows, 'n_blocks': len(blocks), 'aspect': h0 / pitch_x,
                 'depth_units': h0 / pitch_x, 'quad': np.asarray(quad).astype(float).tolist()}


def layout_to_polys(layout, meta, cell=46, pad=1.0):
    """Clean layout -> top-down quad polys (pixel coords), uniform stalls. Returns
    (polys[[x,y]x4], occ[], (W,H)). Stall drawn narrower than pitch w/ a gap."""
    sw = 0.86                      # stall width as frac of pitch (along-row)
    sd = max(0.7, meta['depth_units'] * 0.9)   # stall depth (across-row), in pitch units
    gx = np.array([s['gx'] for s in layout])
    gy = np.array([s['gy'] for s in layout])
    minx, maxx = gx.min(), gx.max()
    miny, maxy = gy.min(), gy.max()
    ox, oy = minx - pad, miny - sd / 2 - pad
    W = int((maxx - minx + 2 * pad) * cell)
    Hh = int((maxy - miny + sd + 2 * pad) * cell)
    polys, occ = [], []
    for s in layout:
        cx, cy = s['gx'], s['gy']
        corners = [(cx - sw / 2, cy - sd / 2), (cx + sw / 2, cy - sd / 2),
                   (cx + sw / 2, cy + sd / 2), (cx - sw / 2, cy + sd / 2)]
        polys.append([[round((x - ox) * cell, 1), round((y - oy) * cell, 1)] for x, y in corners])
        occ.append(s['occ'])
    return polys, occ, (W, Hh)


def render_polys(polys, taken, size, path):
    """Clean flat top-down render of arbitrary stall polys + a SEPARATE occupancy
    array (green=open, slate=taken). Occupancy is decoupled from layout."""
    W, Hh = size
    img = np.full((Hh, W, 3), 58, np.uint8)
    for poly, tk in zip(polys, taken):
        q = np.array(poly, np.int32)
        cv2.fillPoly(img, [q], (74, 78, 92) if tk else (110, 200, 130))
        cv2.polylines(img, [q], True, (244, 247, 250), 2)
        if not tk:
            c = q.mean(0).astype(int)
            cv2.circle(img, tuple(c), 5, (255, 255, 255), -1)
    cv2.imwrite(path, img)
    return W, Hh


def aerial_render(layout, meta, path):
    """Proof render straight from a layout's own (ground-truth) occupancy."""
    polys, occ, size = layout_to_polys(layout, meta)
    return render_polys(polys, occ, size, path)


def clean_stalls(stalls, quad=None):
    """CALIBRATION ARTIFACT (decoupled from occupancy): clean top-down stall polys
    indexed by ORIGINAL stall id, plus the map size. Live CV computes per-id
    taken/open separately and zips it against these fixed polys for display."""
    layout, meta = build_layout(stalls, quad)
    polys, _occ, size = layout_to_polys(layout, meta)
    by_id = {s['src']: poly for s, poly in zip(layout, polys)}
    ordered = [by_id[i] for i in range(len(stalls))]
    return ordered, size, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--frame', required=True)
    ap.add_argument('--xml')
    ap.add_argument('--quad', help='8 ints TL,TR,BR,BL (override auto)')
    ap.add_argument('--diag', action='store_true')
    ap.add_argument('--build', action='store_true', help='build + render the clean layout')
    ap.add_argument('--grid', action='store_true', help='overlay coord grid to read corner pixels')
    ap.add_argument('--tag', default='aerial')
    args = ap.parse_args()
    xml = args.xml or os.path.splitext(args.frame)[0] + '.xml'
    frame, stalls = load(args.frame, xml)

    if args.quad:
        n = [int(v) for v in args.quad.split(',')]
        quad = order_quad(np.array([[n[i], n[i + 1]] for i in range(0, 8, 2)], np.float32))
    else:
        quad = fit_quad(stalls)
    print('quad TL,TR,BR,BL =', quad.astype(int).tolist())

    if args.diag:
        image_diag(frame, stalls, quad, f'work/{args.tag}_imgdiag.jpg', grid=args.grid)
        topdown_diag(stalls, quad, f'work/{args.tag}_topdiag.jpg')
        print(f'wrote work/{args.tag}_imgdiag.jpg + _topdiag.jpg')

    if args.build:
        layout, meta = build_layout(stalls, quad)
        W, Hh = aerial_render(layout, meta, f'work/{args.tag}_clean.jpg')
        print(f'rows={meta["n_rows"]} stalls={len(layout)} aspect={meta["aspect"]:.2f} '
              f'-> work/{args.tag}_clean.jpg ({W}x{Hh})')


if __name__ == '__main__':
    main()
