"""
Pin a handheld clip to a fixed reference frame (simulates a mounted camera).

For each frame we estimate a similarity transform (translation + rotation +
uniform scale) back to a reference frame using ORB feature matching + RANSAC,
then warp the frame into the reference's coordinate system. The ground then
stays put, so a fixed counting line maps to a fixed location on the pavement
and the tracker stops losing cars to camera motion.
"""
import argparse
from pathlib import Path

import cv2
import numpy as np
import supervision as sv

ap = argparse.ArgumentParser()
ap.add_argument("--video", required=True)
ap.add_argument("--out", default=None)
ap.add_argument("--ref", type=int, default=0, help="reference frame index")
args = ap.parse_args()

info = sv.VideoInfo.from_video_path(args.video)
W, H = info.resolution_wh
out = args.out or str(Path(args.video).with_name(Path(args.video).stem + "_stab.mp4"))

cap = cv2.VideoCapture(args.video)
cap.set(cv2.CAP_PROP_POS_FRAMES, args.ref)
ok, ref = cap.read()
if not ok:
    raise SystemExit("could not read reference frame")
ref_gray = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)

orb = cv2.ORB_create(3000)
kp_ref, des_ref = orb.detectAndCompute(ref_gray, None)
matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)

cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
writer = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), info.fps, (W, H))

identity = np.array([[1, 0, 0], [0, 1, 0]], dtype=np.float32)
last_M = identity.copy()
n = fallback = 0

while True:
    ok, frame = cap.read()
    if not ok:
        break
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    kp, des = orb.detectAndCompute(gray, None)
    M = None
    if des is not None and des_ref is not None and len(kp) > 10:
        matches = matcher.match(des, des_ref)
        if len(matches) > 20:
            matches = sorted(matches, key=lambda m: m.distance)[:300]
            src = np.float32([kp[m.queryIdx].pt for m in matches])
            dst = np.float32([kp_ref[m.trainIdx].pt for m in matches])
            M, _ = cv2.estimateAffinePartial2D(
                src, dst, method=cv2.RANSAC, ransacReprojThreshold=5.0)
    if M is None:
        M = last_M
        fallback += 1
    else:
        last_M = M
    writer.write(cv2.warpAffine(frame, M, (W, H), borderMode=cv2.BORDER_REPLICATE))
    n += 1

cap.release()
writer.release()
print(f"stabilized {n} frames ({fallback} fell back to previous transform) -> {out}")
