"""
Vacant — multi-location CV worker (spatial).

LOTS are driven by calib/*.json: fetch the camera, detect vehicles, project each
car's ground-contact point through the lot homography to TOP-DOWN map coords
(a car on the right shows on the right), keep only cars INSIDE the lot quad
(this also drops off-lot false positives), and POST real positions + real
capacity + honest refresh cadence to the Next.js app.

STREETS (NYC DOT) are kept only as clearly-labeled live VEHICLE COUNTERS — no
parking spaces. They give the dashboard constant near-real-time movement.

Poll cadence is per source: streets change every few seconds, Boulder lot
snapshots refresh ~every 15 min, so we poll lots far less often.

  cd ~/"HW Forge/Image Recognition"
  .venv/bin/python scripts/push.py
  .venv/bin/python scripts/push.py --api http://localhost:3000
"""
import argparse
import base64
import json
import os
import ssl
import time
import urllib.request

# Bypass SSL certificate verification for public camera feeds on macOS
try:
    ssl._create_default_https_context = ssl._create_unverified_context
except AttributeError:
    pass

import cv2
import numpy as np
from ultralytics import YOLO

import spatial
import anonymize
import vision

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
NYC = 'https://webcams.nyctmc.org/api/cameras/{}/image'
PEAKS_FILE = 'work/peaks.json'  # most cars ever counted per lot — grounds capacity in real data

_captures: dict = {}   # url -> cv2.VideoCapture, kept open across polls for live streams
_stall_obs: dict = {}  # lot_id -> list of (N,4) box arrays, accumulated until we have enough to derive stalls
AUTO_STALL_FRAMES = 6  # frames of detections needed before auto-deriving stall layout

# ── temporal hysteresis ────────────────────────────────────────────────────────
# Each lot gets a StallDebouncer that prevents stalls from flickering open/taken
# on a single frame where YOLO misses or hallucinates a car (glare, shadow pass,
# brief occlusion).  A stall must be consistently occupied for OCCUPY_THRESH
# frames before we call it taken; consistently empty for EMPTY_THRESH frames
# before we call it open.  EMPTY_THRESH is intentionally higher because a parked
# car rarely disappears — a miss is almost always a detection failure.
OCCUPY_THRESH = 3   # frames of occupied before flipping to taken
EMPTY_THRESH  = 7   # frames of empty before flipping to open (higher: a parked car rarely vanishes)

class StallDebouncer:
    """Per-lot temporal debouncer for stall occupancy states."""
    def __init__(self):
        self._stable: list[bool] = []
        self._occ_count: list[int] = []  # consecutive occupied frames
        self._emp_count: list[int] = []  # consecutive empty frames

    def update(self, raw: list[bool]) -> list[bool]:
        n = len(raw)
        if len(self._stable) != n:
            self._stable = list(raw)
            self._occ_count = [0] * n
            self._emp_count = [0] * n
            return list(self._stable)
        for i, r in enumerate(raw):
            if r:
                self._occ_count[i] += 1
                self._emp_count[i] = 0
                if self._occ_count[i] >= OCCUPY_THRESH:
                    self._stable[i] = True
            else:
                self._emp_count[i] += 1
                self._occ_count[i] = 0
                if self._emp_count[i] >= EMPTY_THRESH:
                    self._stable[i] = False
        return list(self._stable)

_debouncers: dict = {}  # lot_id -> StallDebouncer

# ── stall boundary auto-refinement ────────────────────────────────────────────
# After REFINE_FRAMES frames of stable detections, nudge stall x-centers toward
# where cars actually park (exponential moving average).  Corrects for small
# calibration drift without requiring a full re-run of stall_vision.py.
REFINE_FRAMES = 20    # frames before first refinement
REFINE_ALPHA  = 0.15  # EMA learning rate (lower = slower, smoother adaptation)
_refine_obs: dict = {}  # lot_id -> list of car cx values seen

