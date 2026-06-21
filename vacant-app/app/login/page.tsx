'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';

const GREEN = '#10b981';
const DARK  = '#0d1b2a';
const FONT  = 'var(--font-geist-sans), system-ui, sans-serif';

function LoginForm() {
  const router      = useRouter();
  const params      = useSearchParams();
  const nextPath    = params.get('next') ?? '/manage';
  const initError   = params.get('error');

  const [mode,     setMode]     = useState<'signin' | 'signup'>('signin');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(
    initError === 'auth_callback_failed' ? 'Email confirmation failed — try signing in again.' : null,
  );
  const [message,  setMessage]  = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();

    if (mode === 'signin') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) { setError(err.message); setLoading(false); return; }
      router.push(nextPath);
      router.refresh();
    } else {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (err) { setError(err.message); setLoading(false); return; }
      setMessage('Check your email for a confirmation link, then sign in.');
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(900px 600px at 60% 0%, rgba(16,185,129,.14), transparent 60%), #eef3f1',
      fontFamily: FONT, padding: 20 }}>

      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontWeight: 900, fontSize: 32, color: DARK, letterSpacing: '-1px' }}>
            Vac<span style={{ color: GREEN }}>ant</span>
          </div>
          <div style={{ fontSize: 13.5, color: '#6b7a8d', marginTop: 6 }}>
            Live parking occupancy dashboard
          </div>
        </div>

        {/* card */}
        <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #e7ecf0',
          padding: '32px 30px', boxShadow: '0 8px 40px rgba(13,27,42,.10)' }}>

          {/* mode toggle */}
          <div style={{ display: 'flex', background: '#f0f4f6', borderRadius: 11, padding: 4, marginBottom: 26 }}>
            {(['signin', 'signup'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(null); setMessage(null); }} style={{
                flex: 1, border: 'none', borderRadius: 8, padding: '9px', fontSize: 13.5, fontWeight: 700,
                cursor: 'pointer', transition: 'all .15s',
                background: mode === m ? '#fff' : 'transparent',
                color: mode === m ? DARK : '#9aa6b2',
                boxShadow: mode === m ? '0 2px 8px rgba(13,27,42,.10)' : 'none',
              }}>
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* email */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: '#9aa6b2',
                textTransform: 'uppercase', letterSpacing: '1px' }}>
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{ border: '2px solid #e1e7ec', borderRadius: 11, padding: '11px 14px',
                  fontSize: 15, outline: 'none', color: DARK, fontFamily: 'inherit',
                  transition: 'border-color .15s' }}
                onFocus={e => (e.target.style.borderColor = GREEN)}
                onBlur={e  => (e.target.style.borderColor = '#e1e7ec')}
              />
            </div>

            {/* password */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: '#9aa6b2',
                textTransform: 'uppercase', letterSpacing: '1px' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                  minLength={mode === 'signup' ? 6 : undefined}
                  style={{ border: '2px solid #e1e7ec', borderRadius: 11, padding: '11px 44px 11px 14px',
                    fontSize: 15, outline: 'none', color: DARK, width: '100%',
                    boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color .15s' }}
                  onFocus={e => (e.target.style.borderColor = GREEN)}
                  onBlur={e  => (e.target.style.borderColor = '#e1e7ec')}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    border: 'none', background: 'none', cursor: 'pointer', color: '#9aa6b2', fontSize: 14 }}>
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {/* error */}
            {error && (
              <div style={{ background: '#fff5f5', border: '1px solid #fecaca', borderRadius: 9,
                padding: '10px 14px', fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
                {error}
              </div>
            )}

            {/* success message */}
            {message && (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 9,
                padding: '10px 14px', fontSize: 13, color: '#065f46', fontWeight: 600 }}>
                {message}
              </div>
            )}

            {/* submit */}
            <button
              type="submit"
              disabled={loading}
              style={{ border: 'none', borderRadius: 12, padding: '13px', fontSize: 15, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                background: loading ? '#a7f3d0' : 'linear-gradient(160deg,#10b981,#059669)',
                color: '#fff', boxShadow: loading ? 'none' : '0 4px 16px rgba(16,185,129,.3)',
                transition: 'all .15s', marginTop: 2 }}>
              {loading
                ? (mode === 'signin' ? 'Signing in…' : 'Creating account…')
                : (mode === 'signin' ? 'Sign in →' : 'Create account →')}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12.5, color: '#9aa6b2' }}>
          Vacant — Parking Lot Intelligence
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#eef3f1', fontFamily: 'system-ui', fontSize: 14, color: '#6b7a8d' }}>
        Loading…
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
