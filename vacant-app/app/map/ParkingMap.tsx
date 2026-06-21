'use client';
import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';

type Occ = {
  ts: number; id: string; name: string; inside: number | null;
  capacity: number | null; stalls: unknown[] | null; image: string | null;
};
type NearbyLot = { id: number; lat: number; lon: number; tags: Record<string, string> };

const GREEN = '#10b981';
const RED   = '#ef4444';
const GRAY  = '#9aa6b2';
const BLUE  = '#3b82f6';

// Real trailhead coordinates for our live Boulder County lots (lot id -> [lat, lng]).
// The worker posts occupancy keyed by id; we join it to a real coordinate here so each
// monitored lot pins at its TRUE location. Lots without a coord (NYC street counters,
// or a not-yet-placed lot) are simply skipped on the map.
const LOT_COORDS: Record<string, [number, number]> = {
  chp:       [39.9647, -105.1349],   // Carolyn Holmberg Preserve (Stearns Lake), Broomfield
  coalton1:  [39.92873, -105.16743], // Coalton Trailhead, Superior
  pella3:    [40.18365, -105.17680], // Pella Crossing, Hygiene
  walker3:   [39.9543, -105.3416],   // Walker Ranch, Flagstaff Rd, Boulder
  lagerman2: [40.13546, -105.19066], // Lagerman Reservoir, Longmont
  rsp3:      [40.2459, -105.22258],  // Rabbit Mountain (Ron Stewart Preserve), Lyons
};

function pinSvg(color: string, label: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <filter id="sh"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".25"/></filter>
    <path d="M16 0C9.4 0 4 5.4 4 12c0 9 12 28 12 28S28 21 28 12C28 5.4 22.6 0 16 0z"
      fill="${color}" filter="url(#sh)"/>
    <circle cx="16" cy="12" r="7" fill="white"/>
    <text x="16" y="16" text-anchor="middle" font-family="system-ui,sans-serif"
      font-size="${label.length > 1 ? '8' : '10'}" font-weight="800" fill="${color}">${label}</text>
  </svg>`;
}

function svgIcon(L: typeof import('leaflet'), color: string, label: string) {
  return L.divIcon({
    html: pinSvg(color, label),
    className: '',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -42],
  });
}

// Public parking tagged in OpenStreetMap within 2km of the user (a bonus layer on top of our lots).
async function fetchNearby(lat: number, lng: number): Promise<NearbyLot[]> {
  const q = `[out:json][timeout:10];
(
  node["amenity"="parking"](around:2000,${lat},${lng});
  way["amenity"="parking"](around:2000,${lat},${lng});
)->.p;
out center 40;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q });
    const j = await r.json();
    return (j.elements || []).map((e: any) => ({
      id: e.id,
      lat: e.lat ?? e.center?.lat,
      lon: e.lon ?? e.center?.lon,
      tags: e.tags || {},
    })).filter((e: NearbyLot) => e.lat && e.lon);
  } catch { return []; }
}

