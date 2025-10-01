/**
 * HTOS Grok Provider Adapter  –  SERVICE-WORKER SAFE
 */
import { classifyProviderError } from "../core/request-lifecycle-manager.js";

export class GrokAdapter {
  constructor(controller) {
    this.id = "grok";
    this.capabilities = {
      needsDNR: false,
      needsOffscreen: false,
      supportsStreaming: true,
      supportsContinuation: true,
      synthesis: false,
    };
    this.controller = controller;
  }

  async init() {
    /* no-op */
  }

  async healthCheck() {
    try {
      const cookie = await chrome.cookies.get({
        url: "https://x.com",
        name: "ct0",
      });
      return !!cookie?.value;
    } catch {
      return false;
    }
  }

  async sendPrompt(req, onChunk, signal) {
    const start = Date.now();
    try {
      const result = await this.controller.grokSession.ask(
        req.originalPrompt,
        { signal, model: req.meta?.model, chatId: req.meta?.conversationId },
        (chunk) => onChunk({ ...chunk, partial: true })
      );
      return {
        providerId: this.id,
        ok: true,
        id: result.responseId || null,
        text: result.text || "",
        partial: false,
        latencyMs: Date.now() - start,
        meta: { conversationId: result.conversationId, responseId: result.responseId || null },
      };
    } catch (e) {
      const cls = classifyProviderError("grok-session", e);
      return {
        providerId: this.id,
        ok: false,
        text: null,
        errorCode: cls.type || "unknown",
        latencyMs: Date.now() - start,
        meta: { error: e.message, details: e.details, suppressed: cls.suppressed }
      };
    }
  }

  async sendContinuation(prompt, providerContext, sessionId, onChunk, signal) {
    // Grok uses the same endpoint for continuation – just re-use sendPrompt
    return this.sendPrompt(
      { originalPrompt: prompt, sessionId, meta: providerContext },
      onChunk,
      signal
    );
  }
}
