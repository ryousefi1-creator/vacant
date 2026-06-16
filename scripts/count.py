"""
Vacant — vehicle counting (occupancy-first).

Robust counting that does NOT depend on a thin line a car could drive around:

  - OCCUPANCY (the backbone): how many vehicles are present each frame. A car
    cannot "avoid" being counted as present. Works even on a moving camera and
    even when track IDs flicker, because it doesn't use IDs at all. We report a
    smoothed occupancy curve (peak / avg / min) and estimate net entries/exits
    from how that curve changes over time.
  - ZONE (optional): restrict occupancy to a polygon (your lot), so cars passing
    by outside the lot aren't counted.
  - GATE (optional): a directional in/out line for when there IS a real
    chokepoint (one driveway every car must use). Spanned wall-to-wall it can't
    be dodged. Off by default.

Tracking uses BoT-SORT (global motion compensation) so a handheld/moving camera
doesn't shred the track IDs — no video warping, so no edge blur.

Outputs: annotated .mp4, an occupancy chart .png, and a .json summary.

Usage:
  # see where the zone / gate land (instant, no AI):
  python count.py --video IN.mov --preview \
      --zone "120,300 980,300 980,1060 120,1060" --line 307,540,653,756
  # full run:
  python count.py --video IN.mov --model yolo11x.pt --device mps \
      --zone "120,300 980,300 980,1060 120,1060"
"""
import argparse
import json
from pathlib import Path

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import supervision as sv
from ultralytics import YOLO

VEHICLE_CLASSES = {2: "car", 3: "moto", 5: "bus", 7: "truck"}


def parse_polygon(s):
    if not s:
        return None
    pts = [[int(c) for c in tok.split(",")] for tok in s.split()]
    return np.array(pts, dtype=np.int64)


def parse_line(s):
    if not s:
        return None
    x1, y1, x2, y2 = (int(v) for v in s.split(","))
    return x1, y1, x2, y2


