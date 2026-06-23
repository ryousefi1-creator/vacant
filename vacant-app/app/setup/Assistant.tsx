'use client';
import { useEffect, useRef, useState } from 'react';

const GREEN = '#10b981';
const DARK  = '#0d1b2a';

export type AssistantContext = {
  step: number;
  stepName: string;
  lotId: string | null;
  lotName: string | null;
  cameraBrand: string | null;
  connected: boolean;
  count: number | null;
};

type Msg = { role: 'user' | 'assistant'; content: string };

// Per-step opening line + one-tap suggestions, so the assistant is useful the
// instant it opens — no typing required to get unstuck.
function greetingFor(ctx: AssistantContext): string {
  switch (ctx.step) {
    case 0: return "Hi! I'm your Parking Lot Manager 👋 I'll walk you through getting your lot online. First we'll give it a name. Stuck on anything? Just ask.";
    case 1: return "Pick the brand of camera you're using, or choose **Phone** to stream from your phone. Not sure which to pick? Ask me.";
    case 2: return ctx.cameraBrand
      ? `Let's connect your ${ctx.cameraBrand}. Enter its IP and login, or ask me how to find them.`
      : "Let's connect your camera. Tell me what you have and I'll give you the exact steps.";
    case 3: return "This step sets up a public web link with Cloudflare and starts the AI worker (push.py). Want me to explain each command?";
    case 4: return ctx.connected
      ? "Your stream is live and I can see vehicles — nice! Ask me anything before you map the layout."
      : "Waiting for the stream. If push.py is showing an error, paste it here and I'll tell you exactly what to fix.";
    case 5: return "Time to map your lot. Drag a road onto the image and stalls auto-fill. Ask me if anything's unclear.";
    default: return "You're all set 🎉 Ask me anything about running or expanding your setup.";
  }
}

function suggestionsFor(ctx: AssistantContext): string[] {
  const base: string[] = [];
  switch (ctx.step) {
    case 0: base.push('What do I need before I start?'); break;
    case 1: base.push("What if I don't have a camera?"); break;
    case 2: base.push("How do I find my camera's IP address?"); break;
    case 3: base.push('What is Cloudflare for?', 'How do I start push.py?'); break;
    case 4: base.push("push.py says it can't open the stream"); break;
    case 5: base.push('How does stall mapping work?'); break;
  }
  base.push("I got \"No module named cv2\"");
  return base.slice(0, 3);
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }) {
  const me = role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: me ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '85%', padding: '10px 13px', borderRadius: 14,
        background: me ? DARK : '#f1f5f4', color: me ? '#fff' : DARK,
        fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        borderBottomRightRadius: me ? 4 : 14, borderBottomLeftRadius: me ? 14 : 4,
      }}>
        {children}
      </div>
    </div>
  );
}

