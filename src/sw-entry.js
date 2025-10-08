import {
  NetRulesManager,
  CSPController,
  UserAgentController,
  ArkoseController,
  BusController,
  LifecycleManager,
  HTOSRequestLifecycleManager,
  utils,
} from "./core/vendor-exports.js";
import { SWBootstrap } from "./HTOS/ServiceWorkerBootstrap.js";
import { ClaudeAdapter } from "./providers/claude-adapter.js";
import { GeminiAdapter } from "./providers/gemini-adapter.js";
import { ChatGPTAdapter } from "./providers/chatgpt-adapter.js";
import { QwenAdapter } from "./providers/qwen-adapter.js";
import { ClaudeProviderController } from "./providers/claude.js";
import { GeminiProviderController } from "./providers/gemini.js";
import { ChatGPTProviderController } from "./providers/chatgpt.js";
import { QwenProviderController } from "./providers/qwen.js";
import { DNRUtils } from "./core/dnr-utils.js";
import { WorkflowEngine } from "./core/workflow-engine.js"; // The new, correct engine
import { Orchestrator } from "./orchestrator/orchestrator.js"; // Legacy Orchestrator used by FaultTolerant one.

// Ensure fetch is correctly bound
try {
  if (typeof fetch === "function" && typeof globalThis !== "undefined") {
    globalThis.fetch = fetch.bind(globalThis);
  }
} catch (_) {}

// Initialize BusController globally
self.BusController = BusController;

// =============================================================================
// PERSISTENT OFFSCREEN DOCUMENT CONTROLLER
// =============================================================================
const OffscreenController = {
  _initialized: false,
  async init() {
    if (this._initialized) return;
    console.log('[SW] Initializing persistent offscreen document controller...');
    await this._createOffscreenPageIfMissing();
    if (!self.BusController) {
      self.BusController = BusController;
      await self.BusController.init();
    }
    this._initialized = true;
  },
  async _createOffscreenPageIfMissing() {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.DOM_PARSER],
        justification: 'HTOS needs persistent offscreen DOM for complex operations and a stable message bus.',
      });
    }
  }
};

// =============================================================================
// SESSION MANAGER (Source of Truth for Session Data)
// =============================================================================
const __HTOS_SESSIONS = (self.__HTOS_SESSIONS = self.__HTOS_SESSIONS || {});

class SessionManager {
  constructor() {
    this.sessions = __HTOS_SESSIONS;
    this.storageKey = 'htos_sessions';
    this.isExtensionContext = typeof chrome !== 'undefined' && chrome.storage?.local;
    if (this.isExtensionContext) {
      this.loadSessions().catch(console.error);
    }
  }

  getOrCreateSession(sessionId) {
    if (!this.sessions[sessionId]) {
      this.sessions[sessionId] = {
        sessionId,
        providers: {},
        contextHistory: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
        title: '',
        turns: []
      };
    }
    return this.sessions[sessionId];
  }

  async loadSessions() {
    if (!this.isExtensionContext) return;
    try {
      const data = await chrome.storage.local.get(null);
      const sessionKeys = Object.keys(data).filter(key => key.startsWith(`${this.storageKey}_`));
      for (const key of sessionKeys) {
        const sessionId = key.replace(`${this.storageKey}_`, '');
        if (data[key]) this.sessions[sessionId] = data[key];
      }
      console.log(`[SessionManager] Loaded ${Object.keys(this.sessions).length} sessions.`);
    } catch (error) {
      console.error('[SessionManager] Failed to load sessions:', error);
    }
  }

  async saveSession(sessionId) {
    if (!this.isExtensionContext || !this.sessions[sessionId]) return;
    try {
      const sessionKey = `${this.storageKey}_${sessionId}`;
      await chrome.storage.local.set({ [sessionKey]: this.sessions[sessionId] });
      console.log(`[SessionManager] Saved session ${sessionId}`);
    } catch (error) {
      console.error(`[SessionManager] Failed to save session ${sessionId}:`, error);
    }
  }
  
  updateProviderContext(sessionId, providerId, result, preserveChat = true, options = {}) {
    const { skipSave = true } = options;
    const session = this.getOrCreateSession(sessionId);
    const existingContext = session.providers[providerId] || {};
    session.providers[providerId] = {
      ...existingContext,
      text: result.text || "",
      meta: { ...(existingContext.meta || {}), ...(result.meta || {}) },
      lastUpdated: Date.now()
    };
    session.lastActivity = Date.now();
    if (!skipSave) {
      this.saveSession(sessionId).catch(err => console.error(`Failed to save session ${sessionId}:`, err));
    }
  }

