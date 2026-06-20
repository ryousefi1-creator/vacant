'use client';
import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';

type Occ = {
  ts: number; id: string; name: string; inside: number | null;
  capacity: number | null; stalls: unknown[] | null; image: string | null;
};
type Calib = { id: string; name: string; url: string; capacity: number; lat?: number; lng?: number };
type NearbyLot = { id: number; lat: number; lon: number; tags: Record<string, string> };

const GREEN  = '#10b981';
const RED    = '#ef4444';
const GRAY   = '#9aa6b2';
const BLUE   = '#3b82f6';

// SVG pin factory
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

async function fetchNearby(lat: number, lng: number): Promise<NearbyLot[]> {
  const q = `[out:json][timeout:10];
(
  node["amenity"="parking"](around:2000,${lat},${lng});
  way["amenity"="parking"](around:2000,${lat},${lng});
)->.p;
out center 40;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: q,
    });
    const j = await r.json();
    return (j.elements || []).map((e: any) => ({
      id: e.id,
      lat: e.lat ?? e.center?.lat,
      lon: e.lon ?? e.center?.lon,
      tags: e.tags || {},
    })).filter((e: NearbyLot) => e.lat && e.lon);
  } catch { return []; }
}

export default function ParkingMap({ occ, calibs }: { occ: Record<string, Occ>; calibs: Calib[] }) {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [status, setStatus] = useState('Locating you…');
  const [userLatLng, setUserLatLng] = useState<[number, number] | null>(null);
  const markersRef = useRef<any[]>([]);

  // Bootstrap the map once
  useEffect(() => {
    if (mapRef.current || !mapDiv.current) return;
    let cancelled = false;

    (async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');

      if (cancelled || !mapDiv.current) return;

      const map = L.map(mapDiv.current, { zoomControl: true }).setView([39.5, -98.35], 4);
      mapRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Try to get user's location
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            if (cancelled) return;
            const { latitude: lat, longitude: lng } = pos.coords;
            setUserLatLng([lat, lng]);
            map.setView([lat, lng], 15);

            // User location dot
            L.circleMarker([lat, lng], { radius: 8, fillColor: '#6366f1', fillOpacity: 1, color: '#fff', weight: 2 })
              .addTo(map)
              .bindTooltip('You are here', { permanent: false });

            // Fetch nearby parking
            setStatus('Finding nearby parking…');
            fetchNearby(lat, lng).then(nearby => {
              if (cancelled) return;
              setStatus(nearby.length ? `${nearby.length} nearby lots found` : 'No nearby parking in OpenStreetMap');
              nearby.forEach(n => {
                const name = n.tags.name || n.tags['addr:street'] || 'Public Parking';
                const fee = n.tags.fee ? ` · ${n.tags.fee}` : '';
                const access = n.tags.access || 'unknown';
                L.marker([n.lat, n.lon], { icon: svgIcon(L, BLUE, 'P') })
                  .addTo(map!)
                  .bindPopup(`<div style="font-family:system-ui;min-width:160px">
                    <div style="font-weight:700;font-size:13px;margin-bottom:4px">${name}</div>
                    <div style="font-size:11px;color:#6b7a8d">Public parking${fee}</div>
                    <div style="font-size:11px;color:#6b7a8d;margin-top:2px">Access: ${access}</div>
                  </div>`);
              });
            });
          },
          () => {
            setStatus('Location denied — showing all your lots');
            // If no location, fit to user's lots if they have coordinates
          },
          { timeout: 8000 }
        );
      } else {
        setStatus('Geolocation not supported');
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Update user lot markers whenever occ/calibs change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let L_: typeof import('leaflet') | null = null;
    (async () => {
      const L = await import('leaflet');
      L_ = L;

      // Remove old user-lot markers
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      // Add a marker for each calib lot that has live data
      // Since our lots don't store lat/lng, place them at user's location offset
      // (they'll be clustered but still visible & clickable)
      calibs.forEach((c, i) => {
        const o = occ[c.id];
        const live = o && Date.now() - o.ts < 15_000;
        const taken = o?.stalls ? (o.stalls as any[]).filter(s => s.taken).length : (o?.inside ?? null);
        const cap = (o?.stalls as any[] | null)?.length ?? o?.capacity ?? c.capacity ?? null;
        const open = cap != null && taken != null ? cap - taken : null;
        const color = !live ? GRAY : open === 0 ? RED : GREEN;
        const label = open != null ? String(open) : '?';

        const lat0 = userLatLng ? userLatLng[0] + (i - calibs.length / 2) * 0.00015 : 39.5;
        const lng0 = userLatLng ? userLatLng[1] + 0.0001 : -98.35;

        const m = L.marker([lat0, lng0], { icon: svgIcon(L, color, label) })
          .addTo(map)
          .bindPopup(`<div style="font-family:system-ui;min-width:180px">
            <div style="font-weight:800;font-size:14px;margin-bottom:6px">${c.name}</div>
            <div style="font-size:20px;font-weight:800;color:${color}">${open ?? '—'}</div>
            <div style="font-size:11px;color:#6b7a8d;margin-bottom:8px">of ${cap ?? '?'} spots open</div>
            <div style="font-size:11px;color:${live ? '#10b981' : '#9aa6b2'};font-weight:600">${live ? '● LIVE' : '○ OFFLINE'}</div>
            ${o?.image ? `<img src="${o.image}" style="width:100%;border-radius:6px;margin-top:8px" />` : ''}
          </div>`, { maxWidth: 240 });
        markersRef.current.push(m);
      });

      // If we have lots with data and user denied location, fit the map to the markers
      if (!userLatLng && markersRef.current.length > 0) {
        const group = L.featureGroup(markersRef.current);
        map.fitBounds(group.getBounds().pad(0.5));
      }
    })();
  }, [occ, calibs, userLatLng]);

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div ref={mapDiv} style={{ width: '100%', height: '100%' }} />
      {/* status chip */}
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
        background: 'rgba(13,27,42,.82)', color: '#fff', borderRadius: 20, padding: '6px 16px',
        fontSize: 12, fontWeight: 600, backdropFilter: 'blur(6px)', pointerEvents: 'none' }}>
        {status}
      </div>
    </div>
  );
}
