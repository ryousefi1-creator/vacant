"""
stall_vision.py — detect parking stall boundaries from painted markings.

Reads the lot's own painted lines, double white-line dividers, color contrast
against asphalt, and stall numbers directly from camera frames.  Does NOT
rely on cars being present.

Algorithm:
  1. Warp to bird's-eye (perspective-correct via lot_quad homography) so
     parallel lines become truly parallel and spacing is uniform.
  2. Extract white/yellow paint markings from gray asphalt with multi-space
     color thresholding (HSV + LAB + adaptive brightness).
  3. Run Hough line detection per frame.
  4. Accumulate votes across N frames — a line appearing in many frames is
     a real divider, not noise.  Confidence = votes / frames_seen.
  5. Find double-line pairs (two close parallel lines = one stall boundary).
  6. Generate stall polygons from consecutive dividers; back-project to
     original image space.
  7. Optionally ask Claude vision to read painted stall numbers to confirm
     the count.
  8. If overall confidence < threshold, keep gathering frames and retrying
     up to max_frames.

Usage:
  .venv/bin/python scripts/stall_vision.py --id mylot
  .venv/bin/python scripts/stall_vision.py --id mylot --min-conf 0.6 --max-frames 40
  .venv/bin/python scripts/stall_vision.py --id mylot --claude  # use vision for stall-number check
"""
import argparse
import json
import os
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import spatial

try:
    import vision as vis
    VISION_OK = True
except Exception:
    VISION_OK = False

CALIB_DIR = 'calib'


# ─── frame capture ────────────────────────────────────────────────────────────

def grab_frame(url: str) -> np.ndarray:
    cap = cv2.VideoCapture(url)
    if not cap.isOpened():
        raise RuntimeError(f'Cannot open stream: {url}')
    for _ in range(10):
        cap.grab()
    ok, frame = cap.read()
    cap.release()
    if not ok or frame is None:
        raise RuntimeError('Failed to read frame from stream')
    return frame


# ─── preprocessing ────────────────────────────────────────────────────────────

def clahe(frame: np.ndarray, clip: float = 2.5) -> np.ndarray:
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8)).apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)


def warp_to_topdown(frame: np.ndarray, calib: dict, out_scale: float = 2.0) -> tuple:
    """Warp the parking area to a flat top-down view.
    Returns (warped_frame, H_final, W_out, H_out) where H_final maps
    original → scaled top-down space."""
    mw, mh = calib['map_size']
    H = spatial.homography(calib['lot_quad'], mw, mh)
    W_out = int(round(mw * out_scale))
    H_out = int(round(mh * out_scale))
    S = np.array([[out_scale, 0, 0], [0, out_scale, 0], [0, 0, 1]], np.float64)
    H_final = (S @ H).astype(np.float32)
    warped = cv2.warpPerspective(frame, H_final, (W_out, H_out))
    return warped, H_final, W_out, H_out


# ─── marking extraction ───────────────────────────────────────────────────────

def extract_markings(frame: np.ndarray) -> np.ndarray:
    """Multi-space extraction of white/yellow paint on gray asphalt.

    Gray asphalt = moderate brightness, low saturation.
    White paint  = very high brightness, very low saturation.
    Yellow paint = mid hue (15-35), high saturation.

    We also do adaptive thresholding so markings are found even in uneven
    lighting (shadows from canopy, sun patches, etc.).
    """
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # White: high V, low S
    white = cv2.inRange(hsv,
                        np.array([0,   0, 170], np.uint8),
                        np.array([180, 50, 255], np.uint8))

    # Yellow: narrow hue, high saturation
    yellow = cv2.inRange(hsv,
                         np.array([15,  80, 100], np.uint8),
                         np.array([35, 255, 255], np.uint8))

    # Adaptive: much brighter than local neighborhood (catches dim whites too)
    blur = cv2.GaussianBlur(gray, (31, 31), 0)
    diff = cv2.subtract(gray, blur)
    _, bright_local = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)

    combined = cv2.bitwise_or(white, cv2.bitwise_or(yellow, bright_local))

    # Remove tiny specks (noise)
    k_open = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    combined = cv2.morphologyEx(combined, cv2.MORPH_OPEN, k_open)

    # Connect line fragments that were broken by dirt/wear
    k_close = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, k_close)

    return combined