  getProviderContexts(sessionId) {
    const session = this.sessions[sessionId];
    if (!session) return {};
    const contexts = {};
    for (const [providerId, data] of Object.entries(session.providers)) {
      if (data?.meta) contexts[providerId] = { meta: data.meta };
    }
    return contexts;
  }
  
  async deleteSession(sessionId) {
    if (this.sessions[sessionId]) {
      delete this.sessions[sessionId];
      if (this.isExtensionContext) {
        await chrome.storage.local.remove(`${this.storageKey}_${sessionId}`);
      }
      return true;
    }
    return false;
  }
}
const sessionManager = new SessionManager();

// =============================================================================
// PROVIDER ADAPTER REGISTRY
// =============================================================================
class ProviderRegistry {
  constructor() {
    this.adapters = new Map();
    this.controllers = new Map();
  }
  register(providerId, controller, adapter) {
    this.controllers.set(providerId, controller);
    this.adapters.set(providerId, adapter);
  }
  getAdapter(providerId) { return this.adapters.get(String(providerId).toLowerCase()); }
  getController(providerId) { return this.controllers.get(String(providerId).toLowerCase()); }
  listProviders() { return Array.from(this.adapters.keys()); }
  isAvailable(providerId) { return this.adapters.has(String(providerId).toLowerCase()); }
}
const providerRegistry = new ProviderRegistry();
self.providerRegistry = providerRegistry; // For debugging

// =============================================================================
// FAULT-TOLERANT ORCHESTRATOR WRAPPER
// =============================================================================
class FaultTolerantOrchestrator {
    constructor() {
        this.activeRequests = new Map();
        this.lifecycleManager = self.lifecycleManager;
    }

    async executeParallelFanout(prompt, providers, options = {}) {
        const {
            sessionId = `req-${Date.now()}`,
            onPartial = () => {},
            onAllComplete = () => {},
            useThinking = false,
            providerContexts = {}
        } = options;

        if (this.lifecycleManager) this.lifecycleManager.keepalive(true);

        const results = new Map();
        const errors = new Map();
        const abortControllers = new Map();
        this.activeRequests.set(sessionId, { abortControllers });

        const providerPromises = providers.map(providerId => {
            const abortController = new AbortController();
            abortControllers.set(providerId, abortController);
            
            const adapter = providerRegistry.getAdapter(providerId);
            if (!adapter) {
                errors.set(providerId, new Error(`Provider ${providerId} not available`));
                return Promise.resolve();
            }

            const request = {
                originalPrompt: prompt,
                sessionId,
                meta: { ...(providerContexts[providerId]?.meta || {}), useThinking }
            };

            return adapter.sendPrompt(request, (chunk) => onPartial(providerId, chunk), abortController.signal)
                .then(result => results.set(providerId, result))
                .catch(error => errors.set(providerId, error));
        });

        Promise.allSettled(providerPromises).then(() => {
            onAllComplete(results, errors);
            this.activeRequests.delete(sessionId);
            if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
        });
    }

    _abortRequest(sessionId) {
        const request = this.activeRequests.get(sessionId);
        if (request) {
            request.abortControllers.forEach(controller => controller.abort());
            this.activeRequests.delete(sessionId);
            if (this.lifecycleManager) this.lifecycleManager.keepalive(false);
        }
    }
}


// =============================================================================
// POPUP PORT CONNECTION HANDLER (NEW, UNIFIED, AND CLEAN)
// =============================================================================
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "htos-popup") {
    console.log("[SW] New UI Port connected:", port.sender?.tab?.id);

    // 1. Instantiate a new WorkflowEngine FOR THIS SPECIFIC CONNECTION.
    //    It uses singleton services (orchestrator, sessionManager) and the port for communication.
    const workflowEngine = new WorkflowEngine(
      self.faultTolerantOrchestrator,
      sessionManager,
      port
    );

    // 2. Add the new, simplified message listener. This is the ONLY entry point for AI work.
    port.onMessage.addListener(async (message) => {
      if (!message || !message.type) return;

      console.log(`[SW] Received message of type: ${message.type}`);
      switch (message.type) {
        // THE SINGLE entry point for all new AI workflows.
        case 'EXECUTE_WORKFLOW':
          // The engine now handles everything. No more complex logic here.
          await workflowEngine.execute(message.payload); // payload is the WorkflowRequest
          break;

        // Ancillary handlers that are NOT part of the AI workflow execution.
        case 'reconnect':
          port.postMessage({ type: "reconnect_ack", serverTime: Date.now() });
          break;

        case 'abort':
          if (message.sessionId && self.faultTolerantOrchestrator) {
            self.faultTolerantOrchestrator._abortRequest(message.sessionId);
          }
          break;

        // All old, imperative handlers like 'sendPrompt', 'continue', 'synthesize', etc.
        // have been REMOVED. Their logic is now fully encapsulated within the WorkflowEngine.
        default:
          console.warn(`[SW] Unknown or deprecated message type received: ${message.type}`);
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      console.log("[SW] UI Port disconnected.");
      // The workflowEngine instance associated with this port will now be garbage collected.
    });
  }
});


