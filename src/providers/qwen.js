/**
 * HTOS Qwen Provider Implementation
 *
 * Handles Qwen (Tongyi) session-based authentication and API interaction.
 */

// =============================================================================
// QWEN ERROR TYPES
// =============================================================================
export class QwenProviderError extends Error {
    constructor(type, details) {
        super(type);
        this.name = 'QwenProviderError';
        this.type = type;
        this.details = details;
    }

    get is() {
        return {
            login: this.type === 'login',
            csrf: this.type === 'csrf',
            network: this.type === 'network',
            unknown: this.type === 'unknown',
        };
    }
}


// =============================================================================
// QWEN SESSION API
// =============================================================================
import { ProviderDNRGate } from '../core/dnr-utils.js';

export class QwenSessionApi {
    constructor({ fetchImpl = fetch } = {}) {
        this._logs = true;
        this.fetch = fetchImpl;
        this._csrfToken = null;
        this.ask = this._wrapMethod(this.ask);
    }

    // simple id generator for msg/request ids
    _generateId() {
        return `m${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
    }

    async _createConversation(firstQuery, csrfToken, signal) {
        // ensure DNR rules are applied so Origin/Referer headers are set
        try {
            await ProviderDNRGate.ensureProviderDnrPrereqs('qwen');
        } catch (e) {
            // non-fatal: continue but log
            console.warn('[QwenProvider] Failed to ensure DNR prereqs', e);
        }

        const resp = await this.fetch('https://qianwen.aliyun.com/addSession', {
            method: 'POST',
            signal,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-Platform': 'pc_tongyi',
                'X-Xsrf-Token': csrfToken,
            },
            body: JSON.stringify({ firstQuery, sessionType: 'text_chat' }),
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => '<no-body>');
            this._throw('unknown', `createSession failed ${resp.status}: ${text}`);
        }

        const j = await resp.json().catch(() => null);
        if (!j || !j.success || !j.data || !j.data.sessionId) {
            this._throw('unknown', `createSession unexpected response: ${JSON.stringify(j)}`);
        }
        return j.data.sessionId;
    }

    async _fetchCsrfToken() {
        if (this._csrfToken) return this._csrfToken;
        try {
            const response = await this.fetch("https://www.tongyi.com/qianwen/", { credentials: 'include' });
            const html = await response.text();
            const match = /csrfToken\s?=\s?"([^"]+)"/.exec(html);
            if (!match || !match[1]) {
                this._throw('csrf', 'Failed to extract CSRF token from page HTML.');
            }
            this._csrfToken = match[1];
            return this._csrfToken;
        } catch (e) {
            if (this.isOwnError(e)) throw e;
            this._throw('network', `Failed to fetch CSRF token: ${e.message}`);
        }
    }

    async ask(prompt, options = {}, onChunk = () => {}) {
        const { sessionId, parentMsgId, signal } = options;
        const csrfToken = await this._fetchCsrfToken();

        // ensure DNR rules headers (origin/referer) are in place for qwen endpoints
        try {
            await ProviderDNRGate.ensureProviderDnrPrereqs('qwen');
        } catch (e) {
            console.warn('[QwenProvider] ProviderDNRGate failed', e);
        }

        // Helper to perform conversation POST and return response
        const doConversationPost = async (bodyObj) => {
            const headers = {
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Content-Type': 'application/json',
                'priority': 'u=1, i',
                'X-Platform': 'pc_tongyi',
                'X-Xsrf-Token': csrfToken,
            };

            return this.fetch('https://api.tongyi.com/dialog/conversation', {
                method: 'POST',
                signal,
                credentials: 'include',
                referrer: 'https://www.tongyi.com/',
                headers,
                body: JSON.stringify(bodyObj),
            });
        };

        // First attempt: mimic the working extension's minimal request (no addSession)
        const minimalBody = {
            action: 'next',
            contents: [{ contentType: 'text', content: prompt, role: 'user' }],
            mode: 'chat',
            model: '',
            parentMsgId: parentMsgId || '',
            sessionId: sessionId || '',
            sessionType: 'text_chat',
            userAction: 'chat',
        };

        let response;
        try {
            response = await doConversationPost(minimalBody);
        } catch (e) {
            // network error - surface as network Qwen error
            this._throw('network', `Conversation POST failed: ${e.message}`);
        }

        // If server indicates not authorized / requires session (or non-200), create session then retry
        if (!response.ok) {
            const text = await response.text().catch(() => '<no-body>');
            // If server returned NOT_LOGIN or 401/403/500, try addSession then retry
            const needAddSession = /NOT_LOGIN|401|403|500/.test(text) || response.status === 401 || response.status === 403 || response.status === 500;
            if (needAddSession) {
                // create session via addSession endpoint
                let createdSessionId;
                try {
                    createdSessionId = await this._createConversation(prompt, csrfToken, signal);
                } catch (e) {
                    // bubble existing error
                    throw e;
                }

                // Build a fuller body and retry
                const fullBody = {
                    action: 'next',
                    contents: [{ contentType: 'text', content: prompt, role: 'user' }],
                    mode: 'chat',
                    model: '',
                    parentMsgId: parentMsgId || '',
                    sessionId: createdSessionId,
                    sessionType: 'text_chat',
                    userAction: 'chat',
                    requestId: this._generateId(),
                    msgId: this._generateId(),
                    params: { specifiedModel: 'tongyi-qwen3-max-model' },
                };

                try {
                    response = await doConversationPost(fullBody);
                } catch (e) {
                    this._throw('network', `Conversation retry failed: ${e.message}`);
                }

                if (!response.ok) {
                    const retryText = await response.text().catch(() => '<no-body>');
                    this._throw('unknown', `Conversation retry failed ${response.status}: ${retryText}`);
                }
            } else {
                this._throw('unknown', `Conversation failed ${response.status}: ${text}`);
            }
        }

        // At this point response.ok is true and we can parse streaming body
        let fullText = '';
        let finalSessionId = sessionId || '';
        let finalMsgId = parentMsgId || null;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let carry = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = (carry + chunk).split('\n');
                carry = lines.pop() || '';

                for (let line of lines) {
                    line = line.trim();
                    if (!line) continue;
                    if (line === '[DONE]' || line === 'data: [DONE]') {
                        break;
                    }

                    if (line.startsWith('data:')) {
                        const payload = line.slice(5).trim();
                        if (!payload) continue;
                        try {
                            const json = JSON.parse(payload);
                            if (json.errorCode === 'NOT_LOGIN') {
                                this._throw('login', 'User is not logged in to Tongyi Qianwen.');
                            }

                            // normalize possible content arrays
                            const possibleArr = json.contents || json.content || [];
                            let found;
                            if (Array.isArray(possibleArr)) {
                                found = possibleArr.find(c => c && (c.contentType === 'text' || c.type === 'text'));
                            }
                            let content = undefined;
                            if (found && typeof found === 'object') content = found.content;
                            if (!content && Array.isArray(json.content) && json.content.length > 0) content = json.content[0];

                            if (content) fullText = content;
                            if (json.sessionId) finalSessionId = json.sessionId;
                            if (json.msgId) finalMsgId = json.msgId;
                            if (fullText) onChunk({ text: fullText, sessionId: finalSessionId, parentMsgId: finalMsgId });
                        } catch (e) {
                            console.warn('[Qwen Provider] Failed to parse SSE payload:', payload, e);
                        }
                    } else {
                        // Fallback: try parse raw line as JSON
                        try {
                            const json = JSON.parse(line);
                            const contentsArr = json.contents || [];
                            const found = Array.isArray(contentsArr) ? contentsArr.find(c => c && c.contentType === 'text') : undefined;
                            const content = found ? found.content : undefined;
                            if (content) {
                                fullText = content;
                                finalMsgId = json.msgId || finalMsgId;
                                finalSessionId = json.sessionId || finalSessionId;
                                onChunk({ text: fullText, sessionId: finalSessionId, parentMsgId: finalMsgId });
                            }
                        } catch (e) {
                            // ignore non-json lines
                        }
                    }
                }
            }
        } finally {
            try { reader.releaseLock(); } catch (e) {}
        }

        return { text: fullText, sessionId: finalSessionId, parentMsgId: finalMsgId };
    }

    _wrapMethod(fn) {
        return async (...args) => {
            try {
                return await fn.call(this, ...args);
            } catch (e) {
                const err = this.isOwnError(e) ? e : this._createError('unknown', e.message);
                this._logError(err.message, err.details);
                throw err;
            }
        };
    }

    _throw(type, details) {
        throw this._createError(type, details);
    }

    _createError(type, details) {
        return new QwenProviderError(type, details);
    }

    _logError(...args) {
        if (this._logs) {
            console.error("QwenProvider:", ...args);
        }
    }
}

// =============================================================================
// QWEN PROVIDER CONTROLLER
// =============================================================================
export class QwenProviderController {
    constructor(dependencies = {}) {
        this.api = new QwenSessionApi(dependencies);
    }

    get qwenSession() {
        return this.api;
    }

    isOwnError(e) {
        return this.api.isOwnError(e);
    }
}
