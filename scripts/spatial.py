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


# --- LOT REGION PARAMETERS (how a detected car is assigned to THIS lot) ----------
# A camera sees more than its lot (road, neighbor spots, trees). The old test kept a
# car only if its ground-contact POINT projected inside the quad — which DROPS a car
# straddling the lot edge (contact lands just outside) even though it's parked here,
# and says nothing about cars cut off by the frame. These explicit, tunable knobs
# replace that single fragile point:
INSIDE_OVERLAP = 0.50    # count a boundary/straddling car if >= this fraction of its box is inside the quad
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