def _refine_stalls(calib: dict, xy) -> dict:
    """Nudge stall x-centers toward observed car centers (EMA).  Only adjusts
    stalls that have a clear match (one car clearly closest to the stall).
    Returns updated calib dict (in-place) and saves to disk."""
    if not xy or not calib.get('stalls'):
        return calib
    stalls = calib['stalls']
    # stall x-centers
    s_cx = [(s['poly'][0][0] + s['poly'][1][0]) / 2.0 for s in stalls]
    # car x-centers
    car_cx = [(b[0] + b[2]) / 2.0 for b in xy]
    # assign each car to nearest stall (by x distance)
    moved = False
    for car_x in car_cx:
        dists = [abs(car_x - sc) for sc in s_cx]
        best = int(np.argmin(dists))
        if dists[best] > 120:   # too far — don't assign
            continue
        old_cx = s_cx[best]
        new_cx = old_cx * (1 - REFINE_ALPHA) + car_x * REFINE_ALPHA
        delta = new_cx - old_cx
        if abs(delta) < 0.5:
            continue
        # shift the stall polygon horizontally by delta
        poly = stalls[best]['poly']
        stalls[best]['poly'] = [[round(pt[0] + delta), pt[1]] for pt in poly]
        s_cx[best] = new_cx
        moved = True
    if moved:
        calib['stalls'] = stalls
    return calib

_refine_counts: dict = {}  # lot_id -> frame counter


def load_peaks():
    try:
        return json.load(open(PEAKS_FILE))
    except Exception:
        return {}


def save_peaks(p):
    try:
        json.dump(p, open(PEAKS_FILE, 'w'))
    except Exception:
        pass

# kept streets: clearly labeled live vehicle counters (no parking). 2 is enough
# for "always moving" without burying the lots.
STREETS = [
    {'id': 'fdr122', 'name': 'FDR Dr @ 122 St', 'url': NYC.format('ec1e7b42-18de-4475-8c89-9e80f21e5b6c'), 'refresh_sec': 3},
    {'id': '2ave58', 'name': '2 Ave @ 58 St',   'url': NYC.format('5b44d19e-de48-4941-b071-d2a4c08bd230'), 'refresh_sec': 3},
]


def fetch(url):
    # Live streams (rtmp/rtsp/srt) use a persistent VideoCapture; JPEG snapshots use urllib
    if url.startswith(('rtmp://', 'rtsp://', 'srt://')):
        cap = _captures.get(url)
        if cap is None or not cap.isOpened():
            cap = cv2.VideoCapture(url)
            if not cap.isOpened():
                raise RuntimeError(f'cannot open stream: {url}')
            _captures[url] = cap
        # Drain buffered frames so we get the most recent one
        for _ in range(5):
            cap.grab()
        ok, frame = cap.read()
        if not ok:
            _captures.pop(url, None)
            raise RuntimeError('stream read failed — will reconnect next poll')
        return frame
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12).read()
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def _filter_small_detections(xy, min_area_px: int) -> list:
    """Drop bounding boxes smaller than min_area_px (e.g. shadow artifacts, distant tiny blobs)."""
    return [b for b in xy if (b[2] - b[0]) * (b[3] - b[1]) >= min_area_px]


def detect_lot(model, frame, calib, conf, lot_imgsz, tile_imgsz, tile_grid, device):
    """Detect vehicles for a LOT.

    Per-calib overrides (all optional):
      "imgsz"         int   inference resolution (default: lot_imgsz CLI arg)
      "iou"           float YOLO NMS IoU threshold; lower = keep more adjacent boxes
                            (0.3 for close carport cars, 0.7 default merges them)
      "conf"          float confidence threshold (default: CLI --conf); raise per-lot to
                            reduce false positives (e.g. 0.35 for a well-lit daytime lot)
      "min_area_px"   int   drop detections whose bbox pixel area is below this value;
                            filters shadow-pass and tiny distant blobs (default: 600)
      "clahe"         bool  CLAHE contrast enhancement before inference; helps in
                            shadowed carport/garage conditions
      "detect_topdown" bool warp the lot region to bird's-eye before running YOLO
                            (fixes perspective compression; requires a calibrated lot_quad)
      "tile"          bool  SAHI tile grid for wide lots with small far cars
    """
    iou_thr  = float(calib.get('iou', 0.45))
    imgsz_c  = int(calib.get('imgsz', lot_imgsz))
    conf_eff = float(calib.get('conf', conf))       # per-calib confidence override

    if calib.get('clahe'):
        frame = spatial.clahe_enhance(frame)

    if calib.get('detect_topdown') and calib.get('lot_quad') and calib.get('map_size'):
        xy = spatial.detect_topdown(model, frame, calib, conf_eff, imgsz_c, device, iou_thr)
    elif calib.get('tile'):
        xy = spatial.detect_tiled(model, frame, conf_eff, int(calib.get('tile_imgsz', tile_imgsz)),
                                   device, grid=int(calib.get('tile_grid', tile_grid)),
                                   full_imgsz=imgsz_c, iou_thr=iou_thr)
    else:
        xy = spatial.detect(model, frame, conf_eff, imgsz_c, device, iou_thr)

    min_area = int(calib.get('min_area_px', 600))
    return _filter_small_detections(xy, min_area)


