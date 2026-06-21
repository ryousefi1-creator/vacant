// Manage calib/*.json lot files from the dashboard.
// POST  /api/lots  — create a new lot (writes calib/<id>.json on disk)
// GET   /api/lots  — list existing lots (reads calib/*.json names)
// DELETE /api/lots?id=HWPARKING2 — remove a lot calib file
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const CALIB_DIR = path.resolve(process.cwd(), '..', 'calib');

function slugify(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'LOT';
}

function uniqueId(base: string): string {
  const existing = fs.readdirSync(CALIB_DIR).filter(f => f.endsWith('.json') && !f.startsWith('.'));
  const ids = existing.map(f => f.replace('.json', ''));
  if (!ids.includes(base)) return base;
  for (let i = 2; i < 100; i++) {
    if (!ids.includes(`${base}${i}`)) return `${base}${i}`;
  }
  return `${base}_${Date.now()}`;
}

export async function GET() {
  try {
    const files = fs.readdirSync(CALIB_DIR)
      .filter(f => f.endsWith('.json') && !f.startsWith('.'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(CALIB_DIR, f), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean);
    return Response.json(files);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, url, capacity } = body;
    if (!name || typeof name !== 'string' || !name.trim())
      return Response.json({ error: 'name is required' }, { status: 400 });
    if (!url || typeof url !== 'string' || !url.trim())
      return Response.json({ error: 'stream URL is required' }, { status: 400 });

    const id = uniqueId(slugify(name.trim()));
    const calib = {
      id,
      name: name.trim(),
      type: 'lot',
      surface: 'paved',
      url: url.trim(),
      refresh_sec: 1,
      imgsz: 1280,
      iou: 0.3,
      clahe: true,
      detect_topdown: false,
      capacity: Number(capacity) || 0,
      stalls: null,
      layout: null,
    };

    fs.writeFileSync(path.join(CALIB_DIR, `${id}.json`), JSON.stringify(calib, null, 2));
    return Response.json({ ok: true, id });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, name, url, capacity, stalls, roads } = body;
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });
    const file = path.join(CALIB_DIR, `${id}.json`);
    if (!fs.existsSync(file)) return Response.json({ error: 'not found' }, { status: 404 });
    const calib = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (name     !== undefined) calib.name     = String(name).trim();
    if (url      !== undefined) calib.url       = String(url).trim();
    if (capacity !== undefined) calib.capacity  = Number(capacity) || 0;
    if (stalls   !== undefined) calib.stalls    = stalls;  // null = auto-detect, array = user-drawn
    if (roads    !== undefined) calib.roads     = roads;
    fs.writeFileSync(file, JSON.stringify(calib, null, 2));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });
    const file = path.join(CALIB_DIR, `${id}.json`);
    if (!fs.existsSync(file)) return Response.json({ error: 'not found' }, { status: 404 });
    fs.unlinkSync(file);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
