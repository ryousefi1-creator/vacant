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


def map_cars(calib, xy):
    """Project detected boxes to top-down map coords; keep those inside the lot.
    Returns (cars[{x,y}], inside_mask) where cars are rounded to 1 decimal."""
    mw, mh = calib['map_size']
    H = homography(calib['lot_quad'], mw, mh)
    proj = project(H, contacts(xy))
    cars, mask = [], []
    for mx, my in proj:
        on = 0 <= mx <= mw and 0 <= my <= mh
        mask.append(on)
        if on:
            cars.append({'x': round(float(mx), 1), 'y': round(float(my), 1)})
    return cars, mask


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
    taken/open. Returns [{'poly': [[mx,my]x4], 'taken': bool}]."""
    mw, mh = calib['map_size']
    H = homography(calib['lot_quad'], mw, mh)
    out = []
    for s, taken in zip(calib['stalls'], states):
        pts = project(H, s['poly'])
        out.append({'poly': [[round(float(x), 1), round(float(y), 1)] for x, y in pts], 'taken': bool(taken)})
    return out
