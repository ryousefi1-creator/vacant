"""
Shared Claude-vision car-counter (used by the live worker push.py AND the audit loop
vision_audit.py). Kept dependency-free (no import of push) so the worker can import it
without a cycle. Counts cars in a single frame via the Anthropic Messages API.
"""
import base64
import json
import os
import re
import urllib.request

API = 'https://api.anthropic.com/v1/messages'
PROMPT = (
    "You are auditing an automated parking-lot car counter. Count the DISTINCT PARKED "
    "vehicles (cars, vans, SUVs, pickups) clearly in this parking lot. Count each physical "
    "vehicle exactly once, even if partly occluded or cut off by the frame edge. Do NOT count "
    "vehicles driving on roads far in the background. Reply with ONLY one integer."
)


def load_key():
    k = os.environ.get('ANTHROPIC_API_KEY')
    if k:
        return k
    p = os.path.expanduser('~/marketing/htk-v2/.env')
    if os.path.exists(p):
        for line in open(p):
            if line.startswith('ANTHROPIC_API_KEY'):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('no ANTHROPIC_API_KEY (set env or ~/marketing/htk-v2/.env)')


def claude_count(key, frame_jpg, model='claude-sonnet-4-6', timeout=45):
    """Return Claude's independent count of parked cars in a JPEG frame (or None)."""
    body = json.dumps({
        'model': model, 'max_tokens': 16,
        'messages': [{'role': 'user', 'content': [
            {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg',
                                         'data': base64.b64encode(frame_jpg).decode()}},
            {'type': 'text', 'text': PROMPT},
        ]}],
    }).encode()
    req = urllib.request.Request(API, data=body, method='POST', headers={
        'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=timeout))
    m = re.search(r'\d+', r['content'][0]['text'])
    return int(m.group()) if m else None
