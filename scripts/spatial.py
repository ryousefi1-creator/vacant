"""
Vacant — shared spatial helpers (homography image->top-down + projection).

A car's TRUE map position = project its ground-contact point (bottom-center of
its box) through the per-camera homography. Used by calibrate.py (verify) and
push.py (runtime). No painted stalls needed; works on gravel lots.
"""
import glob
import json
import os

import cv2
import numpy as np

VEHICLE = [2, 3, 5, 7]


def homography(quad, mw, mh):
    src = np.array(quad, np.float32)
    dst = np.array([[0, 0], [mw, 0], [mw, mh], [0, mh]], np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def contacts(xy):
    """Ground-contact point (bottom-center) for each xyxy box."""
    return [((x1 + x2) / 2.0, y2) for x1, y1, x2, y2 in xy]


def project(H, pts):
    if len(pts) == 0:
        return np.empty((0, 2))
    a = np.array(pts, np.float32).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(a, H).reshape(-1, 2)


def clahe_enhance(frame):
    """CLAHE on the L channel: lifts detail in shadowed carport/garage areas
    without blowing out highlights. Use when cars are partially under a canopy."""
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)


def detect(model, frame, conf, imgsz, device, iou_thr=0.45):
    """Single-pass vehicle detection -> xyxy boxes (Nx4, image space).
    iou_thr: YOLO internal NMS threshold — lower = keep more adjacent boxes
    (0.3–0.4 for close carport cars; 0.7 default keeps merged boxes)."""
    r = model.predict(frame, classes=VEHICLE, conf=conf, imgsz=imgsz,
                      verbose=False, device=device, iou=iou_thr)[0]
    return r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4), np.float32)


def _nms(boxes, scores, iou_thr=0.5, contain_thr=0.7):
    """Greedy NMS with containment suppression for tile-shard collapse.

    A box is suppressed if it overlaps a KEPT (higher-confidence) box by
    IoU >= iou_thr  OR  is >= contain_thr contained inside it.

    The containment test collapses tile SHARDS of ONE car (a half-car sliver
    sitting fully inside the whole-car box).  BUT: a merged detection that
    spans 3 adjacent cars is 3× larger than each individual car — we must NOT
    let that merged box suppress the individual detections.  Guard: containment
    suppression only fires when the kept box is at most 2.2× the candidate's
    area.  Tile shards are roughly the same size as the car (ratio ≈ 0.5–1.5),
    so they're still collapsed.  A 3-car merged box (ratio ≈ 3) is left alone,
    keeping the individual car boxes alive."""
    if len(boxes) == 0:
        return []
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        rest = order[1:]
        xx1 = np.maximum(x1[i], x1[rest]); yy1 = np.maximum(y1[i], y1[rest])
        xx2 = np.minimum(x2[i], x2[rest]); yy2 = np.minimum(y2[i], y2[rest])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        iou = inter / (areas[i] + areas[rest] - inter + 1e-9)
        contain = inter / (np.minimum(areas[i], areas[rest]) + 1e-9)
        # Only apply containment suppression when the kept box isn't much bigger
        # (prevents a wide merged 3-car box from swallowing individual car boxes)
        area_ratio = areas[i] / (areas[rest] + 1e-9)
        suppress_contain = (contain >= contain_thr) & (area_ratio <= 2.2)
        order = rest[(iou <= iou_thr) & ~suppress_contain]
    return keep


