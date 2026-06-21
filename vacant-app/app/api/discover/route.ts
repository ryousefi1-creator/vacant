import { NextResponse } from 'next/server';
import * as os from 'os';
import * as net from 'net';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const RTSP_PORT = 554;
const PROBE_MS  = 350;
const BATCH     = 40;

function probe(ip: string, port: number, ms: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = new net.Socket();
    let done = false;
    const fin = (v: boolean) => { if (!done) { done = true; s.destroy(); resolve(v); } };
    s.setTimeout(ms);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error',   () => fin(false));
    s.connect(port, ip);
  });
}

function localSubnets(): string[] {
  const ifaces = os.networkInterfaces();
  const seen   = new Set<string>();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const addr of list) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const parts = addr.address.split('.');
      if (parts.length === 4) seen.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    }
  }
  return [...seen];
}

export async function GET() {
  const subnets = localSubnets();
  if (!subnets.length) {
    return NextResponse.json({ found: [], subnets: [], error: 'No local network interfaces detected' });
  }

  const found: string[] = [];

  for (const sub of subnets) {
    const ips: string[] = [];
    for (let i = 1; i <= 254; i++) ips.push(`${sub}.${i}`);

    for (let b = 0; b < ips.length; b += BATCH) {
      const batch = ips.slice(b, b + BATCH);
      const results = await Promise.all(batch.map(ip => probe(ip, RTSP_PORT, PROBE_MS)));
      results.forEach((ok, i) => { if (ok) found.push(batch[i]); });
    }
  }

  return NextResponse.json({ found, subnets });
}
