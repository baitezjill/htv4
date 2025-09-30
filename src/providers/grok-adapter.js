// src/providers/grok-adapter.js
// Adapter pattern matching Claude/Gemini, cookie-based Grok
import { classifyProviderError } from '../core/request-lifecycle-manager.js';

export class GrokAdapter {
  constructor(controller) {
    this.id = 'grok';
    this.capabilities = {
      needsDNR: false,
      needsOffscreen: false,
      supportsStreaming: true,
      supportsContinuation: true,
      synthesis: false,
    };
    this.controller = controller;
  }

  async init() { return; }

  async healthCheck() {
    try {
      return await this.controller.isAvailable();
    } catch {
      return false;
    }
  }

  async sendPrompt(req, onChunk, signal) {
    const startTime = Date.now();
    try {
      const result = await this.controller.grokSession.ask(
        req.originalPrompt,
        { signal, conversationId: req?.meta?.conversationId, parentResponseId: req?.meta?.parentResponseId },
        (chunk) => { if (this.capabilities.supportsStreaming && onChunk) onChunk({ providerId: this.id, ok: true, text: chunk?.text || '', partial: true }); }
      );

      return {
        providerId: this.id,
        ok: true,
        id: result?.responseId || null,
        text: result?.text || '',
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          conversationId: result?.conversationId || undefined,
          responseId: result?.responseId || undefined,
        }
      };
    } catch (error) {
      const classification = classifyProviderError('grok-session', error);
      const errorCode = classification.type || 'unknown';
      return {
        providerId: this.id,
        ok: false,
        text: null,
        errorCode,
        latencyMs: Date.now() - startTime,
        meta: {
          error: error?.toString?.() || String(error),
          details: error?.details,
          suppressed: classification.suppressed,
        }
      };
    }
  }

  async sendContinuation(prompt, providerContext, sessionId, onChunk, signal) {
    const startTime = Date.now();
    try {
      const result = await this.controller.grokSession.ask(
        prompt,
        { signal, conversationId: providerContext?.conversationId, parentResponseId: providerContext?.responseId },
        (chunk) => { if (this.capabilities.supportsStreaming && onChunk) onChunk({ providerId: this.id, ok: true, text: chunk?.text || '', partial: true }); }
      );

      return {
        providerId: this.id,
        ok: true,
        id: result?.responseId || null,
        text: result?.text || '',
        partial: false,
        latencyMs: Date.now() - startTime,
        meta: {
          conversationId: result?.conversationId || providerContext?.conversationId,
          responseId: result?.responseId || providerContext?.responseId,
        }
      };
    } catch (error) {
      const classification = classifyProviderError('grok-session', error);
      const errorCode = classification.type || 'unknown';
      return {
        providerId: this.id,
        ok: false,
        text: null,
        errorCode,
        latencyMs: Date.now() - startTime,
        meta: {
          error: error?.toString?.() || String(error),
          details: error?.details,
          suppressed: classification.suppressed,
          conversationId: providerContext?.conversationId,
          responseId: providerContext?.responseId,
        }
      };
    }
  }
}