def detect_tiled(model, frame, conf, imgsz, device, grid=3, tile_ov=0.2,
                 full_imgsz=1920, iou_thr=0.45):
    """SAHI-style detection. Full-frame pass (large near cars) + overlapping tile grid
    (small far cars), merged with containment NMS.  iou_thr is passed to both the
    YOLO internal NMS and the post-tile NMS so close cars aren't merged."""
    fh, fw = frame.shape[:2]
    boxes, scores = [], []

    def collect(res, ox=0, oy=0):
        if res.boxes is None or not len(res.boxes):
            return
        for bx, sc in zip(res.boxes.xyxy.cpu().numpy(), res.boxes.conf.cpu().numpy()):
            boxes.append([bx[0] + ox, bx[1] + oy, bx[2] + ox, bx[3] + oy])
            scores.append(float(sc))

    collect(model.predict(frame, classes=VEHICLE, conf=conf, imgsz=full_imgsz,
                          verbose=False, device=device, iou=iou_thr)[0])
    tw, th = fw / grid, fh / grid
    px, py = tw * tile_ov, th * tile_ov
    for r in range(grid):
        for c in range(grid):
            x0, y0 = max(0, int(c * tw - px)), max(0, int(r * th - py))
            x1, y1 = min(fw, int((c + 1) * tw + px)), min(fh, int((r + 1) * th + py))
            collect(model.predict(frame[y0:y1, x0:x1], classes=VEHICLE, conf=conf,
                                  imgsz=imgsz, verbose=False, device=device, iou=iou_thr)[0], x0, y0)
    if not boxes:
        return np.empty((0, 4), np.float32)
    boxes = np.array(boxes, np.float32)
    return boxes[_nms(boxes, np.array(scores, np.float32))]


def detect_topdown(model, frame, calib, conf, imgsz, device, iou_thr=0.35):
    """Bird's-eye detection: warp the lot region to a flat top-down view,
    run YOLO on the undistorted image, back-project boxes to the original frame.

    Fixes two problems at once:
    1. Perspective compression — far cars are the same pixel size as near cars
       in the warped view, so YOLO sees uniform-looking cars throughout.
    2. Adjacent-car separation — cars side by side under a canopy look evenly
       spaced from above, reducing bounding-box overlap and NMS merging.

    Requires a reasonably tight lot_quad (not the full frame). The auto-stall
    learner in push.py refines lot_quad after the first successful stall derive,
    at which point this mode becomes effective."""
    mw, mh = calib['map_size']
    H = homography(calib['lot_quad'], mw, mh)

    # Scale up so YOLO gets at least imgsz on the longer edge
    scale = max(imgsz / max(mw, mh), 1.0)
    W_out, H_out = int(round(mw * scale)), int(round(mh * scale))
    S = np.array([[scale, 0, 0], [0, scale, 0], [0, 0, 1]], np.float64)
    H_final = (S @ H).astype(np.float32)

    top = cv2.warpPerspective(frame, H_final, (W_out, H_out))
    r = model.predict(top, classes=VEHICLE, conf=conf, imgsz=imgsz,
                      verbose=False, device=device, iou=iou_thr)[0]
    if r.boxes is None or not len(r.boxes):
        return np.empty((0, 4), np.float32)

    td_boxes = r.boxes.xyxy.cpu().numpy()
    H_inv = np.linalg.inv(H_final)
    orig_boxes = []
    for bx1, by1, bx2, by2 in td_boxes:
        corners = np.array([[bx1,by1],[bx2,by1],[bx2,by2],[bx1,by2]], np.float32)
        orig = project(H_inv, corners)
        orig_boxes.append([float(orig[:,0].min()), float(orig[:,1].min()),
                           float(orig[:,0].max()), float(orig[:,1].max())])
    return np.array(orig_boxes, np.float32)


# --- LOT REGION PARAMETERS (how a detected car is assigned to THIS lot) ----------
# A camera sees more than its lot (road, neighbor spots, trees). The old test kept a
# car only if its ground-contact POINT projected inside the quad — which DROPS a car
# straddling the lot edge (contact lands just outside) even though it's parked here,
# and says nothing about cars cut off by the frame. These explicit, tunable knobs
# replace that single fragile point:
INSIDE_OVERLAP = 0.15    # count a boundary/straddling car if >= this fraction of its box is inside the quad
                         # (0.50 dropped real edge-parked cars whose box only clips the quad; under-counting
                         #  = over-reporting open spaces = the dangerous direction, so we count on any real touch)
EDGE_MARGIN_PX = 3       # a box within this many px of a frame border is 'partial' (cut off / possibly out of view)


