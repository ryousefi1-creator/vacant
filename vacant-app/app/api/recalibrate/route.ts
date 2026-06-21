import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const CALIB_DIR = path.resolve(process.cwd(), '..', 'calib');

// POST /api/recalibrate?id=HWPARKING1
// Wipes learned stalls so push.py re-learns from scratch on next run.
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });

    const file = path.join(CALIB_DIR, `${id}.json`);
    if (!fs.existsSync(file)) return Response.json({ error: 'not found' }, { status: 404 });

    const calib = JSON.parse(fs.readFileSync(file, 'utf8'));
    calib.stalls = null;
    calib._recalibrated_at = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(calib, null, 2));

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
