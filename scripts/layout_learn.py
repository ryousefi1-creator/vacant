"""
Vacant — LAYOUT LEARNER. Uses Claude vision to reverse-engineer a parking lot's TRUE
top-down layout from one or more camera angles, so the 3D twin can render the ACTUAL lot
(1:1) instead of a generic stall grid. Multi-angle (Coalton live1/live3/live4) lets Claude
triangulate the real shape. Saves calib/<id>_layout_learned.json for the renderer.

  .venv/bin/python scripts/layout_learn.py --id coalton1            # auto: live1/3/4 if Boulder
  .venv/bin/python scripts/layout_learn.py --id coalton1 --urls coalton/live1.jpg,coalton/live3.jpg
"""
import argparse
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import cv2
import numpy as np
import spatial
import vision

BC = 'https://bouldercountyopenspace.org/photos/'
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}

PROMPT = """You are reverse-engineering a parking lot's TRUE top-down (bird's-eye) layout from CCTV.
The attached images are DIFFERENT camera angles of the SAME lot — use them together to triangulate the
real shape (one angle alone is misleading due to perspective). Output ONLY JSON, no prose:

{
  "shape": "rectangular | L-shaped | wedge | irregular  (one line describing the real outline)",
  "surface": "gravel | paved",
  "rows": [
    {"id": 1, "stalls": <int est>, "orientation": "cars nose-to-tail run left-right | front-back | diagonal",
     "where": "front/middle/back, left/right", "angle_deg": <0=parallel-to-camera, 90=facing-camera>}
  ],
  "drive_aisles": <int>,
  "capacity_est": <int total>,
  "entrance": "where vehicles enter the lot",
  "landmarks": ["curb island", "trees", "picnic shelter", ...],
  "proportions": {"width_to_depth": "<e.g. 2.5 : 1>"},
  "notes": "anything that defines the REAL shape a generic grid would miss: islands, angled spaces, slope, irregular edges, which corner is nearest the camera"
}

Be concrete with counts and orientation. If unsure, give your best spatial estimate."""


def fetch(url):
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12).read()
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', required=True)
    ap.add_argument('--urls', help='comma list of full URLs or Boulder "lot/liveN.jpg" paths')
    ap.add_argument('--model', default='claude-opus-4-8')
    args = ap.parse_args()

    calibs = spatial.load_calibs('calib')
    c = calibs.get(args.id, {})
    if args.urls:
        urls = [u if u.startswith('http') else BC + u for u in args.urls.split(',')]
    else:
        urls = [c.get('url')] if c.get('url') else []
        m = re.search(r'/photos/([^/]+)/live\d\.jpg', c.get('url', ''))
        if m:  # Boulder lot -> use the 3 lot-viewing angles (live2 is usually scenery)
            urls = [BC + f'{m.group(1)}/live{n}.jpg' for n in (1, 3, 4)]

    imgs = []
    for u in urls:
        try:
            ok, buf = cv2.imencode('.jpg', fetch(u), [cv2.IMWRITE_JPEG_QUALITY, 88])
            imgs.append(buf.tobytes())
            print(f'  + {u}')
        except Exception as e:
            print(f'  ! skip {u}: {type(e).__name__}')
    if not imgs:
        raise SystemExit('no frames fetched')

    print(f'\nasking {args.model} to learn the layout from {len(imgs)} angle(s)...')
    txt = vision.claude_vision(vision.load_key(), imgs, PROMPT, model=args.model)
    m = re.search(r'\{.*\}', txt, re.S)
    spec = json.loads(m.group()) if m else {'raw': txt}
    out = f'calib/{args.id}_layout_learned.json'
    json.dump(spec, open(out, 'w'), indent=2)
    print('\n' + json.dumps(spec, indent=2))
    print(f'\nsaved -> {out}')


if __name__ == '__main__':
    main()