# ─── line detection ───────────────────────────────────────────────────────────

def hough_lines(mask: np.ndarray,
                min_votes: int = 35,
                rho_res: float = 1.0,
                theta_res_deg: float = 0.5) -> list:
    """Standard (accumulator-based) Hough lines on the marking mask.
    Returns [(rho, theta), ...] — theta in radians [0, pi)."""
    edges = cv2.Canny(mask, 30, 120, apertureSize=3)
    lines = cv2.HoughLines(edges, rho_res, np.deg2rad(theta_res_deg), min_votes)
    if lines is None:
        return []
    return [(float(l[0][0]), float(l[0][1])) for l in lines]


# ─── multi-frame line accumulator ─────────────────────────────────────────────

class LineAccumulator:
    """Accumulates Hough line detections across multiple frames.

    A line seen in many frames → real divider.
    A line seen in only one or two frames → noise/glare/shadow.

    confidence() = average (votes / n_frames) across the top confirmed lines.
    """

    def __init__(self, rho_tol: float = 18.0, theta_tol_deg: float = 4.0):
        self.rho_tol = rho_tol
        self.theta_tol = np.deg2rad(theta_tol_deg)
        self.lines: list[dict] = []  # {rho, theta, votes}
        self.n_frames: int = 0

    def add_frame(self, frame_lines: list):
        self.n_frames += 1
        for rho, theta in frame_lines:
            matched = False
            for line in self.lines:
                drho = abs(rho - line['rho'])
                # theta is periodic: 0° and 180° are the same direction
                dtheta = abs(theta - line['theta'])
                dtheta = min(dtheta, abs(np.pi - dtheta))
                if drho <= self.rho_tol and dtheta <= self.theta_tol:
                    n = line['votes']
                    line['rho'] = (line['rho'] * n + rho) / (n + 1)
                    line['theta'] = (line['theta'] * n + theta) / (n + 1)
                    line['votes'] += 1
                    matched = True
                    break
            if not matched:
                self.lines.append({'rho': rho, 'theta': theta, 'votes': 1})

    def confident_lines(self, min_frac: float = 0.45) -> list:
        if self.n_frames == 0:
            return []
        thresh = max(1, self.n_frames * min_frac)
        return [(l['rho'], l['theta'], l['votes'])
                for l in self.lines if l['votes'] >= thresh]

    def confidence(self, min_frac: float = 0.45) -> float:
        conf = self.confident_lines(min_frac)
        if not conf or self.n_frames == 0:
            return 0.0
        avg_vote_frac = float(np.mean([v / self.n_frames for _, _, v in conf]))
        # Also weight by number of confident lines (more = higher confidence)
        count_score = min(1.0, len(conf) / 4)
        return float(avg_vote_frac * 0.7 + count_score * 0.3)


# ─── line geometry ────────────────────────────────────────────────────────────

def line_endpoints(rho: float, theta: float, w: int, h: int) -> tuple:
    """Get two points on a Hough line within the image bounds."""
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    pts = []
    # Intersect with all 4 image edges
    if abs(cos_t) > 1e-6:
        for y in [0, h]:
            x = (rho - y * sin_t) / cos_t
            if 0 <= x <= w:
                pts.append((x, y))
    if abs(sin_t) > 1e-6:
        for x in [0, w]:
            y = (rho - x * cos_t) / sin_t
            if 0 <= y <= h:
                pts.append((x, y))
    pts = list(set((round(float(x)), round(float(y))) for x, y in pts))
    if len(pts) < 2:
        return None
    return pts[0], pts[-1]


