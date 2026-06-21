import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

export const dynamic = 'force-dynamic';

const PYTHON_SCRIPT = `
import cv2, json, sys, time
url = sys.argv[1]
try:
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
    cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
    opened = cap.isOpened()
    frame_ok = False
    w, h = 0, 0
    if opened:
        for _ in range(3):
            cap.grab()
        ret, fr = cap.read()
        if ret and fr is not None:
            frame_ok = True
            h, w = fr.shape[:2]
    cap.release()
    print(json.dumps({"ok": opened, "frame": frame_ok, "width": w, "height": h}))
except Exception as e:
    print(json.dumps({"ok": False, "frame": False, "error": str(e)}))
`.trim();

export async function POST(request: NextRequest) {
  let url: string;
  try {
    const body = await request.json();
    url = String(body.url ?? '').trim();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  if (!url) return NextResponse.json({ ok: false, error: 'url required' }, { status: 400 });
  if (!url.startsWith('rtsp://') && !url.startsWith('rtmp://') && !url.startsWith('srt://')) {
    return NextResponse.json({ ok: false, error: 'only rtsp://, rtmp://, or srt:// supported' }, { status: 400 });
  }

  return new Promise<NextResponse>(resolve => {
    const proc   = spawn('python3', ['-c', PYTHON_SCRIPT, url]);
    let out      = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
      resolve(NextResponse.json({ ok: false, frame: false, error: 'timeout — camera did not respond in 9 s' }));
    }, 9000);

    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });

    proc.on('close', () => {
      if (timedOut) return;
      clearTimeout(timer);
      try {
        const result = JSON.parse(out.trim());
        resolve(NextResponse.json(result));
      } catch {
        resolve(NextResponse.json({ ok: false, frame: false, error: 'python parse error' }));
      }
    });
  });
}