def _overlap_frac(box, quad):
    """fraction of a car's box area that lies inside the lot quad (image space)."""
    x1, y1, x2, y2 = box
    bq = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], np.float32)
    inter, _ = cv2.intersectConvexConvex(bq, np.asarray(quad, np.float32))
    return float(inter) / max((x2 - x1) * (y2 - y1), 1.0)


def _touches_edge(box, fw, fh, m):
    x1, y1, x2, y2 = box
    return bool(x1 <= m or y1 <= m or x2 >= fw - m or y2 >= fh - m)


def classify_cars(calib, xy, frame_shape, inside_overlap=INSIDE_OVERLAP, edge_margin=EDGE_MARGIN_PX):
    """Per-detection lot membership with explicit parameters. Returns a list of
    {box, contact, map:[x,y], in_quad, frac, partial, status}:
       'in'       counted — fully framed, ground-contact inside the lot
       'boundary' counted — straddles the lot edge (kept via box-overlap, not contact)
       'partial'  counted — but the box is cut off by the frame edge (may be out of view)
       'out'      dropped — off-lot (road / neighbor spot / tree false-positive)
    A car's display position is its contact projected to top-down, CLAMPED onto the
    lot so a boundary car renders at the lot edge instead of off-map."""
    mw, mh = calib['map_size']
    H = homography(calib['lot_quad'], mw, mh)
    quad = np.array(calib['lot_quad'], np.float32)
    fh, fw = frame_shape[:2]
    out = []
    for box in xy:
        contact = ((box[0] + box[2]) / 2.0, float(box[3]))
        mx, my = (project(H, [contact])[0]).tolist()
        in_quad = 0 <= mx <= mw and 0 <= my <= mh
        frac = _overlap_frac(box, quad)
        partial = _touches_edge(box, fw, fh, edge_margin)
        counted = in_quad or frac >= inside_overlap
        status = 'out' if not counted else ('partial' if partial else ('in' if in_quad else 'boundary'))
        out.append({
            'box': [float(v) for v in box], 'contact': [float(contact[0]), float(contact[1])],
            'map': [round(min(max(mx, 0), mw), 1), round(min(max(my, 0), mh), 1)],
            'in_quad': bool(in_quad), 'frac': round(frac, 2), 'partial': partial, 'status': status,
        })
    return out


def map_cars(calib, xy, frame_shape=None):
    """Counted cars (overlap-robust) as {x,y,partial} top-down + inside mask. Boundary
    and partial cars are now INCLUDED (under-counting = over-reporting open spaces,
    the dangerous direction). frame_shape defaults to the calibrated frame size."""
    fs = frame_shape if frame_shape is not None else (calib['frame'][1], calib['frame'][0])
    info = classify_cars(calib, xy, fs)
    cars = [{'x': c['map'][0], 'y': c['map'][1], 'partial': c['partial']} for c in info if c['status'] != 'out']
    return cars, [c['status'] != 'out' for c in info]


def load_calibs(calib_dir='calib'):
    out = {}
    for p in sorted(glob.glob(os.path.join(calib_dir, '*.json'))):
        c = json.load(open(p))
        if 'id' not in c:
            continue
        out[c['id']] = c
    return out


# --- per-stall occupancy (PAVED lots with real painted/marked stalls only) ---
# A car box covering >= `overlap` of a stall's area marks it taken. This is the
# SAME box-overlap metric proven in scripts/live.py + pklot_eval.py — kept in one
# place so the worker (push.py) and the demo (demo_paved.py) can't drift.

def stall_states(stalls, xy, overlap=0.30):
    """stalls = [{'poly': [[x,y]x4 image coords]}]; xy = car boxes (image space).
    Returns a list of bools (True = taken) aligned to `stalls`."""
    quads = [np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], np.float32) for x1, y1, x2, y2 in xy]
    out = []
    for s in stalls:
        poly = np.array(s['poly'], np.float32)
        area = max(cv2.contourArea(poly), 1.0)
        best = max((cv2.intersectConvexConvex(poly, cq)[0] for cq in quads), default=0.0)
        out.append(bool(best / area >= overlap))
    return out