def dominant_orientation(lines_rho_theta: list, angle_tol_deg: float = 20.0) -> str:
    """Return 'vertical' (dividers run top→bottom) or 'horizontal' (left→right)."""
    if not lines_rho_theta:
        return 'vertical'
    thetas_deg = [np.rad2deg(t) % 180 for _, t in lines_rho_theta]
    near_vert = sum(1 for t in thetas_deg if abs(t - 90) <= angle_tol_deg)
    near_horiz = sum(1 for t in thetas_deg if t <= angle_tol_deg or t >= 180 - angle_tol_deg)
    return 'vertical' if near_vert >= near_horiz else 'horizontal'


def line_position(rho: float, theta: float, w: int, h: int, orientation: str) -> float:
    """Scalar position of a line perpendicular to orientation (for sorting/spacing)."""
    if orientation == 'vertical':
        # Position along X axis at mid-height
        sin_t = np.sin(theta)
        if abs(sin_t) > 1e-6:
            return (rho - (h / 2) * sin_t) / np.cos(theta) if abs(np.cos(theta)) > 1e-6 else rho
        return rho
    else:
        # Position along Y axis at mid-width
        cos_t = np.cos(theta)
        if abs(np.sin(theta)) > 1e-6:
            return (rho - (w / 2) * cos_t) / np.sin(theta)
        return rho


def find_double_pairs(lines_pos: list, max_pair_gap: float = 35.0) -> list:
    """Find double-line pairs (two parallel lines close together = one stall boundary).
    Returns merged centerline position for each pair.
    lines_pos: list of (position, rho, theta) sorted by position."""
    if not lines_pos:
        return []
    merged = []
    used = [False] * len(lines_pos)
    for i, (pos_i, rho_i, theta_i) in enumerate(lines_pos):
        if used[i]:
            continue
        # Look for a partner within max_pair_gap
        partner = None
        for j in range(i + 1, len(lines_pos)):
            if used[j]:
                continue
            pos_j = lines_pos[j][0]
            if pos_j - pos_i > max_pair_gap:
                break
            if pos_j - pos_i <= max_pair_gap:
                partner = j
                break
        if partner is not None:
            # Merge: use centerline position and average rho/theta
            pos_c = (pos_i + lines_pos[partner][0]) / 2
            rho_c = (rho_i + lines_pos[partner][1]) / 2
            theta_c = (theta_i + lines_pos[partner][2]) / 2
            merged.append((pos_c, rho_c, theta_c, True))  # True = was a double-line
            used[i] = used[partner] = True
        else:
            merged.append((pos_i, rho_i, theta_i, False))
            used[i] = True
    return merged


# ─── stall polygon generation ─────────────────────────────────────────────────

def dividers_to_stall_polys(dividers: list, W: int, H: int, orientation: str) -> list:
    """Generate stall polygons (in top-down space) from sorted divider positions.

    Each consecutive pair of dividers bounds one stall.
    The stall's depth = full height/width of the lot quad.
    Returns list of {'poly': [[x,y]x4]}.
    """
    if len(dividers) < 2:
        return []

    stalls = []
    for i in range(len(dividers) - 1):
        p0 = dividers[i][0]
        p1 = dividers[i + 1][0]
        if orientation == 'vertical':
            poly = [[p0, 0], [p1, 0], [p1, H], [p0, H]]
        else:
            poly = [[0, p0], [W, p0], [W, p1], [0, p1]]
        stalls.append({'poly': [[round(float(x)), round(float(y))] for x, y in poly]})
    return stalls


def backproject_stalls(stalls_td: list, H_inv: np.ndarray) -> list:
    """Back-project stall polygons from top-down space to original image space."""
    result = []
    for s in stalls_td:
        pts = np.array(s['poly'], np.float32)
        orig = spatial.project(H_inv, pts)
        result.append({'poly': [[round(float(x)), round(float(y))] for x, y in orig]})
    return result


# ─── layout quality scoring ───────────────────────────────────────────────────

