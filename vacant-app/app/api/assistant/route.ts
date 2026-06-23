// Setup Assistant — a streaming chat endpoint for the /setup "Parking Lot
// Manager". It talks to either the Anthropic Messages API or OpenRouter
// (OpenAI-compatible), auto-detected from the key prefix, with no SDK dependency
// (same direct-fetch approach as scripts/vision.py).
//
// The assistant is grounded in Vacant's real setup flow: the Python/cv2 install,
// the mediamtx RTMP receiver, cloudflared, push.py, and the per-brand camera URLs.
// It receives the user's current wizard step + lot/camera context so its answers
// are specific to where the user is stuck.
//
// Set ONE of these in vacant-app/.env.local:
//   ANTHROPIC_API_KEY=sk-ant-...      (uses api.anthropic.com)
//   OPENROUTER_API_KEY=sk-or-...      (uses openrouter.ai)
// ANTHROPIC_API_KEY may also hold an sk-or-... key; the prefix decides the route.
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

type ChatMsg = { role: 'user' | 'assistant'; content: string };
type Ctx = {
  step?: number;
  stepName?: string;
  lotId?: string | null;
  lotName?: string | null;
  cameraBrand?: string | null;
  connected?: boolean;
  count?: number | null;
};

const STEP_NAMES = [
  'Name the lot', 'Choose camera type', 'Connect camera',
  'Remote access (Cloudflare)', 'Verify stream', 'Map layout', 'Done',
];