// =============================================================================
// EXTENSION ACTION HANDLER
// =============================================================================
chrome.action?.onClicked.addListener(async () => {
  try {
    const url = chrome.runtime.getURL("ui/index.html");
    const [existingTab] = await chrome.tabs.query({ url });
    if (existingTab?.id) {
      await chrome.tabs.update(existingTab.id, { active: true });
      if (existingTab.windowId) await chrome.windows.update(existingTab.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
  } catch (e) {
    console.error("[SW] Failed to open UI tab:", e);
  }
});

// =============================================================================
// GLOBAL INFRASTRUCTURE INITIALIZATION
// =============================================================================
async function initializeGlobalInfrastructure() {
  console.log("[SW] Initializing global infrastructure...");
  try {
    await NetRulesManager.init();
    CSPController.init();
    await UserAgentController.init();
    await ArkoseController.init();
    await DNRUtils.initialize();
    await OffscreenController.init();
    await BusController.init();
    self.bus = BusController;
    console.log("[SW] Global infrastructure initialization complete.");
  } catch (e) {
    console.error("[SW] Core infrastructure init failed", e);
  }
}

// =============================================================================
// PROVIDER INITIALIZATION
// =============================================================================
async function initializeProviders() {
  console.log("[SW] Initializing providers...");
  const providerConfigs = [
    { name: 'claude', Controller: ClaudeProviderController, Adapter: ClaudeAdapter },
    { name: 'gemini', Controller: GeminiProviderController, Adapter: GeminiAdapter },
    { name: 'chatgpt', Controller: ChatGPTProviderController, Adapter: ChatGPTAdapter },
    { name: 'qwen', Controller: QwenProviderController, Adapter: QwenAdapter },
  ];
  for (const config of providerConfigs) {
    try {
      const controller = new config.Controller();
      if (typeof controller.init === 'function') await controller.init();
      const adapter = new config.Adapter(controller);
      if (typeof adapter.init === 'function') await adapter.init();
      providerRegistry.register(config.name, controller, adapter);
      console.log(`[SW] ✓ ${config.name} initialized`);
    } catch (e) {
      console.error(`[SW] Failed to initialize ${config.name}:`, e);
    }
  }
  return providerRegistry.listProviders();
}

// =============================================================================
// ORCHESTRATOR INITIALIZATION
// =============================================================================
async function initializeOrchestrator() {
  try {
    self.lifecycleManager = new LifecycleManager();
    self.faultTolerantOrchestrator = new FaultTolerantOrchestrator();
    console.log("[SW] ✓ FaultTolerantOrchestrator initialized");
  } catch (e) {
    console.error("[SW] Orchestrator init failed", e);
  }
}

// =============================================================================
// RUNTIME MESSAGE HANDLER (for history, system status etc.)
// =============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request?.type || request.$bus) return false;

    switch(request.type) {
        case 'GET_FULL_HISTORY':
            const sessions = Object.values(sessionManager.sessions || {}).map(s => ({
                id: s.sessionId,
                sessionId: s.sessionId,
                title: s.title || s.turns?.[0]?.user?.text || 'New Chat',
                startTime: s.createdAt,
                lastActivity: s.lastActivity,
                messageCount: (s.turns?.length || 0) * 2,
                firstMessage: s.turns?.[0]?.user?.text || ''
            })).sort((a, b) => b.lastActivity - a.lastActivity);
            sendResponse({ success: true, data: { sessions } });
            return true;
        
        case 'GET_HISTORY_SESSION':
            const session = sessionManager.sessions[request.sessionId];
            if (session) {
                sendResponse({ success: true, data: session });
            } else {
                sendResponse({ success: false, error: 'Session not found' });
            }
            return true;
        
        case 'GET_SYSTEM_STATUS':
             sendResponse({ success: true, data: { availableProviders: providerRegistry.listProviders() }});
             return true;
    }
    return false; // Indicate we are not handling this message asynchronously
});


// =============================================================================
// MAIN INITIALIZATION SEQUENCE
// =============================================================================
(async () => {
  try {
    await initializeGlobalInfrastructure();
    await initializeProviders();
    await initializeOrchestrator();
    SWBootstrap.init();
    console.log("[SW] 🚀 Bootstrap complete. System ready.");
  } catch (e) {
    console.error("[SW] Bootstrap failed:", e);
  }
})();