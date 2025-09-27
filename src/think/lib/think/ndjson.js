// NDJSON utilities: serialize single object and a streaming parser that handles partial chunks
export function ndjsonSerialize(obj) {
  return JSON.stringify(obj) + "\n";
}

export function createNdjsonParser(onParsedLine) {
  let buf = "";
  const decoder = new TextDecoder();
  return {
    push: chunk => {
      try {
        const str = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        buf += str;
        const lines = buf.split(/\r?\n/);
        // keep last partial line in buffer
        buf = lines.pop();
        for (const l of lines) {
          if (!l.trim()) continue;
          try {
            const parsed = JSON.parse(l);
            onParsedLine(parsed);
          } catch (e) {
            // ignore single-line parse errors — caller could log
          }
        }
      } catch (e) {
        // swallow
      }
    },
    flush: () => {
      if (buf.trim()) {
        try {
          const parsed = JSON.parse(buf);
          onParsedLine(parsed);
        } catch (e) {}
      }
      buf = "";
    }
  };
}
