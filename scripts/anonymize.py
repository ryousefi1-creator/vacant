"""
Vacant — PII anonymization for public display.

The worker posts annotated camera frames to a PUBLIC site, so before a frame leaves the
Mac we blur license plates + faces. Detection runs on the CLEAN frame first; only the
POSTED image is anonymized (so accuracy is unaffected, privacy is).

Plate detection uses a dedicated YOLO model at models/license_plate.pt if present (best),
else OpenCV's built-in Haar plate cascade (best-effort). Faces use OpenCV Haar. At our
camera distances + the ~800px posted downscale most plates are already illegible; this is
defense-in-depth + legal cover, and auto-upgrades the moment a plate model is dropped in.
"""
import os

import cv2
import numpy as np

_HAAR = cv2.data.haarcascades
_FACE = cv2.CascadeClassifier(_HAAR + 'haarcascade_frontalface_default.xml')
_PLATE = cv2.CascadeClassifier(_HAAR + 'haarcascade_russian_plate_number.xml')

_PLATE_MODEL = None
_PLATE_MODEL_PATH = 'models/license_plate.pt'   # drop a dedicated ANPR model here to upgrade


def _plate_model():
    global _PLATE_MODEL
    if _PLATE_MODEL is None and os.path.exists(_PLATE_MODEL_PATH):
        from ultralytics import YOLO
        _PLATE_MODEL = YOLO(_PLATE_MODEL_PATH)
    return _PLATE_MODEL


def _blur(frame, x1, y1, x2, y2, pad=2):
    h, w = frame.shape[:2]
    x1, y1 = max(0, int(x1) - pad), max(0, int(y1) - pad)
    x2, y2 = min(w, int(x2) + pad), min(h, int(y2) + pad)
    if x2 <= x1 or y2 <= y1:
        return
    region = frame[y1:y2, x1:x2]
    k = max(9, (min(x2 - x1, y2 - y1) // 2) * 2 + 1)   # odd kernel, scales with region size
    frame[y1:y2, x1:x2] = cv2.GaussianBlur(region, (k, k), 0)


def anonymize(frame, device='mps', conf=0.25):
    """Return a copy of `frame` with faces + license plates blurred. Run this on the CLEAN
    frame and pass the result to the annotators, so the POSTED image carries no PII while
    car detection still sees the unblurred frame."""
    out = frame.copy()
    gray = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)
    for (x, y, w, h) in _FACE.detectMultiScale(gray, 1.1, 7, minSize=(24, 24)):
        _blur(out, x, y, x + w, y + h)
    model = _plate_model()
    if model is not None:
        r = model.predict(frame, conf=conf, verbose=False, device=device)[0]
        if r.boxes is not None:
            for bx in r.boxes.xyxy.cpu().numpy():
                _blur(out, bx[0], bx[1], bx[2], bx[3])
    else:
        for (x, y, w, h) in _PLATE.detectMultiScale(gray, 1.1, 4, minSize=(20, 8)):
            _blur(out, x, y, x + w, y + h)
    return out
