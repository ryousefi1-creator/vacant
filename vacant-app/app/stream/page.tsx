'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const HLS_URL = 'http://localhost:8888/live/mylot/index.m3u8';

export default function StreamPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'loading' | 'live' | 'offline'>('loading');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: import('hls.js').default | null = null;

    async function init() {
      const Hls = (await import('hls.js')).default;
      if (Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: true });
        hls.loadSource(HLS_URL);
        hls.attachMedia(video!);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStatus('live');
          video!.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_e: unknown, data: import('hls.js').ErrorData) => {
          if (data.fatal) setStatus('offline');
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        video.src = HLS_URL;
        video.addEventListener('loadedmetadata', () => {
          setStatus('live');
          video.play().catch(() => {});
        });
        video.addEventListener('error', () => setStatus('offline'));
      }
    }

    init();
    return () => { hls?.destroy(); };
  }, []);

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1b2a', display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
    }}>
      {/* header */}
      <header style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ color: '#6b7a8d', fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
            ← Dashboard
          </Link>
          <span style={{ color: '#2a3b4d', fontSize: 13 }}>|</span>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Live Stream</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: status === 'live' ? '#10b981' : status === 'offline' ? '#ef4444' : '#f59e0b',
            boxShadow: status === 'live' ? '0 0 8px #10b981' : 'none',
          }} />
          <span style={{ color: '#6b7a8d', fontSize: 12.5, fontWeight: 600 }}>
            {status === 'live' ? 'Live · Larix stream' : status === 'offline' ? 'Offline — start Larix to stream' : 'Connecting…'}
          </span>
        </div>
      </header>

      {/* video */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 1100, position: 'relative' }}>
          <div style={{ borderRadius: 16, overflow: 'hidden', background: '#060e17', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,.07)' }}>
            <video
              ref={videoRef}
              muted
              playsInline
              style={{ width: '100%', height: '100%', display: status === 'live' ? 'block' : 'none', objectFit: 'contain' }}
            />
            {status !== 'live' && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📷</div>
                <div style={{ color: '#6b7a8d', fontSize: 14, fontWeight: 600 }}>
                  {status === 'offline' ? 'Stream offline' : 'Connecting to stream…'}
                </div>
                <div style={{ color: '#3a4d61', fontSize: 12, marginTop: 6 }}>
                  {status === 'offline' ? 'Open Larix and tap the stream button' : HLS_URL}
                </div>
              </div>
            )}
          </div>
          <div style={{ marginTop: 12, color: '#3a4d61', fontSize: 12, textAlign: 'center' }}>
            Larix RTMP → mediamtx → HLS · {HLS_URL}
          </div>
        </div>
      </div>
    </div>
  );
}
