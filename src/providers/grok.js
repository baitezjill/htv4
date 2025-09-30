// src/providers/grok.js
// Thin cookie-based Grok controller for the Service Worker
// - No API keys
// - No content-scripts
// - Auth via browser cookie

export class GrokProviderController {
  constructor() {
    this.id = 'grok';
    this.baseURL = 'https://grok.com/rest/app-chat';
    this.initialized = false;
    this.grokSession = {
      ask: this._ask.bind(this),
    };
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
  }

  async isAuthenticated() {
    try {
      // Prefer a stable session cookie; fall back to anon cookie
      const sso = await chrome.cookies.get({ url: 'https://grok.com', name: 'sso' });
      const anon = await chrome.cookies.get({ url: 'https://grok.com', name: 'x-anonuserid' });
      return !!(sso || anon);
    } catch (_) {
      return false;
    }
  }

  async isAvailable() {
    const ok = await this.isAuthenticated();
    if (!ok) {
      try {
        chrome.runtime.sendMessage({
          type: 'SHOW_BANNER',
          provider: 'grok',
          message: 'Please open grok.com once to log in',
        });
      } catch (_) {}
    }
    return ok;
  }

  async _ask(prompt, options = {}, onChunk = () => {}) {
    // options: { signal, conversationId, parentResponseId, isReasoning }
    const { signal, conversationId = 'new', parentResponseId = '', isReasoning = false } = options || {};

    // Ensure cookie-based auth exists
    const authed = await this.isAvailable();
    if (!authed) {
      return { text: '', model: 'grok', conversationId: null, responseId: null };
    }

    const isNew = conversationId === 'new';
    const url = isNew
      ? `${this.baseURL}/conversations/new`
      : `${this.baseURL}/conversations/${encodeURIComponent(conversationId)}/responses`;

    // Streaming NDJSON
    const payload = {
      temporary: false,
      modelName: 'grok-3',
      message: String(prompt || ''),
      fileAttachments: [],
      imageAttachments: [],
      disableSearch: false,
      enableImageGeneration: true,
      returnImageBytes: false,
      returnRawGrokInXaiRequest: false,
      enableImageStreaming: true,
      imageGenerationCount: 2,
      forceConcise: false,
      toolOverrides: {},
      enableSideBySide: false,
      sendFinalMetadata: true,
      customInstructions: '',
      deepsearchPreset: '',
      isReasoning: Boolean(isReasoning),
      ...(isNew ? {} : { parentResponseId: parentResponseId || '' }),
    };

    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        accept: '*/*',
        origin: 'https://grok.com',
        referer: 'https://grok.com/',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!resp.body) {
      // Non-streaming fallback
      const bodyText = await resp.text();
      const parsed = this._parseNdjson(bodyText);
      const full = parsed.fullMessage || '';
      if (full) onChunk({ text: full, partial: true });
      return {
        text: full,
        model: 'grok',
        conversationId: parsed.conversationId || null,
        responseId: parsed.responseId || null,
        meta: { modelResponse: parsed.modelResponse }
      };
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';
    let responseId = null;
    let conversationIdOut = conversationId === 'new' ? null : conversationId;
    let modelResponse = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        try {
          if (line.trim()) {
            const evt = JSON.parse(line);
            const r = evt?.result || {};

            if (r.conversation?.conversationId) {
              conversationIdOut = r.conversation.conversationId;
            }

            let tok;
            if (r.response?.token !== undefined) {
              tok = r.response.token;
              responseId = r.response.responseId || responseId;
            } else if (r.token !== undefined) {
              tok = r.token || '';
              responseId = r.responseId || responseId;
            }

            if (tok !== undefined) {
              fullText += tok;
              onChunk({ text: fullText, partial: true });
            }

            if (r.response?.modelResponse) {
              modelResponse = r.response.modelResponse;
              responseId = modelResponse?.responseId || responseId;
            } else if (r.modelResponse) {
              modelResponse = r.modelResponse;
              responseId = modelResponse?.responseId || responseId;
            }
          }
        } catch (_) {}
        idx = buffer.indexOf('\n');
      }
    }

    // If modelResponse has a final message but tokens were not handled
    try {
      if (modelResponse?.message && !fullText) fullText = modelResponse.message;
    } catch (_) {}

    return {
      text: fullText,
      model: 'grok',
      conversationId: conversationIdOut,
      responseId,
      meta: { modelResponse }
    };
  }

  _parseNdjson(text) {
    let fullMessage = '';
    let responseId;
    let modelResponse;
    let conversationId;
    for (const line of String(text || '').trim().split('\n')) {
      try {
        if (!line.trim()) continue;
        const evt = JSON.parse(line);
        const r = evt?.result || {};
        if (r.conversation?.conversationId) conversationId = r.conversation.conversationId;
        if (r.response?.token !== undefined) {
          fullMessage += r.response.token;
          responseId = r.response.responseId || responseId;
        } else if (r.token !== undefined) {
          fullMessage += r.token || '';
          responseId = r.responseId || responseId;
        }
        if (r.response?.modelResponse) {
          modelResponse = r.response.modelResponse;
          responseId = modelResponse?.responseId || responseId;
        } else if (r.modelResponse) {
          modelResponse = r.modelResponse;
          responseId = modelResponse?.responseId || responseId;
        }
      } catch (_) {}
    }
    return { fullMessage, responseId, modelResponse, conversationId };
  }
}