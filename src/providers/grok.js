/**

HTOS Grok Provider Implementation – SERVICE-WORKER SAFE
No DOM globals; only chrome.* APIs
*/
import { BusController } from "../core/vendor-exports.js";
export const GrokModels = {
  auto: { id: "auto", name: "Auto", maxTokens: 128000 },
  grok2: { id: "grok-2-latest", name: "Grok-2", maxTokens: 128000 },
};

export class GrokProviderError extends Error {
  constructor(type, details) {
    super(type);
    this.name = "GrokProviderError";
    this.type = type;
    this.details = details;
  }
}

/* ---------- session API ---------- */
export class GrokSessionApi {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
    this.ask = this._wrapMethod(this.ask);
  }

  isOwnError(e) {
    return e instanceof GrokProviderError;
  }

  /* ---- public ---- */
  async ask(prompt, options = {}, onChunk = () => {}) {
    const signal = options.signal;
    const model = options.model || "grok-2-latest";
    const chatId = options.chatId; // null → new chat

    // 1. live tab cookie + fresh UUIDs via content-script bridge (connect to tab), fallback to chrome.cookies
    let csrf, txnId, reqId;
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query && chrome.tabs.connect) {
      try {
        // Find a tab matching x.com (include subdomains)
        const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://*.x.com/*'] });
        let tab = (tabs && tabs.length) ? tabs.find(t => typeof t.url === 'string' && /https:\/\/(?:.*\.)?x\.com\//.test(t.url)) : null;
        if (!tab && tabs && tabs.length) tab = tabs[0];
        if (tab && tab.id != null) {
          const csrfResp = await new Promise((res, rej) => {
            const port = chrome.tabs.connect(tab.id, { name: 'grok-csrf' });
            const to = setTimeout(() => { try { port.disconnect(); } catch(_){}; rej(new Error('csrf-bridge-timeout')); }, 3000);
            port.onMessage.addListener(function onMsg(msg) { clearTimeout(to); try { port.disconnect(); } catch(_){}; port.onMessage.removeListener(onMsg); res(msg); });
            try { port.postMessage({ type: 'grok-tokens' }); } catch (e) { clearTimeout(to); try { port.disconnect(); } catch(_){}; rej(e); }
          });
          csrf = csrfResp.csrf; txnId = csrfResp.txnId; reqId = csrfResp.reqId;
        } else {
          // no matching tab — fallback to cookie
          const cookie = await chrome.cookies.get({ url: 'https://x.com', name: 'ct0' });
          csrf = cookie?.value || '';
          txnId = self.crypto.randomUUID(); reqId = self.crypto.randomUUID();
        }
      } catch (e) {
        // bridge failed — fall back to chrome.cookies
        const cookie = await chrome.cookies.get({ url: 'https://x.com', name: 'ct0' });
        csrf = cookie?.value || '';
        txnId = self.crypto.randomUUID(); reqId = self.crypto.randomUUID();
      }
    } else {
      const cookie = await chrome.cookies.get({ url: 'https://x.com', name: 'ct0' });
      csrf = cookie?.value || '';
      txnId = self.crypto.randomUUID(); reqId = self.crypto.randomUUID();
    }
    if (!csrf) throw new GrokProviderError('login', 'Missing live ct0 cookie');

    // 2. create conversation if needed
    let conversationId = chatId;
    if (!conversationId) {
      const create = await this.fetch('https://x.com/i/api/graphql/vvC5uy7pWWHXS2aDi1FZeA/CreateGrokConversation', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf,
          'x-client-transaction-id': txnId,
          'x-twitter-auth-type': 'OAuth2Session'
        },
        body: JSON.stringify({ variables: {}, queryId: 'vvC5uy7pWWHXS2aDi1FZeA' }),
        signal
      });
      const data = await create.json();
      conversationId = data.data?.create_grok_conversation?.conversation_id;
      if (!conversationId) throw new GrokProviderError('unknown', 'No conversation_id returned');
    }

    // 3. send message
    const messageBody = {
      responses: [{ message: prompt, sender: 1, promptSource: '', fileAttachments: [] }],
      systemPromptName: '',
      grokModelOptionId: model,
      modelMode: 'MODEL_MODE_FAST',
      conversationId,
      returnSearchResults: true,
      returnCitations: true,
      promptMetadata: { promptSource: 'NATURAL', action: 'INPUT' },
      imageGenerationCount: 4,
      requestFeatures: { eagerTweets: true, serverHistory: true },
      enableSideBySide: true,
      toolOverrides: {},
      modelConfigOverride: {},
      isTemporaryChat: false
    };

    const headers = {
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'text/plain;charset=UTF-8',
      'x-csrf-token': csrf,
      'x-client-transaction-id': txnId,
      'x-xai-request-id': reqId,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session'
    };

    const resp = await this.fetch('https://grok.x.com/2/grok/add_response.json', {
      method: 'POST',
      credentials: 'include',
      headers,
      referrer: 'https://x.com/',
      body: JSON.stringify(messageBody),
      signal
    });

    if (resp.status !== 200) throw new GrokProviderError('unknown', `${resp.status} ${resp.statusText}`);

    // 4. stream SSE or fallback
    let fullText = '';
    let responseId = null;
    let modelResponse = null;

    const reader = resp.body?.getReader?.();
    const decoder = new TextDecoder();

    if (!reader) {
      // non-stream fallback: parse text for data: lines
      const txt = await resp.text();
      try {
        const lines = String(txt || '').split('\n').map(l => l.trim()).filter(l => l.startsWith('data: '));
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.slice(6));
            const text = parsed.message?.content?.parts?.[0] || '';
            if (text) fullText += text;
            responseId = parsed.responseId || responseId || parsed.response?.responseId || null;
            if (parsed.response?.modelResponse) modelResponse = parsed.response.modelResponse;
            else if (parsed.modelResponse) modelResponse = parsed.modelResponse;
          } catch(_){}
        }
      } catch(_){}
      if (fullText) onChunk({ text: fullText, chatId: conversationId, responseId });
      return { text: fullText, conversationId, responseId, meta: { modelResponse } };
    }

    // streaming reader
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        try {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') { idx = buffer.indexOf('\n'); continue; }
            try {
              const parsed = JSON.parse(data);
              const text = parsed.message?.content?.parts?.[0] || '';
              if (text) fullText += text;
              responseId = parsed.responseId || responseId || parsed.response?.responseId || responseId;
              if (parsed.response?.modelResponse) modelResponse = parsed.response.modelResponse;
              else if (parsed.modelResponse) modelResponse = parsed.modelResponse;
              if (fullText) onChunk({ text: fullText, chatId: conversationId, responseId });
            } catch(_){}
          }
        } catch(_){}
        idx = buffer.indexOf('\n');
      }
    }

    // final fallback: if modelResponse has message but fullText empty
    try { if (modelResponse?.message && !fullText) fullText = modelResponse.message; } catch (_){}

    return { text: fullText, conversationId, responseId, meta: { modelResponse } };
  }

  /* ---- private ---- */
  _wrapMethod(fn) {
    return async (...args) => {
      try {
        return await fn.call(this, ...args);
      } catch (e) {
        throw this.isOwnError(e)
          ? e
          : new GrokProviderError("unknown", e.message);
      }
    };
  }
}

/* ---------- controller ---------- */
export class GrokProviderController {
  constructor() {
    this.initialized = false;
    this.api = new GrokSessionApi();
  }

  async init() {
    if (this.initialized) return;
    // expose bus handler
    if (typeof BusController !== "undefined" && BusController.on) {
      BusController.on("grok.ask", (p) =>
        this.api.ask(p.prompt, p.options || {}, p.onChunk || (() => {}))
      );
    }
    this.initialized = true;
  }

  get grokSession() {
    return this.api;
  }
  isOwnError(e) {
    return this.api.isOwnError(e);
  }
}