def project_stalls(calib, states):
    """Project each stall's image polygon to TOP-DOWN map coords (via the lot
    homography) so the UI can draw real spots in real positions, each tagged
    taken/open. Returns [{'poly': [[mx,my]x4], 'taken': bool}].

    NOTE: this is the RAW per-frame projection — it warps/squishes on oblique or
    irregular lots because a single homography can't regularize jittery hand-drawn
    polys. Prefer display_stalls(), which uses the CLEAN calibrated layout."""
    mw, mh = calib['map_size']
    H = homography(calib['lot_quad'], mw, mh)
    out = []
    for s, taken in zip(calib['stalls'], states):
        pts = project(H, s['poly'])
        out.append({'poly': [[round(float(x), 1), round(float(y), 1)] for x, y in pts], 'taken': bool(taken)})
    return out


def display_stalls(calib, states):
    """DECOUPLED render contract: zip the CLEAN, pre-regularized layout polys
    (calib['layout'], built once at calibration by scripts/aerial.clean_stalls)
    with this frame's live occupancy. The layout never moves; live CV only flips
    taken/open per stall id. Falls back to the raw projection if a lot was
    calibrated before the clean-layout step existed."""
    layout = calib.get('layout')
    if not layout:
        return project_stalls(calib, states)
    return [{'poly': s['poly'], 'taken': bool(t)} for s, t in zip(layout, states)]


# ─── auto-stall learning ──────────────────────────────────────────────────────
# Given multiple frames of raw YOLO boxes, cluster into stable car positions,
# group into parking rows, fill gaps (empty stalls between cars), and extend
# each row at both ends so edge empty spots are included.
# Used by push.py to auto-derive stalls from the live stream without any
# separate calibration step.

def _asl_cluster(all_boxes, min_votes=1):
    """Cluster raw boxes from N frames into stable car positions using
    CENTER-POINT distance (in units of median box width).

    Why not IoU: adjacent cars' bounding boxes may barely touch (IoU ≈ 0.05)
    or be completely non-overlapping, so IoU-based clustering merges nothing
    and returns one cluster per frame-detection — producing one stall per
    observed box, which is correct only if every observation is a different car.
    But observations of the SAME car across frames have near-identical centers,
    while TWO DIFFERENT adjacent cars have centers roughly one car-width apart.
    Distance-in-car-widths cleanly separates the two cases regardless of whether
    their boxes overlap.
    """
    if len(all_boxes) == 0:
        return []
    all_boxes = np.array(all_boxes, np.float32)
    # Use median box width as the natural distance unit
    med_w = float(np.median(all_boxes[:, 2] - all_boxes[:, 0]))
    dist_thr = med_w * 0.45  # same physical car if centers within 45% of a car width

    clusters: list[list] = []
    for box in all_boxes:
        cx, cy = (box[0]+box[2])/2, (box[1]+box[3])/2
        merged = False
        for cl in clusters:
            arr = np.array(cl)
            cl_cx = float(np.mean((arr[:,0]+arr[:,2])/2))
            cl_cy = float(np.mean((arr[:,1]+arr[:,3])/2))
            if np.hypot(cx - cl_cx, cy - cl_cy) <= dist_thr:
                cl.append(box.tolist())
                merged = True
                break
        if not merged:
            clusters.append([box.tolist()])
    return [np.mean(cl, axis=0) for cl in clusters if len(cl) >= min_votes]


def _asl_rows(avg_boxes, row_y_tol=0.55):
    """Group averaged car boxes into rows by Y-centroid similarity."""
    if not avg_boxes:
        return []
    tol = float(np.median([b[3] - b[1] for b in avg_boxes])) * row_y_tol
    rows: list[list] = []
    for box in sorted(avg_boxes, key=lambda b: (b[1] + b[3]) / 2):
        cy = (box[1] + box[3]) / 2
        placed = False
        for row in rows:
            if abs(cy - np.mean([(b[1]+b[3])/2 for b in row])) <= tol:
                row.append(box)
                placed = True
                break
        if not placed:
            rows.append([box])
    return [sorted(r, key=lambda b: b[0]) for r in rows]


