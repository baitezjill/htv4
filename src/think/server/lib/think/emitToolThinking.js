import { ndjsonSerialize } from '../../../lib/think/ndjson.js';
import { O1_TOOL_NAME } from '../../../lib/think/constants.js';
import crypto from 'crypto';

// emits a single NDJSON line representing a Harpa-compatible tool message "🤔 Thinking..."
// writeFn should be a function that accepts a string (one line) and flushes it to client
export function emitToolThinking(writeFn, o1ToolName = O1_TOOL_NAME) {
  const msg = {
    type: 'message',
    message: {
      id: `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author: {
        role: 'tool',
        name: o1ToolName
      },
      content: [
        {
          type: 'output_text',
          text: '🤔 Thinking...'
        }
      ]
    }
  };
  writeFn(ndjsonSerialize(msg));
}
