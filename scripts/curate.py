"""
Vacant — camera curation probe.

Fetch every candidate public camera, run the occupancy recipe, record car count +
dims + last-modified, save an annotated thumbnail, and assemble a labeled contact
sheet (work/curate/contact.jpg) so we can eyeball which feeds are REAL parking
lots at a usable angle vs trails / scenery / streets. One-time, run on demand.

  .venv/bin/python scripts/curate.py
"""
import json
import os
import time
import urllib.request

import cv2
import numpy as np
from ultralytics import YOLO

VEHICLE = [2, 3, 5, 7]
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
OUT = 'work/curate'
BC = 'https://bouldercountyopenspace.org/photos/{}'
NYC = 'https://webcams.nyctmc.org/api/cameras/{}/image'

# every Boulder County trailhead view (from the official live-cameras page) + the
# NYC streets currently in the worker, so we judge them all on one sheet.
CAMS = []
for slug in ['coalton', 'heil', 'lagerman', 'pella', 'rsp', 'walker']:
    for n in (1, 2, 3, 4):
        CAMS.append((f'{slug}{n}', BC.format(f'{slug}/live{n}.jpg')))
CAMS += [('chp_lot', BC.format('chp/parkinglot.jpg')), ('chp_lake', BC.format('chp/lake.jpg'))]
NYC_CAMS = {
    'fdr122': 'ec1e7b42-18de-4475-8c89-9e80f21e5b6c', 'worth': '07b8616e-373e-4ec9-89cc-11cad7d59fcb',
    'bway42': '9565e94d-66f2-4965-9c13-82d5500d6cfd', 'qblvd48': '49a571bf-f15e-4726-9937-aadde6c837ba',
    'gcp': 'a7611e0c-1028-4975-b94b-14e75ec0b217', '2ave58': '5b44d19e-de48-4941-b071-d2a4c08bd230',
    'pennyfld': 'e51a2974-8ca2-4fe2-a90a-842685cbbcc9', 'kenmare': '93dea5a7-a63f-4415-ae12-f32b62540f11',
}
for k, u in NYC_CAMS.items():
    CAMS.append((k, NYC.format(u)))


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    r = urllib.request.urlopen(req, timeout=15)
    lm = r.headers.get('Last-Modified', '')
    data = r.read()
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR), lm


def main():
    os.makedirs(OUT, exist_ok=True)
    model = YOLO('models/yolo11x.pt')
    rows, tiles = [], []
    for cid, url in CAMS:
        try:
            frame, lm = fetch(url)
            if frame is None:
                rows.append({'id': cid, 'cars': -1, 'note': 'no-decode'}); continue
            h, w = frame.shape[:2]
            r = model.predict(frame, classes=VEHICLE, conf=0.15, imgsz=1280, verbose=False, device='mps')[0]
            xy = r.boxes.xyxy.cpu().numpy() if r.boxes is not None and len(r.boxes) else np.empty((0, 4))
            viz = frame.copy()
            for x1, y1, x2, y2 in xy:
                cv2.rectangle(viz, (int(x1), int(y1)), (int(x2), int(y2)), (0, 220, 0), max(2, w // 480))
            cv2.imwrite(f'{OUT}/{cid}.jpg', viz)
            rows.append({'id': cid, 'cars': len(xy), 'dims': f'{w}x{h}', 'last_modified': lm})
            # contact-sheet tile: 320 wide, labeled
            tw = 320; th = int(h * tw / w)
            tile = cv2.resize(viz, (tw, th))
            cv2.rectangle(tile, (0, 0), (tw, 20), (0, 0, 0), -1)
            cv2.putText(tile, f'{cid}  cars={len(xy)}', (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
            tiles.append((cid, tile))
            print(f'{cid:12s} cars={len(xy):3d}  {w}x{h}  {lm}', flush=True)
        except Exception as e:
            rows.append({'id': cid, 'cars': -1, 'note': f'{type(e).__name__}'})
            print(f'{cid:12s} ERR {type(e).__name__}: {e}', flush=True)
        time.sleep(0.3)

    # contact sheet: pad tiles to common height, 4 per row
    if tiles:
        TW = 320; TH = max(t.shape[0] for _, t in tiles); cols = 4
        canvas_rows = []
        row_imgs = []
        for i, (_, t) in enumerate(tiles):
            pad = np.full((TH, TW, 3), 40, np.uint8); pad[:t.shape[0]] = t
            row_imgs.append(pad)
            if len(row_imgs) == cols:
                canvas_rows.append(np.hstack(row_imgs)); row_imgs = []
        if row_imgs:
            while len(row_imgs) < cols:
                row_imgs.append(np.full((TH, TW, 3), 40, np.uint8))
            canvas_rows.append(np.hstack(row_imgs))
        cv2.imwrite(f'{OUT}/contact.jpg', np.vstack(canvas_rows))
        print(f'\ncontact sheet -> {OUT}/contact.jpg', flush=True)
    json.dump(rows, open(f'{OUT}/curate.json', 'w'), indent=2)


if __name__ == '__main__':
    main()