// Minimal, dependency-free Markdown: fenced code blocks, inline `code`, **bold**.
function Markdown({ text }: { text: string }) {
  const parts = text.split(/```/);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const code = part.replace(/^[a-zA-Z]*\n/, '');  // strip a leading language hint
          return (
            <pre key={i} style={{
              background: '#0d1b2a', color: '#d1fae5', padding: '10px 12px', borderRadius: 9,
              fontSize: 12, fontFamily: 'monospace', overflowX: 'auto', margin: '7px 0', whiteSpace: 'pre',
            }}>{code.replace(/\n$/, '')}</pre>
          );
        }
        return <span key={i}>{inline(part)}</span>;
      })}
    </>
  );
}

function inline(text: string): React.ReactNode[] {
  // split on **bold** and `code`, preserving delimiters
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((t, i) => {
    if (t.startsWith('**') && t.endsWith('**')) return <b key={i}>{t.slice(2, -2)}</b>;
    if (t.startsWith('`') && t.endsWith('`')) return (
      <code key={i} style={{ background: '#e3eae8', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', fontSize: 12 }}>
        {t.slice(1, -1)}
      </code>
    );
    return <span key={i}>{t}</span>;
  });
}

export default function Assistant({ ctx }: { ctx: AssistantContext }) {
  const [open, setOpen]       = useState(false);
  const [msgs, setMsgs]       = useState<Msg[]>([]);
  const [input, setInput]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const greeting    = greetingFor(ctx);
  const suggestions = suggestionsFor(ctx);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, busy, open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setErr(null);
    setInput('');
    const next: Msg[] = [...msgs, { role: 'user', content: q }];
    setMsgs([...next, { role: 'assistant', content: '' }]);
    setBusy(true);
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, context: ctx }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: 'Something went wrong.' }));
        setErr(j.error || 'Something went wrong.');
        setMsgs(next);  // drop the empty assistant bubble
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs([...next, { role: 'assistant', content: acc }]);
      }
      if (!acc) setMsgs([...next, { role: 'assistant', content: '(no response)' }]);
    } catch {
      setErr('Lost connection to the assistant.');
      setMsgs(next);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open setup assistant"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 9, padding: '13px 18px',
          border: 'none', borderRadius: 999, cursor: 'pointer',
          background: 'linear-gradient(160deg,#10b981,#059669)', color: '#fff',
          fontSize: 14.5, fontWeight: 700, fontFamily: 'inherit',
          boxShadow: '0 8px 28px rgba(16,185,129,.42)',
        }}>
        <span style={{ fontSize: 18 }}>💬</span> Need help?
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 50, width: 380, maxWidth: 'calc(100vw - 32px)',
      height: 560, maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column',
      background: '#fff', borderRadius: 20, border: '1px solid #e7ecf0',
      boxShadow: '0 18px 60px rgba(13,27,42,.28)', overflow: 'hidden', fontFamily: 'inherit',
    }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
        background: 'linear-gradient(135deg,#0d1b2a,#1a2e3d)', color: '#fff',
      }}>
        <div style={{ fontSize: 26 }}>🅿️</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Parking Lot Manager</div>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)' }}>
            Step {Math.min(ctx.step + 1, 7)} of 7 · {ctx.stepName}
          </div>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close"
          style={{ border: 'none', background: 'rgba(255,255,255,.12)', color: '#fff',
            width: 28, height: 28, borderRadius: 8, cursor: 'pointer', fontSize: 15 }}>
          ✕
        </button>
      </div>

      {/* messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Bubble role="assistant"><Markdown text={greeting} /></Bubble>
        {msgs.map((m, i) => (
          <Bubble key={i} role={m.role}>
            {m.content ? <Markdown text={m.content} />
              : <span style={{ color: '#9aa6b2' }}>…</span>}
          </Bubble>
        ))}
        {err && (
          <div style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 10, padding: '9px 12px', fontSize: 12.5, lineHeight: 1.5 }}>
            {err}
          </div>
        )}

        {msgs.length === 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 4 }}>
            {suggestions.map(s => (
              <button key={s} onClick={() => send(s)}
                style={{ border: '1px solid #cfe9df', background: '#f0fdf8', color: '#047857',
                  borderRadius: 999, padding: '7px 12px', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* input */}
      <div style={{ borderTop: '1px solid #eef2f1', padding: 12, display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(input); }}
          placeholder={busy ? 'Thinking…' : 'Ask about your setup…'}
          disabled={busy}
          style={{ flex: 1, border: '2px solid #e1e7ec', borderRadius: 11, padding: '10px 13px',
            fontSize: 14, outline: 'none', color: DARK, fontFamily: 'inherit', background: busy ? '#f7f9fb' : '#fff' }}
        />
        <button
          onClick={() => send(input)}
          disabled={busy || !input.trim()}
          style={{ border: 'none', borderRadius: 11, padding: '0 16px', fontSize: 14, fontWeight: 700,
            cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
            background: busy || !input.trim() ? '#a7f3d0' : GREEN, color: '#fff', fontFamily: 'inherit' }}>
          ➤
        </button>
      </div>
    </div>
  );
}