def to_data_uri(viz, width=800):
    h, w = viz.shape[:2]
    small = cv2.resize(viz, (width, int(h * width / w))) if w > width else viz
    ok, buf = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 72])
    return 'data:image/jpeg;base64,' + base64.b64encode(buf).decode()


def annotate_lot(frame, calib, info):
    """Live-detection view: the orange lot region + each detection colored by its lot
    membership (green=in, cyan=boundary/straddling but counted, orange=cut off by the
    frame edge, grey=off-lot/dropped). Makes the refined region logic visible."""
    viz = frame.copy()
    q = np.array(calib['lot_quad'], np.int32)
    cv2.polylines(viz, [q], True, (0, 200, 255), 3)
    lw = max(2, frame.shape[1] // 600)
    col = {'in': (0, 210, 0), 'boundary': (0, 210, 210), 'partial': (0, 140, 255), 'out': (120, 120, 120)}
    for c in info:
        x1, y1, x2, y2 = [int(v) for v in c['box']]
        cv2.rectangle(viz, (x1, y1), (x2, y2), col[c['status']], lw)
        cv2.circle(viz, (int(c['contact'][0]), int(c['contact'][1])), 5, (0, 0, 255), -1)
    return viz


def annotate_stalls(frame, calib, xy, states):
    """PAVED lots: draw stalls red=taken / green=open, road lines in blue, car boxes in grey."""
    viz = frame.copy()
    lw = max(2, frame.shape[1] // 600)

    # faint car boxes
    for x1, y1, x2, y2 in xy:
        cv2.rectangle(viz, (int(x1), int(y1)), (int(x2), int(y2)), (150, 150, 150), 1)

    # road segments (drawn by user in the setup wizard)
    for r in calib.get('roads', []):
        line = r.get('line', [])
        if len(line) >= 2:
            pt1 = tuple(int(v) for v in line[0])
            pt2 = tuple(int(v) for v in line[1])
            cv2.line(viz, pt1, pt2, (230, 130, 20), lw + 1)
            cv2.putText(viz, 'ROAD', (pt1[0] + 6, pt1[1] - 8), cv2.FONT_HERSHEY_SIMPLEX,
                        0.45, (230, 130, 20), 1, cv2.LINE_AA)

    # stall polygons
    for s, taken in zip(calib['stalls'], states):
        poly = np.array(s['poly'], np.int32)
        color = (0, 0, 220) if taken else (0, 210, 0)
        cv2.polylines(viz, [poly], True, color, lw)
        # stall center label
        cx = int(np.mean([p[0] for p in s['poly']]))
        cy = int(np.mean([p[1] for p in s['poly']]))
        label = 'X' if taken else 'P'
        cv2.putText(viz, label, (cx - 6, cy + 6), cv2.FONT_HERSHEY_SIMPLEX,
                    0.5, color, 2, cv2.LINE_AA)
    return viz


def _scale_drawn_stalls(calib: dict, actual_w: int, actual_h: int) -> list | None:
    """Scale stall polygons from draw-image coordinates to actual frame coordinates.

    When a user draws stalls in the setup wizard, coordinates are in the detection
    image's pixel space (e.g. 800×450). YOLO bounding boxes are in the actual camera
    frame space (e.g. 1280×720). This function scales them to match.
    """
    stalls = calib.get('stalls')
    if not stalls:
        return None
    draw_w = calib.get('_stall_draw_width')
    draw_h = calib.get('_stall_draw_height')
    if not draw_w or not draw_h:
        return stalls  # no draw-size recorded — assume already in frame coords
    sx = actual_w / draw_w
    sy = actual_h / draw_h
    if abs(sx - 1.0) < 0.02 and abs(sy - 1.0) < 0.02:
        return stalls  # already close enough
    return [
        {'poly': [[round(x * sx), round(y * sy)] for x, y in s['poly']]}
        for s in stalls
    ]


def _scale_quad(calib: dict, actual_w: int, actual_h: int) -> dict:
    """Scale a user-drawn lot_quad from the setup image's pixel space to the actual
    camera frame, returning a shallow-copied calib (original left untouched).

    The Lot Builder draws the parking-area quad on the posted preview image, which
    to_data_uri downscales to ~800px wide; YOLO boxes and detect_topdown operate in
    the full frame. This mirrors _scale_drawn_stalls. No-op when no _quad_draw_* is
    recorded (e.g. a lot_quad written directly in frame coords by the auto-stall
    learner), so existing calibrations are unaffected.
    """
    q = calib.get('lot_quad')
    dw = calib.get('_quad_draw_width')
    dh = calib.get('_quad_draw_height')
    if not q or not dw or not dh:
        return calib
    sx, sy = actual_w / dw, actual_h / dh
    if abs(sx - 1.0) < 0.02 and abs(sy - 1.0) < 0.02:
        return calib
    nq = [[round(x * sx), round(y * sy)] for x, y in q]
    return {**calib, 'lot_quad': nq}


def _filter_road_detections(calib: dict, xy, actual_w: int, actual_h: int) -> list:
    """Remove bounding boxes whose center falls on a user-drawn road segment (buffer=50px).

    Vehicles ON the road are moving, not parked — filtering them prevents false
    occupancy from drive-through traffic.
    """
    roads = calib.get('roads')
    if not roads or not xy:
        return list(xy)

    # Scale road line coords the same way as stalls
    draw_w = calib.get('_stall_draw_width', actual_w)
    draw_h = calib.get('_stall_draw_height', actual_h)
    sx, sy = actual_w / draw_w, actual_h / draw_h
    ROAD_BUFFER = 50  # pixels in actual frame space

    def on_road(cx: float, cy: float) -> bool:
        for r in roads:
            line = r.get('line', [])
            if len(line) < 2:
                continue
            x1, y1 = line[0][0] * sx, line[0][1] * sy
            x2, y2 = line[1][0] * sx, line[1][1] * sy
            dx, dy = x2 - x1, y2 - y1
            len2 = dx * dx + dy * dy
            if len2 == 0:
                continue
            t = max(0.0, min(1.0, ((cx - x1) * dx + (cy - y1) * dy) / len2))
            px, py = x1 + t * dx, y1 + t * dy
            if (cx - px) ** 2 + (cy - py) ** 2 <= ROAD_BUFFER ** 2:
                return True
        return False

    return [b for b in xy if not on_road((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)]


def annotate_street(frame, xy):
    viz = frame.copy()
    lw = max(2, frame.shape[1] // 480)
    for x1, y1, x2, y2 in xy:
        cv2.rectangle(viz, (int(x1), int(y1)), (int(x2), int(y2)), (0, 200, 0), lw)
    return viz


def post(api, payload):
    body = json.dumps(payload).encode()
    headers = {'Content-Type': 'application/json'}
    token = os.environ.get('VACANT_TOKEN')  # must match the app's VACANT_TOKEN in prod
    if token:
        headers['x-vacant-token'] = token
    req = urllib.request.Request(api + '/api/occupancy', data=body, headers=headers, method='POST')
    urllib.request.urlopen(req, timeout=10).read()


def do_lot(model, calib, api, conf, imgsz, device, peaks, overlap=0.30, tile_imgsz=1280, tile_grid=3,
           audit_key=None, audit_model='claude-sonnet-4-6', audits=None, audit_gap=600):
    frame = fetch(calib['url'])
    if frame is None:
        raise RuntimeError('no frame')
    # scale a builder-drawn perspective quad to the real frame before detection
    # (detect_topdown warps using lot_quad, so it must be in frame coords first)
    actual_h, actual_w = frame.shape[:2]
    calib = _scale_quad(calib, actual_w, actual_h)
    xy = detect_lot(model, frame, calib, conf, imgsz, tile_imgsz, tile_grid, device)
    frame = anonymize.anonymize(frame, device)   # blur plates + faces before this frame is posted

    # PAVED lots with real marked stalls -> EXACT per-stall occupancy (capacity is
    # the marked-stall count, open = # empty). The estimate/peak path below is only
    # for free-form gravel lots that have no countable spaces.
    if calib.get('stalls'):
        cid = calib['id']
        actual_h, actual_w = frame.shape[:2]

        # ── scale user-drawn stall coords to actual frame coordinates ────────
        stalls_for_detection = _scale_drawn_stalls(calib, actual_w, actual_h)
        calib = {**calib, 'stalls': stalls_for_detection}  # local copy, not persisted

        # ── filter vehicles on drawn road segments ───────────────────────────
        xy = _filter_road_detections(calib, xy, actual_w, actual_h)

        # ── stall boundary auto-refinement (background, every REFINE_FRAMES) ──
        cnt = _refine_counts.get(cid, 0) + 1
        _refine_counts[cid] = cnt
        if cnt % REFINE_FRAMES == 0 and len(xy):
            calib = _refine_stalls(calib, xy)

        raw_states = spatial.stall_states(calib['stalls'], xy, overlap)

        # ── temporal hysteresis ───────────────────────────────────────────────
        deb = _debouncers.setdefault(cid, StallDebouncer())
        states = deb.update(raw_states)

        stalls_out = spatial.display_stalls(calib, states)
        taken = sum(states)
        open_n = len(states) - taken
        viz = annotate_stalls(frame, calib, xy, states)
        post(api, {
            'id': calib['id'], 'name': calib['name'], 'type': 'lot', 'surface': calib['surface'],
            'map': calib['map_size'], 'stalls': stalls_out, 'inside': taken, 'count': int(len(xy)),
            'capacity': len(states), 'open': open_n, 'refresh_sec': calib['refresh_sec'],
            'image': to_data_uri(viz),
        })
        return taken, int(len(xy)), xy

    # overlap-robust lot membership: boundary (straddling) cars ARE counted, frame-edge
    # cars are flagged 'partial' (may be out of view) — classify once, reuse for the
    # count + the annotated panel.
    info = spatial.classify_cars(calib, xy, frame.shape)
    counted = sorted((c for c in info if c['status'] != 'out'),
                     key=lambda c: (c['box'][2] - c['box'][0]) * (c['box'][3] - c['box'][1]), reverse=True)
    cars = [{'x': c['map'][0], 'y': c['map'][1], 'partial': c['partial']} for c in counted]
    cv_inside = len(cars)
    inside = cv_inside

    # --- Claude-vision audit (cost-bounded: audit a lot only when its count CHANGES, throttled per
    # lot by audit_gap). On an OVERCOUNT (the big-foreground-car fragmentation), trust the lower
    # second-opinion count and keep the largest-box cars so the map matches the headline number. ---
    audit_out = None
    if audit_key is not None and audits is not None:
        st = audits.get(calib['id'], {})
        now = time.time()
        due = (st.get('cv') != cv_inside or 'claude' not in st or now - st.get('t', 0) > 3600)
        if due and now - st.get('t', 0) > audit_gap:
            try:
                _, jb = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                st = {'cv': cv_inside, 'claude': vision.claude_count(audit_key, jb.tobytes(), audit_model), 't': now}
                audits[calib['id']] = st
                cc0 = st['claude']
                print(f"   vision-audit {calib['id']}: cv={cv_inside} claude={cc0}", flush=True)
            except Exception as e:
                print(f"   audit skip {calib['id']}: {type(e).__name__} {e}", flush=True)
        cc = st.get('claude')
        if cc is not None:
            over = cc < cv_inside    # YOLO overcounted -> trust the lower vision count (ANY amount, incl. off-by-1)
            audit_out = {'claude': cc, 'agree': not over, 't': int(st.get('t', 0))}
            if over:
                inside, cars = cc, cars[:cc]

    partial_n = sum(1 for c in cars if c['partial'])
    peak = max(int(peaks.get(calib['id'], 0)), inside)
    peaks[calib['id']] = peak
    capacity = max(calib['capacity'], peak)
    viz = annotate_lot(frame, calib, info)
    post(api, {
        'id': calib['id'], 'name': calib['name'], 'type': 'lot', 'surface': calib['surface'],
        'map': calib['map_size'], 'cars': cars, 'inside': inside, 'count': int(len(xy)),
        'partial': partial_n, 'capacity': capacity, 'peak': peak, 'refresh_sec': calib['refresh_sec'],
        'cv_count': cv_inside, 'audit': audit_out, 'image': to_data_uri(viz),
    })
    return inside, int(len(xy)), xy


def do_street(model, st, api, conf, imgsz, device):
    frame = fetch(st['url'])
    if frame is None:
        raise RuntimeError('no frame')
    xy = spatial.detect(model, frame, conf, imgsz, device)
    frame = anonymize.anonymize(frame, device)   # blur plates + faces before this frame is posted
    viz = annotate_street(frame, xy)
    post(api, {
        'id': st['id'], 'name': st['name'], 'type': 'street',
        'count': int(len(xy)), 'capacity': None, 'refresh_sec': st['refresh_sec'],
        'image': to_data_uri(viz),
    })
    return int(len(xy))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--api', default='http://localhost:3000')
    ap.add_argument('--device', default='mps')
    ap.add_argument('--conf', type=float, default=0.15)
    ap.add_argument('--imgsz', type=int, default=1280, help='street detection size')
    ap.add_argument('--lot-imgsz', type=int, default=1920, help='lot detection size (higher = catches more far cars)')
    ap.add_argument('--overlap', type=float, default=0.30, help='paved-stall occupancy threshold (box covers >= this frac of a stall)')
    ap.add_argument('--tile-imgsz', type=int, default=1280, help='per-tile detection size for lots with "tile": true')
    ap.add_argument('--tile-grid', type=int, default=3, help='NxN tile grid for tiled lots (3 = 9 tiles, the validated sweet spot)')
    ap.add_argument('--lot-interval', type=float, default=30, help='seconds between lot re-fetches (snapshots refresh slowly)')
    ap.add_argument('--street-interval', type=float, default=5, help='seconds between street re-fetches')
    ap.add_argument('--model', default='models/yolo11x.pt')
    ap.add_argument('--audit', action='store_true', help='enable the Claude-vision count audit (cost-bounded: audits a lot only when its count changes)')
    ap.add_argument('--audit-model', default='claude-sonnet-4-6', help='vision model for the audit')
    ap.add_argument('--audit-gap', type=float, default=600, help='min seconds between audits of the SAME lot (hard cost throttle)')
    args = ap.parse_args()

    calibs = spatial.load_calibs('calib')
    peaks = load_peaks()
    audit_key = vision.load_key() if args.audit else None
    audits = {}
    if args.audit:
        print(f'vision audit ON ({args.audit_model}, >= {args.audit_gap:.0f}s between same-lot checks)', flush=True)
    model = YOLO(args.model)
    print(f'worker up: {len(calibs)} calibrated lots + {len(STREETS)} streets -> {args.api}', flush=True)
    if not calibs:
        print('  (no calib/*.json yet — run scripts/calibrate.py)', flush=True)

    # schedule: each source has its own next-due time so lots poll slowly, streets fast
    due = {}
    for cid, c in calibs.items():
        if c.get('url'):                       # skip demo/offline calibs (e.g. paved-demo) — no live cam to poll
            due[('lot', cid)] = 0.0
    for st in STREETS:
        due[('street', st['id'])] = 0.0

    while True:
        now = time.time()
        for (kind, cid), t in list(due.items()):
            if now < t:
                continue
            try:
                if kind == 'lot':
                    c = calibs[cid]
                    inside, total, xy = do_lot(model, c, args.api, args.conf, args.lot_imgsz, args.device, peaks,
                                               args.overlap, args.tile_imgsz, args.tile_grid,
                                               audit_key, args.audit_model, audits, args.audit_gap)
                    save_peaks(peaks)
                    g = c.get('tile_grid', args.tile_grid)
                    tag = f" [tiled {g}x{g}]" if c.get('tile') else ''
                    print(f"  [lot] {c['name']}:{tag} {inside} in-lot ({total} detected, peak {peaks.get(cid)})", flush=True)
                    due[(kind, cid)] = time.time() + c.get('refresh_sec', args.lot_interval)

                    # ── auto-stall learning ──────────────────────────────────
                    # When a lot has no stall layout yet, accumulate YOLO boxes
                    # across frames. After AUTO_STALL_FRAMES with detections,
                    # derive the stall layout using row-analysis + gap-fill +
                    # end-extension, persist to calib JSON, and reload so the
                    # very next poll uses exact per-stall occupancy.
                    if not c.get('stalls') and len(xy):
                        obs = _stall_obs.setdefault(cid, [])
                        obs.append(xy)
                        frames_so_far = len(obs)
                        print(f"  [auto-stall] {cid}: {frames_so_far}/{AUTO_STALL_FRAMES} frames collected", flush=True)
                        if frames_so_far >= AUTO_STALL_FRAMES:
                            all_boxes = np.vstack(obs)
                            fw = c['frame'][0] if 'frame' in c else None
                            fh = c['frame'][1] if 'frame' in c else None
                            stalls = spatial.auto_stalls(
                                all_boxes,
                                extend_ends=1,
                                capacity=c.get('capacity', 0),
                                frame_wh=(fw, fh) if fw and fh else None,
                            )
                            if stalls:
                                # derive tight lot quad from stall extents
                                all_pts = [pt for s in stalls for pt in s['poly']]
                                pts = np.array(all_pts)
                                marg = 30
                                h_f, w_f = (c['frame'][1], c['frame'][0]) if 'frame' in c else (720, 1280)
                                q = [
                                    [int(max(0, pts[:,0].min()-marg)), int(max(0, pts[:,1].min()-marg))],
                                    [int(min(w_f, pts[:,0].max()+marg)), int(max(0, pts[:,1].min()-marg))],
                                    [int(min(w_f, pts[:,0].max()+marg)), int(min(h_f, pts[:,1].max()+marg))],
                                    [int(max(0, pts[:,0].min()-marg)), int(min(h_f, pts[:,1].max()+marg))],
                                ]
                                mw, mh = c.get('map_size', [600, 400])
                                H = spatial.homography(q, mw, mh)
                                layout = [{'poly': [[round(float(x),1), round(float(y),1)] for x, y in
                                           spatial.project(H, s['poly'])]} for s in stalls]
                                c['stalls'] = stalls
                                c['layout'] = layout
                                c['lot_quad'] = q
                                c['capacity'] = len(stalls)
                                c['surface'] = c.get('surface', 'paved')
                                calibs[cid] = c
                                calib_path = os.path.join('calib', f'{cid}.json')
                                json.dump(c, open(calib_path, 'w'), indent=2)
                                _stall_obs.pop(cid, None)
                                print(f"  [auto-stall] {cid}: DERIVED {len(stalls)} stalls — switching to stall mode", flush=True)
                            else:
                                _stall_obs[cid] = obs[-4:]  # keep recent frames, discard old
                                print(f"  [auto-stall] {cid}: not enough distinct positions yet, retrying…", flush=True)
                else:
                    st = next(s for s in STREETS if s['id'] == cid)
                    n = do_street(model, st, args.api, args.conf, args.imgsz, args.device)
                    print(f"  [street] {st['name']}: {n} vehicles", flush=True)
                    due[(kind, cid)] = time.time() + args.street_interval
            except Exception as e:
                print(f"  skip {kind}:{cid}: {type(e).__name__} {e}", flush=True)
                due[(kind, cid)] = time.time() + 15
        time.sleep(0.1)


if __name__ == '__main__':
    main()
