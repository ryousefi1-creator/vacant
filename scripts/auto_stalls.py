"""
Vacant — automatic stall placement (occurrence-based).

Instead of hand-tracing a row and chopping it into equal slices (which never
line up with real spaces under perspective), DERIVE each stall from where cars
actually park: run the detector over the clip, accumulate vehicle boxes inside
a row hint, cluster them into discrete car positions, learn the stall pitch,
and lay down a regular grid that lands on cars AND fills the empty spots in
between. Output = explicit per-stall polygons (per_spot.py reads "poly").

  python auto_stalls.py --video V.mp4 --roi u7_stalls.json --out u7_stalls_auto.json --device mps

--roi is just a HINT box (your traced row) used to ignore other rows; the
precise stalls come from the cars, not from the box.
"""
import argparse
import json

import cv2
import numpy as np
from ultralytics import YOLO

VEHICLE = [2, 3, 5, 7]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--roi", required=True)
    ap.add_argument("--out", default="source/public/u7_stalls_auto.json")
    ap.add_argument("--model", default="models/yolo11x.pt")
    ap.add_argument("--device", default=None)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--dilate", type=float, default=55, help="px the row hint is grown by")
    ap.add_argument("--merge", type=float, default=42, help="px: detections closer than this along the row are the same car")
    ap.add_argument("--min-frac", type=float, default=0.08, help="a car must be seen in this fraction of frames")
    ap.add_argument("--depth", type=float, default=0.6,
                    help="cell height as a fraction of pitch; keep small so a stall can't reach the row behind it")
    args = ap.parse_args()

    quad = np.array(json.load(open(args.roi))[0]["corners"], dtype=np.int32)
    model = YOLO(args.model)

    pts = []  # (cx, cy, w, h) of vehicle boxes whose center is in the (dilated) row hint
    nf = 0
    for r in model.predict(source=args.video, stream=True, classes=VEHICLE,
                           conf=args.conf, verbose=False, device=args.device):
        nf += 1
        b = r.boxes
        if b is None or not len(b):
            continue
        for x1, y1, x2, y2 in b.xyxy.cpu().numpy():
            bx, by = (x1 + x2) / 2, y2  # ground-contact point (tires on asphalt)
            if cv2.pointPolygonTest(quad, (float(bx), float(by)), True) >= -args.dilate:
                pts.append((bx, by, x2 - x1, y2 - y1))
    pts = np.array(pts)
    assert len(pts), "no vehicle detections inside the row hint"

    # ground-contact line of the near row: y = m*x + b
    m, b = np.polyfit(pts[:, 0], pts[:, 1], 1)

    # cluster along x (gap-based) -> one cluster per parked car
    order = np.argsort(pts[:, 0])
    xs, ws, hs = pts[order, 0], pts[order, 2], pts[order, 3]
    groups, cur = [], [0]
    for i in range(1, len(xs)):
        if xs[i] - xs[cur[-1]] <= args.merge:
            cur.append(i)
        else:
            groups.append(cur); cur = [i]
    groups.append(cur)

    min_count = max(20, args.min_frac * nf)
    cars = [(float(np.mean(xs[g])), float(np.median(ws[g])), float(np.median(hs[g])))
            for g in groups if len(g) >= min_count]
    assert len(cars) >= 2, f"only {len(cars)} car cluster(s) — need a busier clip or looser --merge"
    cars.sort()

    cxs = [c[0] for c in cars]
    pitch = float(np.median(np.diff(cxs)))
    med_h = float(np.median([c[2] for c in cars]))

    # regular grid spanning the seen cars; positions between cars = empty stalls
    x0, x1 = cxs[0], cxs[-1]
    n = max(2, int(round((x1 - x0) / pitch)) + 1)
    grid = [x0 + i * (x1 - x0) / (n - 1) for i in range(n)]

    # short band straddling the ground line: mostly up into the spot, a little toward the camera
    hw = pitch * 0.46
    depth = pitch * args.depth
    top_off, bot_off = depth * 0.7, depth * 0.3
    stalls = []
    for xc in grid:
        xl, xr = xc - hw, xc + hw
        yl, yr = m * xl + b, m * xr + b
        poly = [[xl, yl - top_off], [xr, yr - top_off], [xr, yr + bot_off], [xl, yl + bot_off]]
        stalls.append({"poly": [[int(round(px)), int(round(py))] for px, py in poly]})
    json.dump(stalls, open(args.out, "w"), indent=2)

    cap = cv2.VideoCapture(args.video)
    cap.set(cv2.CAP_PROP_POS_FRAMES, 150)
    ok, frame = cap.read()
    cap.release()
    if ok:
        cv2.polylines(frame, [quad], True, (255, 0, 0), 1)
        for bx, by, _, _ in pts:  # ground-contact points used to place stalls
            cv2.circle(frame, (int(bx), int(by)), 2, (0, 140, 255), -1)
        for i, s in enumerate(stalls):
            p = np.array(s["poly"], np.int32)
            cv2.polylines(frame, [p], True, (0, 255, 255), 2)
            c = p.mean(0).astype(int)
            cv2.putText(frame, str(i), (c[0] - 6, c[1] + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
            cv2.putText(frame, str(i), (c[0] - 6, c[1] + 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
        cv2.imwrite("work/auto_stalls_preview.jpg", frame)

    print(json.dumps({"detections": len(pts), "frames": nf, "cars_found": len(cars),
                      "pitch_px": round(pitch, 1), "med_car_h": round(med_h, 1),
                      "stalls": len(stalls), "out": args.out}, indent=2))


if __name__ == "__main__":
    main()
