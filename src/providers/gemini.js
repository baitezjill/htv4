/**
 * HTOS Gemini Provider Implementation
 *
 * This adapter module provides Gemini AI integration following HTOS patterns.
 * Handles Gemini session-based authentication using browser cookies.
 *
 * Build-phase safe: emitted to dist/adapters/*
 */
import { BusController } from "../core/vendor-exports.js";
// =============================================================================
// GEMINI MODELS CONFIGURATION
// =============================================================================
export const GeminiModels = {
  gemini: {
    id: "gemini",
    name: "Gemini",
    description: "Google's advanced AI model",
    maxTokens: 9999,
  },
};
// =============================================================================
// GEMINI ERROR TYPES
// =============================================================================
export class GeminiProviderError extends Error {
  constructor(type, details) {
    super(type);
    this.name = "GeminiProviderError";
    this.type = type;
    this.details = details;
  }
  get is() {
    return {
      login: this.type === "login",
      badToken: this.type === "badToken",
      failedToExtractToken: this.type === "failedToExtractToken",
      failedToReadResponse: this.type === "failedToReadResponse",
      noGeminiAccess: this.type === "noGeminiAccess",
      aborted: this.type === "aborted",
      network: this.type === "network",
      unknown: this.type === "unknown",
    };
  }
}
// =============================================================================
// GEMINI SESSION API
// =============================================================================
export class GeminiSessionApi {
  constructor({ sharedState, utils, fetchImpl = fetch } = {}) {
    this._logs = true;
    this.sharedState = sharedState;
    this.utils = utils;
    this.fetch = fetchImpl;
    // Bind and wrap methods for error handling
    this.ask = this._wrapMethod(this.ask);
  }
  isOwnError(e) {
    return e instanceof GeminiProviderError;
  }
  /**
   * Send prompt to Gemini AI and handle response
   */
  async ask(
    prompt,
    { token = null, cursor = ["", "", ""], signal } = {},
    retrying = false
  ) {
    token || (token = await this._fetchToken());
    const reqId = Math.floor(Math.random() * 900000) + 100000;
    const url =
      "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
    // Do not truncate the prompt here — send the full prompt to the provider and let the provider/orchestrator manage any necessary truncation.
    const body = new URLSearchParams({
      at: token.at,
      "f.req": JSON.stringify([null, JSON.stringify([[prompt], null, cursor])]),
    });
    const response = await this._fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      signal,
      query: {
        bl: token.bl,
        rt: "c",
        _reqid: reqId,
      },
      body,
    });
    const retry = async (msg = "") => {
      if (retrying) {
        this._throw("badToken", msg);
      }
      return this.ask(prompt, { token: null, cursor, signal }, true);
    };
    if (response.status !== 200) {
      const responseText =
        (await this.utils?.noThrow?.(() => response.text(), null)) ||
        (await response.text());
      if (response.status === 400) {
        return retry(responseText);
      }
      this._throw("unknown", responseText);
    }
    let parsedLines = [];
    let c, u, p;
    try {
      // Gemini returns an XSSI prefix like ")]}'" followed by multiple JSON lines.
      const raw = await response.text();
      const cleaned = raw.replace(/^\)\]\}'\s*\n?/, "").trim();
      const jsonLines = cleaned
        .split("\n")
        .filter((line) => line.trim().startsWith("["));
      if (jsonLines.length === 0) throw new Error("No JSON lines detected in response");
      // Parse all JSON lines (robust to multi-line responses)
      parsedLines = jsonLines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);
    } catch (e) {
      this._throw("failedToReadResponse", { step: "data", error: e });
    }

    // Check error code on FIRST parsed line only (before payload extraction)
    try {
      c = parsedLines[0]?.[0]?.[5]?.[0] ?? null;
    } catch (e) {
      this._throw("failedToReadResponse", { step: "errorCode", error: e });
    }

    if (c === 9) {
      // Treat code 9 as access issue
      this._throw("noGeminiAccess");
    }
    if (c === 7) {
      // Bad token or session mismatch — refresh token for retry
      return retry();
    }

    // Extract payload from parsed lines (only reached if code !== 9 and code !== 7)
    try {
      for (const L of parsedLines) {
        const found = L.find((entry) => {
          try {
            // Defensive: only parse if entry[2] is a string
            const raw = entry[2];
            if (typeof raw !== 'string') {
              return false;
            }
            
            let t;
            try {
              t = JSON.parse(raw);
            } catch (parseErr) {
              // Skip malformed JSON entries silently
              p = parseErr;
              return false;
            }

            const text = t[0]?.[0] || t[4]?.[0]?.[1]?.[0] || "";
            const baseCursor = Array.isArray(t?.[1]) ? t[1] : [];
            const tail = (t && t[4] && Array.isArray(t[4]) && t[4][0] != null) ? t[4][0][0] : undefined;
            const cursor = (tail !== undefined) ? [...baseCursor, tail] : baseCursor;
            
            // Accept payload even with empty text (critical for first-attempt responses)
            u = { text, cursor };
            return true;
          } catch (err) {
            p = err;
            return false;
          }
        });
        if (found) break;
      }
    } catch (e) {
      p = e;
    }

    if (!u) {
      this._throw("failedToReadResponse", { step: "answer", error: p });
    }

    return {
      text: u.text,
      cursor: u.cursor,
      token,
    };
  }
  /**
   * Get maximum tokens for the current model
   */
  get _maxTokens() {
    return (
      this.sharedState?.ai?.connections?.get?.("gemini-session")
        ?.modelMaxTokens || 4096
    );
  }
  /**
   * Fetch authentication token from Gemini
   */
  async _fetchToken() {
    const response = await this._fetch("/faq");
    const t = await response.text();
    let n;
    if (!t.includes("$authuser")) {
      this._throw("login");
    }
    try {
      n = {
        at: this._extractKeyValue(t, "SNlM0e"),
        bl: this._extractKeyValue(t, "cfb2h"),
      };
    } catch (e) {
      this._throw("failedToExtractToken", e);
    }
    return n;
  }
  /**
   * Extract key-value pairs from response text
   */
  _extractKeyValue(str, key) {
    return str.split(key)[1].split('":"')[1].split('"')[0];
  }
  /**
   * Make authenticated fetch request to Gemini
   */
  async _fetch(path, options = {}) {
    // Handles both GET and POST with query params
    let url = `https://gemini.google.com${path}`;
    if (options.query) {
      const params = new URLSearchParams(options.query).toString();
      url += (url.includes("?") ? "&" : "?") + params;
      delete options.query;
    }
    options.credentials = "include";
    return await this.fetch(url, options);
  }
  /**
   * Wrap methods with error handling
   */
  _wrapMethod(fn) {
    return async (...args) => {
      try {
        return await fn.call(this, ...args);
      } catch (e) {
        let err;
        if (this.isOwnError(e)) err = e;
        else if (String(e) === "TypeError: Failed to fetch")
          err = this._createError("network", e.message);
        else if (String(e) === "AbortError: The user aborted a request.")
          err = this._createError("aborted", e.message);
        else err = this._createError("unknown", e.message);
        if (err.details) this._logError(err.message, err.details);
        else this._logError(err.message);
        throw err;
      }
    };
  }
  _throw(type, details) {
    throw this._createError(type, details);
  }
  _createError(type, details) {
    return new GeminiProviderError(type, details);
  }
  _logError(...args) {
    if (this._logs) {
      console.error("GeminiSessionApi:", ...args);
    }
  }
}
// =============================================================================
// GEMINI PROVIDER CONTROLLER
// =============================================================================
export class GeminiProviderController {
  constructor(dependencies = {}) {
    this.initialized = false;
    this.api = new GeminiSessionApi(dependencies);
  }
  async init() {
    if (this.initialized) return;
    // Register with BusController for cross-context communication
    if (typeof BusController !== "undefined") {
      BusController.on(
        "gemini-provider.ask",
        this._handleAskRequest.bind(this)
      );
      BusController.on(
        "gemini-provider.fetchToken",
        this._handleFetchTokenRequest.bind(this)
      );
    }
    this.initialized = true;
  }
  async _handleAskRequest(payload) {
    return await this.api.ask(
      payload.prompt,
      payload.options || {},
      payload.retrying || false
    );
  }
  async _handleFetchTokenRequest() {
    return await this.api._fetchToken();
  }
  /**
   * Expose Gemini API instance for direct usage
   */
  get geminiSession() {
    return this.api;
  }
  isOwnError(e) {
    return this.api.isOwnError(e);
  }
}
// =============================================================================
// MODULE EXPORTS
// =============================================================================
export default GeminiProviderController;
// Build-phase safe: CommonJS compatibility
// Build-phase safe: Browser global compatibility
if (typeof window !== "undefined") {
  window.HTOS = window.HTOS || {};
  window.HTOS.GeminiProvider = GeminiProviderController;
}
