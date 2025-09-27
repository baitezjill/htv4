/**
 * HTOS Claude Provider Implementation
 *
 * This adapter module provides Claude AI integration following HTOS patterns.
 * Handles Claude.ai session-based authentication using browser cookies.
 *
 * Build-phase safe: emitted to dist/adapters/*
 */
import { BusController } from '../core/vendor-exports.js';
// =============================================================================
// CLAUDE MODELS CONFIGURATION
// =============================================================================
export const ClaudeModels = {
    auto: {
        id: "auto",
        name: "Auto",
        description: "Use the latest available model",
        maxTokens: 190000
    },
    "claude-sonnet-4-20250514-claude-ai": {
        id: "claude-sonnet-4-20250514-claude-ai",
        name: "Claude 4 Sonnet",
        description: "Smart, efficient model for everyday use",
        maxTokens: 190000
    },
    "claude-opus-4-20250514-claude-ai-pro": {
        id: "claude-opus-4-20250514-claude-ai-pro",
        name: "Claude 4 Opus",
        description: "Powerful, large model for complex challenges",
        maxTokens: 190000
    },
    "claude-3-7-sonnet-20250219": {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Smart, efficient model for everyday use",
        maxTokens: 190000
    },
    "claude-3-5-haiku-20241022": {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        description: "Fastest model for daily tasks",
        maxTokens: 190000
    }
};
// =============================================================================
// CLAUDE ERROR TYPES
// =============================================================================
export class ClaudeProviderError extends Error {
    constructor(type, details) {
        super(type);
        this.name = 'ClaudeProviderError';
        this.type = type;
        this.details = details;
    }
    get is() {
        return {
            login: this.type === 'login',
            tooManyRequests: this.type === 'tooManyRequests',
            failedToReadResponse: this.type === 'failedToReadResponse',
            freeLimitExceeded: this.type === 'freeLimitExceeded',
            badOrgId: this.type === 'badOrgId',
            badModel: this.type === 'badModel',
            aborted: this.type === 'aborted',
            network: this.type === 'network',
            unknown: this.type === 'unknown'
        };
    }
}
// =============================================================================
// CLAUDE SESSION API
// =============================================================================
export class ClaudeSessionApi {
    constructor({ sharedState, utils, fetchImpl = fetch } = {}) {
        this._logs = true;
        this.sharedState = sharedState;
        this.utils = utils;
        this.fetch = fetchImpl;
        this._orgId = undefined; // lazy-cached orgId, avoid fetching during construction
        // Bind and wrap methods for error handling
        this.ask = this._wrapMethod(this.ask);
    }
    isOwnError(e) {
        return e instanceof ClaudeProviderError;
    }
    /**
     * Fetch organization ID for the authenticated user
     */
    async fetchOrgId() {
        const apiPath = "/api/organizations";
        const response = await this._fetchAuth(apiPath);
        let data = await response.json();
        // Handle array response - sort by chat capability
        if (Array.isArray(data)) {
            data = data.sort((a, b) => (a?.capabilities || []).includes("chat") ? -1 :
                (b?.capabilities || []).includes("chat") ? 1 : 0);
            data = data[0];
        }
        // Cache orgId so subsequent calls are fast and avoid race on registry readiness
        this._orgId = data?.uuid || undefined;
        return this._orgId;
    }
    /**
     * Set chat conversation title
     */
    async setChatTitle(chatId, title, orgId) {
        if (!orgId) {
            // lazy fetch using cached value if available
            if (!this._orgId) this._orgId = await this.fetchOrgId();
            orgId = this._orgId;
        }
        if (!orgId) {
            this._throw('badOrgId');
        }
        await this._fetchAuth(`/api/organizations/${orgId}/chat_conversations/${chatId}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: title.replace(/\xA0\xA0/g, " ") })
        });
    }
    /**
     * Delete chat conversation
     */
    async deleteChat(chatId, orgId) {
        if (!orgId) {
            if (!this._orgId) this._orgId = await this.fetchOrgId();
            orgId = this._orgId;
        }
        if (!orgId) {
            this._throw('badOrgId');
        }
        await this._fetchAuth(`/api/organizations/${orgId}/chat_conversations/${chatId}`, {
            method: "DELETE",
            body: chatId
        });
    }
    /**
     * Send prompt to Claude AI and handle streaming response
     */
    async ask(prompt, options = {}, onChunk = () => { }) {
        let { orgId, chatId, signal, emoji } = options;
        // Get or create org ID (lazy, cached)
        if (!orgId) {
            if (!this._orgId) this._orgId = await this.fetchOrgId();
            orgId = this._orgId;
        }
        if (!orgId) {
            this._throw('badOrgId');
        }
        // Create chat if needed
        chatId || (chatId = await this._createChat(orgId, emoji));
        // Handle large prompts by using attachments
        let attachments = [];
        let text = prompt;
        if (prompt.length > 5000) {
            attachments.push({
                extracted_content: prompt,
                file_name: "paste.txt",
                file_size: prompt.length,
                file_type: "txt"
            });
            text = "";
        }
        const url = `/api/organizations/${orgId}/chat_conversations/${chatId}/completion`;
        const payload = {
            method: "POST",
            headers: {
                Accept: "text/event-stream, text/event-stream",
                "Content-Type": "application/json",
                Origin: "https://claude.ai",
                Referer: `https://claude.ai/${chatId}`
            },
            body: JSON.stringify({
                attachments,
                files: [],
                prompt: text,
                model: this._model === "auto" ? undefined : this._model,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            }),
            signal
        };
        const response = await this._fetchAuth(url, payload);
        // Handle HTTP errors
        if (response.status !== 200) {
            let parsedJson = null;
            try {
                parsedJson = await response.json();
            }
            catch { }
            const code = parsedJson?.error?.code;
            if (code === "too_many_completions")
                this._throw("tooManyRequests", parsedJson);
            if (code === "model_not_allowed")
                this._throw("badModel", parsedJson);
            if (response.status === 429)
                this._throw("tooManyRequests", parsedJson);
            this._throw("unknown", parsedJson);
        }
        // Process streaming response
        let fullText = "";
        let isFirstChunk = true;
        const reader = response.body.getReader();
        const carry = { carryOver: "" };
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                const chunkText = this._parseChunk(value, carry);
                if (chunkText) {
                    fullText = (fullText + chunkText).trimStart();
                    onChunk({ text: fullText, chatId, orgId }, isFirstChunk);
                    isFirstChunk = false;
                }
            }
        }
        finally {
            reader.releaseLock();
        }
        return { orgId, chatId, text: fullText };
    }
    /**
     * Update available models for the provider
     */
    updateModels() {
        if (!this.sharedState?.ai?.connections?.get) {
            return;
        }
        const connection = this.sharedState.ai.connections.get("claude-session");
        if (!connection) {
            return;
        }
        const currentModel = this._model;
        const modelList = Object.values(ClaudeModels).map(model => ({
            id: model.id,
            name: model.name,
            description: model.description,
            maxTokens: model.maxTokens
        }));
        connection.options = modelList;
        connection.selectedOption = modelList.find(model => model.id === currentModel) || modelList[0];
        connection.maxTokens = connection.selectedOption?.maxTokens || null;
    }
    // =============================================================================
    // PRIVATE METHODS
    // =============================================================================
    _parseChunk(chunk, carry) {
        const lines = new TextDecoder()
            .decode(chunk)
            .trim()
            .split("\n")
            .filter(line => line.trim().length > 0 && !line.startsWith("event:"));
        return lines.map((line, idx) => {
            let parsedData;
            let result = "";
            if (idx === 0 && carry.carryOver) {
                result = carry.carryOver;
                carry.carryOver = "";
            }
            const dataString = result + line.replace("data: ", "");
            try {
                parsedData = JSON.parse(dataString);
            }
            catch (err) {
                carry.carryOver = dataString;
                return "";
            }
            if (parsedData.type === "error") {
                this._throw("failedToReadResponse", parsedData);
            }
            return parsedData.completion || "";
        }).join("");
    }
    async _createChat(orgId, emoji) {
        const chatId = this.utils?.id?.uuid?.() ||
            crypto.randomUUID?.() ||
            Math.random().toString(36).slice(2);
        const title = `${emoji || "🧬"} New Chat`;
        const response = await this._fetchAuth(`/api/organizations/${orgId}/chat_conversations`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ uuid: chatId, name: title })
        });
        if (response.status === 400 || response.status === 404) {
            this._throw("badOrgId", { orgId });
        }
        return chatId;
    }
    async _fetchAuth(url, options = {}) {
        // Use browser session cookies for authentication
        options.credentials = "include";
        if (options.body && typeof options.body !== "string") {
            options.body = JSON.stringify(options.body);
        }
        let response;
        try {
            response = await this.fetch(`https://claude.ai${url}`, options);
            if (response.status === 403) {
                let parsedJson = null;
                try {
                    parsedJson = await response.json();
                }
                catch { }
                if (parsedJson?.error?.message === "Invalid model") {
                    this._throw("badModel", parsedJson);
                }
                if (parsedJson?.error?.details?.error_code === "model_not_available") {
                    this._throw("badModel", parsedJson);
                }
                // Check org access
                const orgCheck = await this.fetch("https://claude.ai/api/organizations", {
                    credentials: "include"
                });
                if (orgCheck.status === 403) {
                    this._throw("login");
                }
                this._throw("badOrgId");
            }
        }
        catch (e) {
            if (e?.error?.code === "model_not_allowed") {
                this._throw("badModel", e.message);
            }
            else if (String(e) === "TypeError: Failed to fetch") {
                this._throw("network", e.message);
            }
            else {
                this._throw("unknown", e.message);
            }
        }
        return response;
    }
    _wrapMethod(fn) {
        return (async (...args) => {
            try {
                return await fn.call(this, ...args);
            }
            catch (e) {
                const err = this.isOwnError(e) ? e : this._createError("unknown", e.message);
                if (err.details) {
                    this._logError(err.message, err.details);
                }
                else {
                    this._logError(err.message);
                }
                throw err;
            }
        });
    }
    get _model() {
        return this.sharedState?.ai?.connections?.get?.("claude-session")?.selectedOption?.id || "auto";
    }
    _throw(type, details) {
        throw this._createError(type, details);
    }
    _createError(type, details) {
        return new ClaudeProviderError(type, details);
    }
    _logError(...args) {
        if (this._logs) {
            console.error("ClaudeProvider:", ...args);
        }
    }
}
// =============================================================================
// CLAUDE PROVIDER CONTROLLER
// =============================================================================
export class ClaudeProviderController {
    constructor(dependencies = {}) {
        this.initialized = false;
        this.api = new ClaudeSessionApi(dependencies);
    }
    async init() {
        if (this.initialized) {
            return;
        }
        console.log('[HTOSClaude] Initializing Claude provider...');
        // Register with bus controller if available
        if (typeof BusController !== 'undefined' && BusController.on) {
            BusController.on('claude.ask', this._handleAskRequest.bind(this));
            BusController.on('claude.setChatTitle', this._handleSetTitleRequest.bind(this));
            BusController.on('claude.deleteChat', this._handleDeleteChatRequest.bind(this));
            BusController.on('claude.fetchOrgId', this._handleFetchOrgIdRequest.bind(this));
            BusController.on('claude.updateModels', this._handleUpdateModelsRequest.bind(this));
        }
        // Update available models
        this.api.updateModels();
        this.initialized = true;
        console.log('[HTOSClaude] Claude provider initialized');
    }
    // =============================================================================
    // BUS EVENT HANDLERS
    // =============================================================================
    async _handleAskRequest(payload) {
        return await this.api.ask(payload.prompt, payload.options || {}, payload.onChunk || (() => { }));
    }
    async _handleSetTitleRequest(payload) {
        return await this.api.setChatTitle(payload.chatId, payload.title, payload.orgId);
    }
    async _handleDeleteChatRequest(payload) {
        return await this.api.deleteChat(payload.chatId, payload.orgId);
    }
    async _handleFetchOrgIdRequest() {
        return await this.api.fetchOrgId();
    }
    _handleUpdateModelsRequest() {
        this.api.updateModels();
    }
    // =============================================================================
    // PUBLIC API
    // =============================================================================
    get claudeSession() {
        return this.api;
    }
    isOwnError(e) {
        return this.api.isOwnError(e);
    }
}
// =============================================================================
// EXPORTS
// =============================================================================
// Default export for easy integration
export default ClaudeProviderController;

// For global browser usage
if (typeof window !== 'undefined') {
    window.HTOSClaudeProvider = ClaudeProviderController;
    window.HTOSClaudeSessionApi = ClaudeSessionApi;
    window.HTOSClaudeModels = ClaudeModels;
}
