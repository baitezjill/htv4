import { ndjsonSerialize } from '../../../src/lib/think/ndjson.js';
import { emitToolThinking } from './emitToolThinking.js';

// Example Express-style handler that streams NDJSON
export async function exampleAskHandler(req, res) {
  // assume body parsed
  const { messages, think } = req.body || {};
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no'); // for nginx

  // simple write helper
  const write = (s) => {
    try { res.write(s); } catch (e) {}
  };

  if (think) {
    // emit early tool thinking event
    emitToolThinking(write);
  }

  // simulate streaming assistant partials
  const assistantId = `assistant-${Date.now()}`;
  const partials = [
    { type: 'message', message: { id: assistantId, author: { role: 'assistant' }, content: [{ type: 'output_text', text: 'First partial...' }] } },
    { type: 'message', message: { id: assistantId, author: { role: 'assistant' }, content: [{ type: 'output_text', text: 'Second partial...' }] } },
  ];

  for (const p of partials) {
    write(ndjsonSerialize(p));
    // emulate delay
    await new Promise(r => setTimeout(r, 120));
  }

  // final done
  write(ndjsonSerialize({ type: 'done', result: { id: assistantId, text: 'Final assistant text' } }));
  try { res.end(); } catch (e) {}
}