function systemPrompt(ctx: Ctx): string {
  const where = typeof ctx.step === 'number'
    ? `The user is currently on setup step ${ctx.step + 1} of 7: "${ctx.stepName || STEP_NAMES[ctx.step] || '?'}".`
    : 'The user has not started the wizard yet.';
  const lot = ctx.lotName ? `Their lot is named "${ctx.lotName}" (id: ${ctx.lotId}).` : 'No lot created yet.';
  const cam = ctx.cameraBrand ? `Selected camera brand: ${ctx.cameraBrand}.` : 'No camera brand selected yet.';
  const stream = ctx.connected
    ? `The live stream IS connected — the AI is currently detecting ${ctx.count ?? 0} vehicle(s).`
    : 'The live stream is NOT yet connected.';

  return `You are the **Parking Lot Manager**, the built-in setup assistant for Vacant — an app that turns any camera pointed at a parking lot into a live map of open vs. taken spaces using on-device AI (YOLO) plus an optional Claude vision audit.

Your job: guide a non-technical user through setup, one concrete step at a time. Be warm, brief, and encouraging. Give exact copy-paste commands in fenced code blocks. Never assume deep technical knowledge. When something can go wrong, say what the user will see and what to do about it.

## The user's current state
${where}
${lot}
${cam}
${stream}
The user is on **macOS** (zsh). Their project folder is \`~/Desktop/vacant\`. The Python scripts live in \`scripts/\`, the web app in \`vacant-app/\`. Their Mac's LAN IP is typically shown by \`ipconfig getifaddr en0\`.

## How Vacant works end-to-end
1. A camera (or phone) streams video. IP cameras use RTSP directly. A phone uses the free **Larix Broadcaster** app to push RTMP to **mediamtx**, an RTMP receiver running on this Mac.
2. **scripts/push.py** is the AI worker. It reads each camera, detects vehicles, figures out which parking stalls are taken, and POSTs the result to the web app at http://localhost:3000.
3. The dashboard and \`/setup\` wizard show the live map.

## The 7 setup steps
1. Name the lot. 2. Choose camera type. 3. Connect camera (enter IP/credentials → RTSP URL, or pick Phone). 4. Remote access: install & run cloudflared for a public HTTPS URL. 5. Verify stream: confirm the AI sees cars. 6. Map layout in the Lot Builder (or let the AI auto-learn stalls). 7. Done.

## First-time Python setup (the user does NOT have Python deps installed)
The scripts need OpenCV, PyTorch, YOLO. Set up a virtual environment once:
\`\`\`bash
cd ~/Desktop/vacant
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
\`\`\`
After that, always run the worker with the venv active (or use \`.venv/bin/python\`).

## Commands the user needs
- Start the AI worker: \`source .venv/bin/activate && python scripts/push.py\`  (must stay running)
- Start the RTMP receiver (only needed for phone streaming): \`brew install mediamtx\` then \`mediamtx\`
- Public URL: \`brew install cloudflared\` then \`cloudflared tunnel --url http://localhost:3000\`
- Find this Mac's IP (for phone streaming): \`ipconfig getifaddr en0\`
- Test the whole pipeline WITHOUT a phone/camera by looping a still image into the RTMP stream with ffmpeg:
  \`ffmpeg -re -stream_loop -1 -i work/mylot_calib_frame.jpg -vf format=yuv420p -r 15 -c:v libx264 -f flv rtmp://localhost:1935/live/TEST_1\`

## Known errors and the exact fix (the user has hit some of these)
- **"No module named cv2"** (or numpy/torch/ultralytics): the Python dependencies aren't installed, or push.py was run with system python instead of the venv. Fix: do the venv setup above, then run \`source .venv/bin/activate\` before \`python scripts/push.py\`.
- **"OpenCV: Couldn't read video stream from file rtmp://localhost:1935/live/XXX"** / **"cannot open stream"**: push.py is trying to read a phone/RTMP stream but nothing is arriving. Either (a) mediamtx isn't running, or (b) mediamtx is running but the phone (Larix) isn't actually broadcasting yet, or (c) the lot is an IP camera and its \`url\` in \`calib/XXX.json\` should be an \`rtsp://\` URL, not the placeholder rtmp one. For a phone: start mediamtx, then press the broadcast button in Larix pointed at \`rtmp://<this-mac-ip>:1935/live/XXX\`.
- **Larix "Could not connect to server. Check stream URL and network connection."**: this is a network-reachability problem between the phone and the Mac, NOT a problem with mediamtx. Checklist: (1) the phone must be on the SAME Wi-Fi as the Mac — not cellular, not a different SSID; its IP should start with the same first three numbers as the Mac (e.g. both 10.0.1.x); (2) avoid "guest" Wi-Fi networks — they often have client isolation that blocks phone↔computer traffic; a phone hotspot both devices join also works; (3) confirm the URL is exactly rtmp://<mac-ip>:1935/live/<LOT_ID> with the right IP and lot id; (4) mediamtx must be running. To prove the Mac side works regardless of the phone, use the ffmpeg test-stream command above.
- **mediamtx "listen udp :8000: bind: address already in use"**: harmless — that's only an optional port. The RTMP server on :1935 still works.
- **Stream verifies but no cars detected**: make sure the camera actually frames the parking area; detection needs a few seconds; very dark scenes detect poorly.

## Camera RTSP URL formats (when asked)
- Hikvision: \`rtsp://user:pass@IP:554/Streaming/Channels/101\`
- Dahua / Amcrest: \`rtsp://user:pass@IP:554/cam/realmonitor?channel=1&subtype=0\`
- Axis: \`rtsp://user:pass@IP:554/axis-media/media.amp\`
- Reolink: \`rtsp://user:pass@IP:554/h264Preview_01_main\` (use _sub for faster AI)
- Uniview: \`rtsp://user:pass@IP:554/media/video1\`
- Hanwha/Samsung: \`rtsp://user:pass@IP:554/profile1/media.smp\`
- Generic/ONVIF: try \`rtsp://user:pass@IP:554/stream\`

## Style rules
- Answer the user's actual question first, in 1-3 short sentences, then the command(s).
- One step at a time. End by telling them what success looks like and offer the next step.
- If they paste an error, identify it against the list above and give the precise fix.
- Keep it friendly and confident. Use light Markdown. Don't invent commands or paths not described here.`;
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: NextRequest) {
  // Accept an Anthropic key or an OpenRouter key from either env var; the
  // sk-or- prefix means OpenRouter (OpenAI-compatible), anything else Anthropic.
  const rawKey = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  if (!rawKey) {
    return jsonError(
      'The assistant needs an API key. Add ANTHROPIC_API_KEY (sk-ant-…) or OPENROUTER_API_KEY (sk-or-…) to vacant-app/.env.local and restart the dev server.',
      503,
    );
  }
  const isOpenRouter = rawKey.startsWith('sk-or-');
  const model = process.env.VACANT_ASSISTANT_MODEL
    || (isOpenRouter ? 'anthropic/claude-3.5-sonnet' : 'claude-sonnet-4-6');

  let messages: ChatMsg[];
  let ctx: Ctx;
  try {
    const body = await request.json();
    messages = Array.isArray(body.messages) ? body.messages : [];
    ctx = (body.context && typeof body.context === 'object') ? body.context : {};
  } catch {
    return jsonError('Invalid request body.', 400);
  }

  // sanitize + cap history so a runaway client can't blow up the request
  const clean = messages
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 6000) }))
    .slice(-20);
  if (clean.length === 0 || clean[clean.length - 1].role !== 'user') {
    return jsonError('Expected a trailing user message.', 400);
  }

  const sys = systemPrompt(ctx);
  const endpoint = isOpenRouter ? OPENROUTER_URL : ANTHROPIC_URL;
  const headers: Record<string, string> = isOpenRouter
    ? { 'Authorization': `Bearer ${rawKey}`, 'content-type': 'application/json', 'X-Title': 'Vacant Setup Assistant' }
    : { 'x-api-key': rawKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const payload = isOpenRouter
    ? { model, max_tokens: 1024, stream: true, messages: [{ role: 'system', content: sys }, ...clean] }
    : { model, max_tokens: 1024, stream: true, system: sys, messages: clean };

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch {
    return jsonError(`Could not reach ${isOpenRouter ? 'OpenRouter' : 'the Anthropic API'}. Check your network connection.`, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    const envName = isOpenRouter ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY';
    const hint = upstream.status === 401
      ? `The API key was rejected — double-check ${envName} in .env.local.`
      : `Upstream API error (${upstream.status}).`;
    return jsonError(detail ? `${hint} ${detail.slice(0, 300)}` : hint, 502);
  }

  // Parse the upstream SSE stream and re-emit just the text as a plain UTF-8
  // stream — keeps the client trivial. Handles BOTH Anthropic deltas
  // (content_block_delta → delta.text) and OpenAI/OpenRouter deltas
  // (choices[0].delta.content).
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';  // holds an incomplete trailing line between pulls

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { controller.close(); return; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';  // keep the last partial line for next pull
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const evt = JSON.parse(data);
          const text =
            (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) ||
            evt.choices?.[0]?.delta?.content ||
            '';
          if (text) controller.enqueue(encoder.encode(text));
        } catch {
          // not valid JSON — skip this line
        }
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