def rolling_median(vals, win):
    out = []
    h = win // 2
    for i in range(len(vals)):
        out.append(int(round(np.median(vals[max(0, i - h):i + h + 1]))))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--model", default="yolo11x.pt")
    ap.add_argument("--conf", type=float, default=0.30)
    ap.add_argument("--tracker", default="botsort.yaml", help="botsort.yaml | bytetrack.yaml")
    ap.add_argument("--zone", default=None, help="polygon: 'x1,y1 x2,y2 ...' (lot region)")
    ap.add_argument("--line", default=None, help="gate: 'x1,y1,x2,y2' (directional in/out)")
    ap.add_argument("--smooth", type=int, default=15, help="occupancy smoothing window (frames)")
    ap.add_argument("--hold", type=int, default=75,
                    help="frames a level must persist to count as a real entry/exit (debounce)")
    ap.add_argument("--device", default=None, help="mps | cpu | cuda")
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()

    info = sv.VideoInfo.from_video_path(args.video)
    fps = info.fps or 30
    polygon = parse_polygon(args.zone)
    gate_pts = parse_line(args.line)

    # --- preview: draw zone + gate on first frame, exit ---
    if args.preview:
        frame = next(sv.get_video_frames_generator(args.video))
        if polygon is not None:
            cv2.polylines(frame, [polygon], True, (0, 255, 255), 3)
        if gate_pts:
            cv2.line(frame, gate_pts[:2], gate_pts[2:], (0, 0, 255), 4)
        p = str(Path(args.video).with_name("zone_preview.jpg"))
        cv2.imwrite(p, frame)
        print("wrote", p)
        return

    out = args.out or str(Path(args.video).with_name(Path(args.video).stem + "_counted.mp4"))
    zone = sv.PolygonZone(polygon=polygon) if polygon is not None else None
    gate = sv.LineZone(start=sv.Point(*gate_pts[:2]), end=sv.Point(*gate_pts[2:])) if gate_pts else None

    box = sv.BoxAnnotator(thickness=2)
    labeler = sv.LabelAnnotator(text_scale=0.5, text_thickness=1)
    tracer = sv.TraceAnnotator(thickness=2, trace_length=30)
    gate_draw = sv.LineZoneAnnotator(thickness=2, text_scale=0.7,
                                     custom_in_text="IN", custom_out_text="OUT") if gate else None

    model = YOLO(args.model)
    occ, seen, peak = [], set(), 0

    with sv.VideoSink(out, video_info=info) as sink:
        for r in model.track(source=args.video, stream=True, persist=True,
                             classes=list(VEHICLE_CLASSES), conf=args.conf,
                             tracker=args.tracker, verbose=False, device=args.device):
            det = sv.Detections.from_ultralytics(r)
            scene = r.orig_img.copy()

            if zone is not None:
                in_zone = zone.trigger(det)
                det = det[in_zone]
            occupancy = len(det)
            occ.append(occupancy)
            peak = max(peak, occupancy)

            if det.tracker_id is not None and len(det):
                if gate is not None:
                    gate.trigger(det)
                seen.update(int(i) for i in det.tracker_id)
                labels = [f"#{t} {VEHICLE_CLASSES.get(c, 'veh')} {p:.2f}"
                          for t, c, p in zip(det.tracker_id, det.class_id, det.confidence)]
                scene = tracer.annotate(scene, det)
                scene = box.annotate(scene, det)
                scene = labeler.annotate(scene, det, labels=labels)

            if polygon is not None:
                cv2.polylines(scene, [polygon], True, (0, 255, 255), 2)
            if gate is not None:
                scene = gate_draw.annotate(scene, gate)

            cv2.rectangle(scene, (0, 0), (640, 44), (0, 0, 0), -1)
            hud = f"Cars in lot now: {occupancy}   Peak: {peak}"
            if gate is not None:
                hud += f"   gate IN:{gate.in_count} OUT:{gate.out_count}"
            cv2.putText(scene, hud, (12, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
            sink.write_frame(scene)

    # --- derive flow from the occupancy curve (path-independent) ---
    # Debounced: a level change is only counted once it HOLDS for --hold frames,
    # so brief detection flicker isn't mistaken for a car entering/leaving.
    sm = rolling_median(occ, args.smooth)
    entries = exits = 0
    confirmed = sm[0] if sm else 0
    candidate, run, confirmed_series = confirmed, 0, []
    for v in sm:
        candidate, run = (candidate, run + 1) if v == candidate else (v, 1)
        if run >= args.hold and candidate != confirmed:
            d = candidate - confirmed
            entries += d if d > 0 else 0
            exits += -d if d < 0 else 0
            confirmed = candidate
        confirmed_series.append(confirmed)

    # occupancy chart
    t = [i / fps for i in range(len(occ))]
    plt.figure(figsize=(11, 4))
    plt.plot(t, occ, color="0.8", lw=0.8, label="per-frame")
    plt.plot(t, sm, color="C0", lw=2, label="smoothed")
    plt.plot(t, confirmed_series, color="C1", lw=2.5, label="confirmed (debounced)")
    plt.axhline(peak, color="C3", ls="--", lw=1, label=f"peak {peak}")
    plt.axhline(float(np.mean(occ)), color="C2", ls="--", lw=1, label=f"avg {np.mean(occ):.1f}")
    plt.xlabel("seconds"); plt.ylabel("vehicles in lot")
    plt.title("Lot occupancy over time"); plt.legend(loc="lower right"); plt.tight_layout()
    chart = str(Path(out).with_suffix(".png"))
    plt.savefig(chart, dpi=110); plt.close()

    summary = {
        "video": args.video,
        "output_video": out,
        "occupancy_chart": chart,
        "occupancy_peak": int(peak),
        "occupancy_avg": round(float(np.mean(occ)), 1) if occ else 0,
        "occupancy_min": int(min(occ)) if occ else 0,
        "occupancy_start": int(sm[0]) if sm else 0,
        "occupancy_end": int(sm[-1]) if sm else 0,
        "net_change": int(sm[-1] - sm[0]) if sm else 0,
        "estimated_entries_from_occupancy": int(entries),
        "estimated_exits_from_occupancy": int(exits),
        "gate_in": int(gate.in_count) if gate else None,
        "gate_out": int(gate.out_count) if gate else None,
        "raw_track_count_INFLATED_by_id_switches": len(seen),
        "occupancy_per_second": [int(occ[i]) for i in range(0, len(occ), int(fps))],
        "model": args.model, "conf": args.conf, "tracker": args.tracker,
        "zone": polygon.tolist() if polygon is not None else None,
        "line": list(gate_pts) if gate_pts else None,
    }
    with open(str(Path(out).with_suffix(".json")), "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps({k: v for k, v in summary.items() if k != "occupancy_per_second"}, indent=2))


if __name__ == "__main__":
    main()
