"""
Vacant — per-spot occupancy (THE core product).

Define each parking stall ONCE per camera, then every frame just asks "is a car
in this stall?" -> occupied / empty. No tracking, no line, no motion. A fixed
camera + fixed stalls is the most accurate setup in this whole space.

Stalls are defined as ROWS (so you specify a few quads, not dozens of boxes).
stalls.json = list of rows, each:
  {"corners": [[x,y],[x,y],[x,y],[x,y]], "count": N}
corners order = top-left, top-right, bottom-right, bottom-left of the whole row;
the row quad is auto-subdivided into N stall polygons.

Usage:
  python per_spot.py --video V.mp4 --stalls stalls.json --preview     # check placement
  python per_spot.py --video V.mp4 --stalls stalls.json --model yolo11x.pt --device mps
"""
import argparse
import json
from collections import deque
from pathlib import Path

import cv2
import numpy as np
import supervision as sv
from ultralytics import YOLO

VEHICLE = [2, 3, 5, 7]  # COCO car/moto/bus/truck


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def build_stalls(rows):
    polys = []
    for r in rows:
        if "poly" in r:
            polys.append(np.array(r["poly"], dtype=np.int32))
            continue
        tl, tr, br, bl = r["corners"]
        n = r["count"]
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            polys.append(np.array(
                [lerp(tl, tr, t0), lerp(tl, tr, t1), lerp(bl, br, t1), lerp(bl, br, t0)],
                dtype=np.int32))
    return polys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--stalls", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--model", default="yolo11x.pt")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--device", default=None)
    ap.add_argument("--metric", choices=["overlap", "center", "anchor"], default="overlap",
                    help="anchor = car ground-contact point in stall (best for back-to-back double rows)")
    ap.add_argument("--overlap", type=float, default=0.15,
                    help="overlap metric: stall occupied if a car box covers >= this fraction of it")
    ap.add_argument("--hold", type=int, default=9,
                    help="temporal window (frames) for majority-vote debounce; bigger = steadier")
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()

    rows = json.load(open(args.stalls))
    stalls = build_stalls(rows)
    info = sv.VideoInfo.from_video_path(args.video)

    if args.preview:
        frame = next(sv.get_video_frames_generator(args.video))
        for i, p in enumerate(stalls):
            cv2.polylines(frame, [p], True, (0, 255, 255), 2)
            c = p.mean(axis=0).astype(int)
            cv2.putText(frame, str(i), (c[0] - 8, c[1] + 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
        out = str(Path(args.video).with_name("stalls_preview.jpg"))
        cv2.imwrite(out, frame)
        print("wrote", out, "|", len(stalls), "stalls")
        return

    out = args.out or str(Path(args.video).with_name(Path(args.video).stem + "_spots.mp4"))
    model = YOLO(args.model)
    total = len(stalls)
    open_series = []

    stall_f = [p.astype(np.float32) for p in stalls]
    stall_area = [max(float(cv2.contourArea(p)), 1.0) for p in stall_f]
    hist = [deque(maxlen=args.hold) for _ in range(total)]  # last-K raw readings per stall
    committed = [False] * total                              # debounced state shown/counted

    with sv.VideoSink(out, video_info=info) as sink:
        for r in model.predict(source=args.video, stream=True, classes=VEHICLE,
                               conf=args.conf, verbose=False, device=args.device):
            frame = r.orig_img.copy()
            det = sv.Detections.from_ultralytics(r)
            xy = det.xyxy if len(det) else np.empty((0, 4))
            if args.metric == "overlap":
                car_quads = [np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32)
                             for x1, y1, x2, y2 in xy]
            elif args.metric == "anchor":
                # ground-contact: bottom-center of each car box (tires-on-asphalt point)
                anchors = [((x1 + x2) / 2, y2) for x1, y1, x2, y2 in xy]
            else:
                centers = (np.stack([(xy[:, 0] + xy[:, 2]) / 2, (xy[:, 1] + xy[:, 3]) / 2], axis=1)
                           if len(xy) else np.empty((0, 2)))

            overlay = frame.copy()
            occupied = 0
            for i, p in enumerate(stalls):
                if args.metric == "overlap":
                    best = 0.0
                    for cq in car_quads:
                        a, _ = cv2.intersectConvexConvex(stall_f[i], cq)
                        if a > best:
                            best = a
                    raw = (best / stall_area[i]) >= args.overlap
                elif args.metric == "anchor":
                    raw = any(cv2.pointPolygonTest(p, (float(ax), float(ay)), False) >= 0
                              for ax, ay in anchors)
                else:
                    raw = any(cv2.pointPolygonTest(p, (float(cx), float(cy)), False) >= 0
                              for cx, cy in centers)

                # majority vote over the last K frames (tie -> hold previous state)
                hist[i].append(raw)
                two_t = 2 * sum(hist[i])
                if two_t > len(hist[i]):
                    committed[i] = True
                elif two_t < len(hist[i]):
                    committed[i] = False
                occ = committed[i]

                cv2.fillPoly(overlay, [p], (0, 0, 255) if occ else (0, 200, 0))
                occupied += 1 if occ else 0
            frame = cv2.addWeighted(overlay, 0.35, frame, 0.65, 0)
            for p in stalls:
                cv2.polylines(frame, [p], True, (255, 255, 255), 1)

            openn = total - occupied
            open_series.append(openn)
            cv2.rectangle(frame, (0, 0), (380, 46), (0, 0, 0), -1)
            cv2.putText(frame, f"OPEN: {openn} / {total}", (12, 33),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.95, (0, 255, 0), 2)
            sink.write_frame(frame)

    summary = {
        "video": args.video, "output": out, "total_stalls": total,
        "min_open": int(min(open_series)) if open_series else 0,
        "max_open": int(max(open_series)) if open_series else 0,
        "avg_open": round(float(np.mean(open_series)), 1) if open_series else 0,
        "model": args.model, "conf": args.conf,
        "metric": args.metric, "overlap": args.overlap, "hold": args.hold,
    }
    json.dump(summary, open(str(Path(out).with_suffix(".json")), "w"), indent=2)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