def layout_score(stalls_td: list, orientation: str) -> float:
    """Score the regularity of a stall layout (0–1).
    High score = evenly spaced stalls of similar size.
    """
    if len(stalls_td) < 2:
        return 0.0

    if orientation == 'vertical':
        widths = [abs(s['poly'][1][0] - s['poly'][0][0]) for s in stalls_td]
    else:
        widths = [abs(s['poly'][2][1] - s['poly'][0][1]) for s in stalls_td]

    if not widths or np.mean(widths) == 0:
        return 0.0

    cv = float(np.std(widths) / np.mean(widths))  # coefficient of variation
    # Low CV = very regular spacing → high score
    regularity = max(0.0, 1.0 - cv * 2)
    # Penalty for having only 1 stall (can't tell if it's a real layout)
    count_score = min(1.0, len(stalls_td) / 3.0)
    return float(regularity * 0.6 + count_score * 0.4)


# ─── Claude vision verification (optional) ───────────────────────────────────

def claude_verify_stalls(warped_frame: np.ndarray, key: str,
                          model: str = 'claude-sonnet-4-6') -> dict:
    """Send the top-down frame to Claude and ask it to:
    1. Count stall divider lines visible
    2. Read any painted stall numbers
    3. Describe the lot layout
    Returns {'count': int|None, 'numbers': [str], 'description': str}."""
    _, buf = cv2.imencode('.jpg', warped_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    prompt = (
        "This is a bird's-eye view of a parking lot. "
        "Please tell me: "
        "(1) How many distinct parking stalls do you see (count the dividing lines)? "
        "(2) Are there any numbers painted on the ground? If so, list them. "
        "(3) Are the stall dividers single or double white lines? "
        "(4) Which direction do the stall dividers run (vertical/horizontal)? "
        "Reply with JSON: {\"stall_count\": <int or null>, \"numbers\": [<str>], "
        "\"double_lines\": <bool>, \"divider_direction\": \"vertical\" or \"horizontal\", "
        "\"notes\": \"<any other observations about the lot layout>\"}"
    )
    try:
        text = vis.claude_vision(key, [buf.tobytes()], prompt, model, max_tokens=300)
        start = text.find('{')
        end = text.rfind('}') + 1
        if start != -1 and end > start:
            return json.loads(text[start:end])
    except Exception as e:
        print(f'  Claude vision: {type(e).__name__}: {e}', flush=True)
    return {'stall_count': None, 'numbers': [], 'double_lines': None, 'divider_direction': None, 'notes': ''}


# ─── preview ─────────────────────────────────────────────────────────────────

def save_preview(orig_frame, warped_frame, marking_mask, conf_line_segments,
                 stalls_img, stalls_td, W_out, H_out, out_path, confidence):
    """Save a 4-panel debug image:
    TL: original with stalls overlaid  TR: top-down with stalls
    BL: marking mask                   BR: top-down with detected lines"""
    h, w = orig_frame.shape[:2]
    scale = 480 / max(w, h)
    W2, H2 = int(w * scale), int(h * scale)
    td_scale = 480 / max(W_out, H_out)
    WTD, HTD = int(W_out * td_scale), int(H_out * td_scale)

    # Panel 1: original + image-space stalls
    p1 = cv2.resize(orig_frame, (W2, H2))
    for i, s in enumerate(stalls_img):
        pts = (np.array(s['poly']) * scale).astype(np.int32)
        cv2.polylines(p1, [pts], True, (0, 255, 80), 2)
        c = pts.mean(0).astype(int)
        cv2.putText(p1, str(i+1), (c[0]-6, c[1]+5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(p1, str(i+1), (c[0]-6, c[1]+5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 80), 1)
    cv2.putText(p1, f'conf={confidence:.2f}  stalls={len(stalls_img)}',
                (8, H2-10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 220, 255), 1)

    # Panel 2: top-down + top-down stalls
    p2 = cv2.resize(warped_frame, (WTD, HTD))
    for i, s in enumerate(stalls_td):
        pts = (np.array(s['poly']) * td_scale).astype(np.int32)
        cv2.polylines(p2, [pts], True, (0, 255, 80), 2)
        c = pts.mean(0).astype(int)
        cv2.putText(p2, str(i+1), (c[0]-6, c[1]+5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 80), 1)

    # Panel 3: marking mask
    p3 = cv2.cvtColor(cv2.resize(marking_mask, (W2, H2)), cv2.COLOR_GRAY2BGR)
    cv2.putText(p3, 'markings (white/yellow)', (8, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 220, 255), 1)

    # Panel 4: top-down with detected lines
    p4 = cv2.resize(warped_frame.copy(), (WTD, HTD))
    for (x1, y1), (x2, y2), is_double in conf_line_segments:
        color = (0, 100, 255) if is_double else (0, 200, 255)
        cv2.line(p4, (int(x1*td_scale), int(y1*td_scale)),
                 (int(x2*td_scale), int(y2*td_scale)), color, 2)
    cv2.putText(p4, 'cyan=single  orange=double', (8, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 220, 255), 1)

    # Assemble 2x2 grid (pad to equal size)
    top_h = max(H2, HTD)
    row1 = np.zeros((top_h, W2 + WTD, 3), np.uint8)
    row1[:H2, :W2] = p1
    row1[:HTD, W2:W2+WTD] = p2
    bot_h = max(H2, HTD)
    row2 = np.zeros((bot_h, W2 + WTD, 3), np.uint8)
    row2[:H2, :W2] = p3
    row2[:HTD, W2:W2+WTD] = p4

    preview = np.vstack([row1, row2])
    os.makedirs('work', exist_ok=True)
    cv2.imwrite(out_path, preview)
    print(f'Preview → {out_path}', flush=True)


# ─── main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', default='mylot')
    ap.add_argument('--url', help='override stream URL (default: from calib)')
    ap.add_argument('--max-frames', type=int, default=30,
                    help='max frames to accumulate before committing best result')
    ap.add_argument('--min-conf', type=float, default=0.55,
                    help='minimum confidence to accept the layout; keeps trying below this')
    ap.add_argument('--interval', type=float, default=1.5,
                    help='seconds between frames (give lot markings time to vary across frames)')
    ap.add_argument('--min-votes-frac', type=float, default=0.40,
                    help='fraction of frames a line must appear in to count as real')
    ap.add_argument('--min-line-votes', type=int, default=30,
                    help='Hough accumulator votes per frame (lower = detect fainter lines)')
    ap.add_argument('--max-pair-gap', type=float, default=40.0,
                    help='max px between two lines to be considered a double-line pair')
    ap.add_argument('--out-scale', type=float, default=2.5,
                    help='scale factor for top-down warp (larger = more resolution for line detection)')
    ap.add_argument('--claude', action='store_true',
                    help='use Claude vision to read stall numbers and verify layout')
    ap.add_argument('--capacity', type=int, default=0,
                    help='known stall count (used to tune min-pair-gap if layout looks wrong)')
    args = ap.parse_args()

    calib_path = os.path.join(CALIB_DIR, f'{args.id}.json')
    if not os.path.exists(calib_path):
        raise SystemExit(f'No calib found: {calib_path}')
    calib = json.load(open(calib_path))

    url = args.url or calib.get('url')
    if not url:
        raise SystemExit('No stream URL in calib and --url not provided')

    if not calib.get('lot_quad') or not calib.get('map_size'):
        raise SystemExit(
            'calib missing lot_quad or map_size — run calibrate_stream.py first')

    print(f'Stream: {url}', flush=True)
    print(f'Lot quad: {calib["lot_quad"]}  map: {calib["map_size"]}', flush=True)
    print(f'Target: min-conf={args.min_conf}  max-frames={args.max_frames}\n', flush=True)

    accum = LineAccumulator(rho_tol=18.0, theta_tol_deg=4.0)
    last_warped = None
    last_mask = None

    for frame_n in range(1, args.max_frames + 1):
        print(f'Frame {frame_n}/{args.max_frames}', end='  ', flush=True)
        try:
            raw = grab_frame(url)
        except Exception as e:
            print(f'grab failed: {e}', flush=True)
            time.sleep(args.interval)
            continue

        enhanced = clahe(raw)
        warped, H_final, W_out, H_out = warp_to_topdown(enhanced, calib, args.out_scale)
        mask = extract_markings(warped)
        lines = hough_lines(mask, min_votes=args.min_line_votes)
        accum.add_frame(lines)
        last_warped = warped
        last_mask = mask

        conf = accum.confidence(args.min_votes_frac)
        n_conf_lines = len(accum.confident_lines(args.min_votes_frac))
        print(f'conf={conf:.3f}  raw_lines={len(lines)}  stable_lines={n_conf_lines}', flush=True)

        if conf >= args.min_conf and frame_n >= 5:
            print(f'\nConfidence threshold reached at frame {frame_n}!', flush=True)
            break

        if frame_n < args.max_frames:
            time.sleep(args.interval)

    # ── extract final layout ───────────────────────────────────────────────────
    conf_lines_raw = accum.confident_lines(args.min_votes_frac)
    final_conf = accum.confidence(args.min_votes_frac)

    if not conf_lines_raw:
        print('\nNo confident lines found — the parking area may not have visible painted markings,',
              flush=True)
        print('or the lot_quad may not cover the stall-marking area.', flush=True)
        print('Try: lower --min-line-votes, widen the lot_quad with calibrate_stream.py,', flush=True)
        print('or use the car-position method: scripts/spot_detect_stream.py', flush=True)
        sys.exit(1)

    print(f'\n{len(conf_lines_raw)} stable lines found.  Final confidence: {final_conf:.3f}', flush=True)

    # Determine dominant orientation
    orientation = dominant_orientation([(r, t) for r, t, _ in conf_lines_raw])
    print(f'Dominant orientation: {orientation} dividers', flush=True)

    # Filter to the dominant direction (±20°)
    angle_tol = np.deg2rad(20)
    target_theta = np.pi / 2 if orientation == 'vertical' else 0.0
    filtered = [(r, t, v) for r, t, v in conf_lines_raw
                 if min(abs(t - target_theta), abs(np.pi - abs(t - target_theta))) <= angle_tol]

    if not filtered:
        filtered = conf_lines_raw  # fall back to all

    # Sort by position (along the axis perpendicular to stall dividers)
    lines_with_pos = [
        (line_position(r, t, W_out, H_out, orientation), r, t)
        for r, t, _ in filtered
    ]
    lines_with_pos.sort(key=lambda x: x[0])

    # Find double-line pairs
    merged_dividers = find_double_pairs(lines_with_pos, max_pair_gap=args.max_pair_gap)
    print(f'Dividers (after double-line merge): {len(merged_dividers)}', flush=True)

    # Collect line segments for preview
    conf_segs = []
    for pos, rho, theta, is_double in merged_dividers:
        ep = line_endpoints(rho, theta, W_out, H_out)
        if ep:
            conf_segs.append((ep[0], ep[1], is_double))

    # If we have a known capacity, try to reconcile divider count
    # (capacity stalls need capacity+1 dividers)
    if args.capacity > 0:
        expected_dividers = args.capacity + 1
        if len(merged_dividers) < expected_dividers:
            print(f'  Only {len(merged_dividers)} dividers but capacity={args.capacity} '
                  f'needs {expected_dividers}.  Lines may be too faint — try --min-line-votes lower.',
                  flush=True)
        elif len(merged_dividers) > expected_dividers:
            print(f'  {len(merged_dividers)} dividers but capacity={args.capacity}: '
                  f'removing weakest until {expected_dividers} remain.', flush=True)
            # Keep the most evenly-spaced subset: sort all, thin to capacity+1
            positions = [d[0] for d in merged_dividers]
            if len(positions) > expected_dividers:
                # Keep first, last, and best-spaced middle ones
                step = (positions[-1] - positions[0]) / (expected_dividers - 1)
                kept = [merged_dividers[0]]
                for k in range(1, expected_dividers - 1):
                    target = positions[0] + step * k
                    best = min(merged_dividers[1:-1], key=lambda d: abs(d[0] - target))
                    if best not in kept:
                        kept.append(best)
                kept.append(merged_dividers[-1])
                merged_dividers = sorted(kept, key=lambda d: d[0])

    # Generate top-down stall polygons
    stalls_td = dividers_to_stall_polys(merged_dividers, W_out, H_out, orientation)
    if not stalls_td:
        print('\nNot enough dividers to form stalls (need ≥2).  Try more frames or '
              'lower --min-line-votes.', flush=True)
        sys.exit(1)

    print(f'Generated {len(stalls_td)} stalls in top-down space.', flush=True)

    # Back-project to image space
    H_inv = np.linalg.inv(H_final).astype(np.float32)
    stalls_img = backproject_stalls(stalls_td, H_inv)

    # ── layout quality score ───────────────────────────────────────────────────
    layout_q = layout_score(stalls_td, orientation)
    overall_conf = final_conf * 0.6 + layout_q * 0.4
    print(f'Layout quality: {layout_q:.3f}  combined confidence: {overall_conf:.3f}', flush=True)

    # ── Claude vision verification (optional) ─────────────────────────────────
    claude_result = None
    if args.claude and VISION_OK:
        key = vis.load_key()
        if key:
            print('\nAsking Claude to verify stall layout…', flush=True)
            claude_result = claude_verify_stalls(last_warped, key)
            print(f'  Claude says: {json.dumps(claude_result, indent=2)}', flush=True)

            cv_count = claude_result.get('stall_count')
            if cv_count and cv_count != len(stalls_td):
                print(f'  ⚠ Mismatch: detected {len(stalls_td)} stalls, '
                      f'Claude sees {cv_count}.  Continuing with CV result.', flush=True)
        else:
            print('No ANTHROPIC_API_KEY found — skipping Claude verification.', flush=True)
    elif args.claude:
        print('vision.py not available — skipping Claude verification.', flush=True)

    # ── convert top-down polys to map-space layout ─────────────────────────────
    # The top-down warped space uses out_scale * map_size coordinates.
    # Normalize back to map_size space for the layout field.
    mw, mh = calib['map_size']
    layout = []
    for s in stalls_td:
        norm = [[round(float(x) / args.out_scale, 1),
                 round(float(y) / args.out_scale, 1)]
                for x, y in s['poly']]
        layout.append({'poly': norm})

    # ── save to calib ─────────────────────────────────────────────────────────
    existing = json.load(open(calib_path))
    existing['stalls'] = stalls_img
    existing['layout'] = layout
    existing['capacity'] = len(stalls_img)
    existing['surface'] = existing.get('surface', 'paved')
    # Store detection metadata for diagnostics
    existing['stall_vision'] = {
        'frames': accum.n_frames,
        'stable_lines': len(conf_lines_raw),
        'dividers': len(merged_dividers),
        'orientation': orientation,
        'line_conf': round(final_conf, 3),
        'layout_quality': round(layout_q, 3),
        'overall_conf': round(overall_conf, 3),
        'claude': claude_result,
    }
    json.dump(existing, open(calib_path, 'w'), indent=2)
    print(f'\nSaved {calib_path} — {len(stalls_img)} stalls  '
          f'(overall conf {overall_conf:.2f})', flush=True)

    # ── save preview ──────────────────────────────────────────────────────────
    if last_warped is not None and last_mask is not None:
        try:
            save_preview(
                cv2.imread('work/' + args.id + '_calib_frame.jpg') or grab_frame(url),
                last_warped, last_mask, conf_segs,
                stalls_img, stalls_td, W_out, H_out,
                f'work/{args.id}_stall_vision.jpg',
                overall_conf,
            )
        except Exception as e:
            print(f'Preview skipped: {e}', flush=True)

    print('\nDone. Restart push.py to apply:', flush=True)
    print(f'  pkill -f push.py && .venv/bin/python scripts/push.py --api http://localhost:3000',
          flush=True)


if __name__ == '__main__':
    main()
