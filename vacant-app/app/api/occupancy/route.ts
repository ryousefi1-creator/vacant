// Live occupancy store. The CV worker (scripts/push.py) POSTs the latest
// detection here; the dashboard GETs it.
//   - Local dev: in-memory (single process) — no setup.
//   - Production (Vercel): Upstash Redis (serverless instances don't share
//     memory). Set KV_REST_API_URL + KV_REST_API_TOKEN (the Vercel Marketplace
//     Upstash integration provides them) and it's used automatically.
// POST is protected by a shared token when VACANT_TOKEN is set (recommended in
// prod so only your worker can write). GET stays public (anyone can read the map).
import { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';

type Car = { x: number; y: number };
type Occ = {
  ts: number; id: string; name: string; type: string; surface: string | null;
  count: number; inside: number | null; cars: Car[] | null; map: [number, number] | null;
  capacity: number | null; peak: number | null; refresh_sec: number | null; image: string | null;
};

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;
const KEY = 'vacant:occ';

const mem: Record<string, Occ> = {};

async function getAll(): Promise<Record<string, Occ>> {
  if (redis) return (await redis.hgetall<Record<string, Occ>>(KEY)) || {};
  return mem;
}
async function put(o: Occ): Promise<void> {
  if (redis) await redis.hset(KEY, { [o.id]: o });
  else mem[o.id] = o;
}

export async function GET() {
  return Response.json(await getAll());
}

export async function POST(request: Request) {
  const required = process.env.VACANT_TOKEN;
  if (required && request.headers.get('x-vacant-token') !== required) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const b = await request.json();
  if (!b.id) return Response.json({ ok: false, error: 'missing id' }, { status: 400 });
  await put({
    ts: Date.now(),
    id: String(b.id),
    name: String(b.name ?? b.id),
    type: String(b.type ?? 'lot'),
    surface: typeof b.surface === 'string' ? b.surface : null,
    count: Number(b.count) || 0,
    inside: b.inside == null ? null : Number(b.inside) || 0,
    cars: Array.isArray(b.cars) ? b.cars.map((c: Car) => ({ x: Number(c.x) || 0, y: Number(c.y) || 0 })) : null,
    map: Array.isArray(b.map) && b.map.length === 2 ? [Number(b.map[0]), Number(b.map[1])] : null,
    capacity: b.capacity == null ? null : Number(b.capacity) || 0,
    peak: b.peak == null ? null : Number(b.peak) || 0,
    refresh_sec: b.refresh_sec == null ? null : Number(b.refresh_sec) || 0,
    image: typeof b.image === 'string' ? b.image : null,
  });
  return Response.json({ ok: true });
}