def _asl_fill_row(row_boxes, target_n=None, extend_ends=1):
    """Fill gaps between detected cars and extend ends. Returns list of boxes."""
    if not row_boxes:
        return []
    med_w = float(np.median([b[2]-b[0] for b in row_boxes]))
    med_h = float(np.median([b[3]-b[1] for b in row_boxes]))
    med_cy = float(np.median([(b[1]+b[3])/2 for b in row_boxes]))

    def make_box(cx):
        return [cx - med_w/2, med_cy - med_h/2, cx + med_w/2, med_cy + med_h/2]

    result = list(row_boxes)
    filled: list = []
    for i, box in enumerate(result):
        filled.append(box)
        if i < len(result) - 1:
            nb = result[i + 1]
            gap = nb[0] - box[2]
            if gap > med_w * 0.8:
                n_miss = max(1, round(gap / med_w) - 1)
                step = (nb[0] - box[2]) / (n_miss + 1)
                for k in range(1, n_miss + 1):
                    filled.append(make_box(box[2] + step * k))
    filled = sorted(filled, key=lambda b: b[0])

    for _ in range(extend_ends):
        cx = filled[0][0] - med_w * 0.5
        if cx > 0:
            filled.insert(0, make_box(cx))
        cx = filled[-1][2] + med_w * 0.5
        filled.append(make_box(cx))

    if target_n and target_n > 0:
        while len(filled) > target_n:
            filled.pop()
        while len(filled) < target_n:
            filled.append(make_box(filled[-1][2] + med_w * 0.5))

    return filled


def _asl_box_to_stall(box, pad_x=0.06, pad_y=0.04):
    x1, y1, x2, y2 = box
    pw, ph = (x2-x1)*pad_x, (y2-y1)*pad_y
    return {'poly': [[int(x1-pw), int(y1-ph)], [int(x2+pw), int(y1-ph)],
                     [int(x2+pw), int(y2+ph)], [int(x1-pw), int(y2+ph)]]}


def auto_stalls(all_boxes, extend_ends=1, capacity=0, row_y_tol=0.55, frame_wh=None):
    """Full pipeline: cluster box observations -> rows -> fill gaps -> extend ends.

    all_boxes  : (N, 4) array of YOLO xyxy boxes accumulated across multiple frames.
    frame_wh   : (width, height) of the source frame — stalls are clamped to this
                 boundary so phantom stalls can't extend beyond the image edge.
    Returns list of {'poly': [[x,y]x4]} image-space stall dicts, or [].
    """
    avg = _asl_cluster(all_boxes, min_votes=1)
    if not avg:
        return []
    rows = _asl_rows(avg, row_y_tol=row_y_tol)
    per_row_cap = None
    if capacity > 0 and rows:
        n = sum(len(r) for r in rows)
        per_row_cap = [round(capacity * len(r) / n) for r in rows]
        per_row_cap[0] += capacity - sum(per_row_cap)
    fw = float(frame_wh[0]) if frame_wh else float('inf')
    fh = float(frame_wh[1]) if frame_wh else float('inf')
    stalls = []
    for ri, row in enumerate(rows):
        cap_row = per_row_cap[ri] if per_row_cap else None
        for box in _asl_fill_row(row, target_n=cap_row, extend_ends=extend_ends):
            # Discard phantom stalls that extend beyond the image boundary
            if box[0] >= fw or box[1] >= fh or box[2] <= 0 or box[3] <= 0:
                continue
            # Clamp to frame bounds
            box = [max(0, box[0]), max(0, box[1]), min(fw, box[2]), min(fh, box[3])]
            stalls.append(_asl_box_to_stall(box))
    return stalls