export default function ParkingMap({ occ }: { occ: Record<string, Occ> }) {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [status, setStatus] = useState('Loading lots…');
  const [nearbyCount, setNearbyCount] = useState<number | null>(null);
  const markersRef = useRef<any[]>([]);

  // Bootstrap the map once: tiles, the user's location, and nearby public parking.
  useEffect(() => {
    if (mapRef.current || !mapDiv.current) return;
    let cancelled = false;

    (async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !mapDiv.current) return;

      // Default to Boulder County (where our live lots are) until they load + fit.
      const map = L.map(mapDiv.current, { zoomControl: true }).setView([40.02, -105.25], 10);
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // User location + nearby public parking — added as a layer, does NOT steal the lot view.
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            if (cancelled) return;
            const { latitude: lat, longitude: lng } = pos.coords;
            L.circleMarker([lat, lng], { radius: 8, fillColor: '#6366f1', fillOpacity: 1, color: '#fff', weight: 2 })
              .addTo(map).bindTooltip('You are here');
            fetchNearby(lat, lng).then(nearby => {
              if (cancelled) return;
              setNearbyCount(nearby.length);
              nearby.forEach(n => {
                const name = n.tags.name || n.tags['addr:street'] || 'Public Parking';
                const fee = n.tags.fee ? ` · ${n.tags.fee}` : '';
                const access = n.tags.access || 'unknown';
                L.marker([n.lat, n.lon], { icon: svgIcon(L, BLUE, 'P') }).addTo(map)
                  .bindPopup(`<div style="font-family:system-ui;min-width:160px">
                    <div style="font-weight:700;font-size:13px;margin-bottom:4px">${name}</div>
                    <div style="font-size:11px;color:#6b7a8d">Public parking${fee}</div>
                    <div style="font-size:11px;color:#6b7a8d;margin-top:2px">Access: ${access}</div>
                  </div>`);
              });
            });
          },
          () => { setNearbyCount(0); },
          { timeout: 8000 }
        );
      } else {
        setNearbyCount(0);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Plot OUR live lots at their REAL coordinates whenever occupancy updates.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    (async () => {
      const L = await import('leaflet');
      if (cancelled) return;

      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      let liveCount = 0;
      Object.values(occ).forEach(o => {
        const pos = LOT_COORDS[o.id];
        if (!pos) return; // street counters / lots without a placed coordinate
        const isLive = Date.now() - o.ts < 60_000;
        if (isLive) liveCount++;
        const taken = o.stalls ? (o.stalls as { taken: boolean }[]).filter(s => s.taken).length : (o.inside ?? null);
        const cap = (o.stalls as unknown[] | null)?.length ?? o.capacity ?? null;
        const open = cap != null && taken != null ? Math.max(0, cap - taken) : null;
        const color = !isLive ? GRAY : open === 0 ? RED : GREEN;
        const label = open != null ? String(open) : '?';

        const m = L.marker(pos, { icon: svgIcon(L, color, label) }).addTo(map)
          .bindPopup(`<div style="font-family:system-ui;min-width:180px">
            <div style="font-weight:800;font-size:14px;margin-bottom:6px">${o.name}</div>
            <div style="font-size:22px;font-weight:800;color:${color}">${open ?? '—'}</div>
            <div style="font-size:11px;color:#6b7a8d;margin-bottom:8px">of ${cap ?? '?'} spots open</div>
            <div style="font-size:11px;color:${isLive ? '#10b981' : '#9aa6b2'};font-weight:600">${isLive ? '● LIVE' : '○ OFFLINE'}</div>
            ${o.image ? `<img src="${o.image}" style="width:100%;border-radius:6px;margin-top:8px" />` : ''}
          </div>`, { maxWidth: 240 });
        markersRef.current.push(m);
      });

      setStatus(liveCount ? `${liveCount} live lot${liveCount !== 1 ? 's' : ''} monitored` : 'Waiting for live lot data…');

      // Frame the map on our lots the first time they load (then let the user pan freely).
      const mp = map as unknown as { _vacantFitted?: boolean };
      if (markersRef.current.length && !mp._vacantFitted) {
        map.fitBounds(L.featureGroup(markersRef.current).getBounds().pad(0.3));
        mp._vacantFitted = true;
      }
    })();

    return () => { cancelled = true; };
  }, [occ]);

  const statusText = nearbyCount == null
    ? status
    : `${status} · ${nearbyCount} public lot${nearbyCount !== 1 ? 's' : ''} near you`;

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={mapDiv} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
        background: 'rgba(13,27,42,.82)', color: '#fff', borderRadius: 20, padding: '6px 16px',
        fontSize: 12, fontWeight: 600, backdropFilter: 'blur(6px)', pointerEvents: 'none' }}>
        {statusText}
      </div>
    </div>
  );
}
