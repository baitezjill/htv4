import { ndjsonSerialize, createNdjsonParser } from './ndjson.js';
import { AI_THINK_FLAG } from './constants.js';

// thinkAsk: wrapper to POST to /ai/ask and stream NDJSON parsing
export async function thinkAsk({ url = '/ai/ask', messages = [], stream = true, think = false, spaceId = null, extra = {} } = {}, onChunk = () => {}, onDone = () => {}, signal = null) {
  const body = {
    messages,
    stream,
    ...(think ? { think } : {}),
    ...(spaceId ? { spaceId } : {}),
    ...extra
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => null);
    const err = new Error(`Request failed ${res.status} ${res.statusText}: ${txt}`);
    err.status = res.status;
    throw err;
  }
  if (!stream) {
    const json = await res.json();
    onChunk(json);
    onDone();
    return;
  }

  const reader = res.body.getReader();
  const parser = createNdjsonParser(onChunk);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(value);
    }
    parser.flush();
    onDone();
  } finally {
    try { reader.releaseLock(); } catch (e) {}
  }
}
