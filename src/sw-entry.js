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
import { ClaudeProviderController } from "./providers/claude.js";
import { GeminiProviderController } from "./providers/gemini.js";
import { ChatGPTProviderController } from "./providers/chatgpt.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";

// Ensure fetch is correctly bound in WorkerGlobalScope to avoid Illegal invocation
try {
  if (typeof fetch === "function" && typeof globalThis !== "undefined") {
    globalThis.fetch = fetch.bind(globalThis);
  }
} catch (_) {}

// Initialize BusController globally
self.BusController = BusController;

// =============================================================================
// PERSISTENT OFFSCREEN DOCUMENT CONTROLLER (MANDATE REQUIREMENT)
// =============================================================================
const OffscreenController = {
  _initialized: false,
  
  async init() {
    if (this._initialized) {
      console.log('[Service Worker] Offscreen controller already initialized');
      return;
    }
    
    console.log('[Service Worker] Initializing persistent offscreen document controller...');
    await this._createOffscreenPageIfMissing();
    
    if (!self.BusController) {
      console.log('[Service Worker] Initializing BusController...');
      self.BusController = BusController;
      await self.BusController.init();
      console.log('[Service Worker] BusController initialized successfully.');
    }
    
    this._initialized = true;
  },

  async _createOffscreenPageIfMissing() {
    try {
      const hasDocument = await chrome.offscreen.hasDocument();
      if (!hasDocument) {
        console.log('[Service Worker] Creating persistent offscreen document...');
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.DOM_PARSER],
          justification: 'HTOS needs persistent offscreen DOM for image processing, and stable message bus',
        });
        console.log('[Service Worker] Persistent offscreen document created successfully.');
      } else {
        console.log('[Service Worker] Persistent offscreen document already exists.');
      }
    } catch (error) {
      console.error('[Service Worker] Failed to create persistent offscreen document:', error);
      throw error;
    }
  }
};

// =============================================================================
// SESSION STORE FOR SYNTHESIS CONTINUATION
// =============================================================================
const __HTOS_SESSIONS = (self.__HTOS_SESSIONS = self.__HTOS_SESSIONS || {});

// Enhanced session management
class SessionManager {
  constructor() {
    this.sessions = __HTOS_SESSIONS;
    this.storageKey = 'htos_sessions';
    this.isExtensionContext = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    
    // Load sessions from storage on initialization
    if (this.isExtensionContext) {
      this.loadSessions().catch(console.error);
    } else {
      console.warn('[SessionManager] Not in extension context, using in-memory sessions only');
    }
  }

  getOrCreateSession(sessionId, originalPrompt = "") {
    if (!this.sessions[sessionId]) {
      this.sessions[sessionId] = {
        sessionId,
        originalPrompt,
        providers: {},
        contextHistory: [], // Track conversation history
        createdAt: Date.now(),
        lastActivity: Date.now(),
        title: (typeof originalPrompt === 'string' && originalPrompt) ? String(originalPrompt).trim() : '',
        turns: [] // Persist full chat rounds: { id, createdAt, user: { text, createdAt }, providers: { [pid]: { text, meta } }, completedAt? }
      };
    }
    return this.sessions[sessionId];
  }

  // Load sessions from chrome.storage.local
  async loadSessions() {
    if (!this.isExtensionContext) {
      console.warn('[SessionManager] Not in extension context, skipping session load');
      return;
    }
    
    try {
      console.log('[SessionManager] Loading sessions from storage...');
      const data = await chrome.storage.local.get(null); // Get all storage
      console.debug('[SessionManager] Raw storage data:', Object.keys(data));
      
      // Look for both individual session keys and the main sessions object
      const sessionKeys = Object.keys(data).filter(key => 
        key.startsWith(`${this.storageKey}_`) || key === this.storageKey
      );
      
      if (sessionKeys.length === 0) {
        console.log('[SessionManager] No session data found in storage');
        return;
      }
      
      console.log(`[SessionManager] Found ${sessionKeys.length} session keys in storage`);
      
      // Load individual sessions first
      const sessionPromises = sessionKeys
        .filter(key => key.startsWith(`${this.storageKey}_`))
        .map(async key => {
          const sessionId = key.replace(`${this.storageKey}_`, '');
          console.debug(`[SessionManager] Loading individual session: ${sessionId}`);
          const sessionData = data[key];
          if (sessionData) {
            this.sessions[sessionId] = sessionData;
          }
        });
      
      // Also load from the main sessions object if it exists
      if (data[this.storageKey]) {
        console.log('[SessionManager] Loading from main sessions object');
        Object.assign(this.sessions, data[this.storageKey]);
      }
      
      await Promise.all(sessionPromises);
      console.log(`[SessionManager] Successfully loaded ${Object.keys(this.sessions).length} sessions`);
      
    } catch (error) {
      console.error('[SessionManager] Failed to load sessions:', error);
      // Try to recover by clearing potentially corrupted storage
      try {
        await chrome.storage.local.clear();
        console.log('[SessionManager] Cleared storage after load error');
      } catch (clearError) {
        console.error('[SessionManager] Failed to clear storage:', clearError);
      }
    }
  }

  // Begin a new round with the given user prompt
  beginRound(sessionId, userPrompt) {
    const session = this.getOrCreateSession(sessionId, typeof userPrompt === 'string' ? userPrompt : "");
    const roundId = `r-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    try {
      if (!Array.isArray(session.turns)) session.turns = [];
      session.turns.push({
        id: roundId,
        createdAt: Date.now(),
        user: { text: String(userPrompt || ''), createdAt: Date.now() },
        providers: {}
      });
      if (!session.title || session.title.trim().length === 0) {
        session.title = String(userPrompt || '').trim();
      }
      if (!session.createdAt) session.createdAt = Date.now();
      session.lastActivity = Date.now();
    } catch (e) {}
    return roundId;
  }

  // Update a specific provider's result within a round
  updateRoundProvider(sessionId, roundId, providerId, result, options = { skipSave: true }) {
    const { skipSave = true } = options;
    const session = this.sessions[sessionId];
    if (!session || !Array.isArray(session.turns)) return;
    try {
      const round = [...session.turns].reverse().find(r => r && r.id === roundId) || session.turns.find(r => r && r.id === roundId);
      if (!round) return;
      round.providers = round.providers || {};
      round.providers[String(providerId)] = {
        text: result?.text || "",
        meta: result?.meta || {}
      };
      session.lastActivity = Date.now();
    } catch (e) {
      console.error(`[SessionManager] Error in updateRoundProvider:`, e);
    }
  }

  // Mark a round as completed
  completeRound(sessionId, roundId, options = { skipSave: true }) {
    const { skipSave = true } = options;
    const session = this.sessions[sessionId];
    if (!session || !Array.isArray(session.turns)) return;
    try {
      const round = [...session.turns].reverse().find(r => r && r.id === roundId) || session.turns.find(r => r && r.id === roundId);
      if (round) {
        round.completedAt = Date.now();
        session.lastActivity = Date.now();
      }
    } catch (e) {
      console.error(`[SessionManager] Error in completeRound:`, e);
    }
  }
  
  // Save sessions to chrome.storage.local
  async saveSessions() {
    if (!this.isExtensionContext) return;
    
    try {
      await chrome.storage.local.set({ [this.storageKey]: this.sessions });
      console.log(`[SessionManager] Saved ${Object.keys(this.sessions).length} sessions to storage`);
    } catch (error) {
      console.error('[SessionManager] Failed to save sessions:', error);
    }
  }
  
  // Save a single session
  async saveSession(sessionId) {
    const callStack = new Error().stack.split('\n').slice(1, 4).join('\n');
    console.log(`[SessionManager] saveSession called for ${sessionId} from:\n${callStack}`);
    
    if (!this.isExtensionContext) {
      console.warn(`[SessionManager] Cannot save ${sessionId}: No extension context`);
      return;
    }
    
    if (!this.sessions[sessionId]) {
      console.warn(`[SessionManager] Cannot save ${sessionId}: Session does not exist`);
      return;
    }
    
    console.log(`[SessionManager] Session ${sessionId} state before save:`, {
      hasProviders: !!this.sessions[sessionId]?.providers,
      providerCount: Object.keys(this.sessions[sessionId]?.providers || {}).length,
      lastActivity: this.sessions[sessionId]?.lastActivity
    });
    
    try {
      const sessionKey = `${this.storageKey}_${sessionId}`;
      const sessionData = this.sessions[sessionId];
      console.debug(`[SessionManager] Saving session ${sessionId} with data:`, {
        sessionKey,
        providers: Object.keys(sessionData.providers || {}),
        lastActivity: sessionData.lastActivity
      });
      
      console.log(`[SessionManager] Starting save for ${sessionId} at ${new Date().toISOString()}`);
      const startTime = Date.now();
      
      try {
        await chrome.storage.local.set({ [sessionKey]: sessionData });
        const duration = Date.now() - startTime;
        console.log(`[SessionManager] Successfully saved session ${sessionId} in ${duration}ms`);
        
        // Verify the save worked
        try {
          const result = await chrome.storage.local.get(sessionKey);
          if (!result[sessionKey]) {
            console.error(`[SessionManager] Verification failed: Could not read back session ${sessionId}`);
          } else {
            console.debug(`[SessionManager] Verified session ${sessionId} in storage`);
            return true; // Indicate success
          }
        } catch (verifyError) {
          console.error(`[SessionManager] Verification error for ${sessionId}:`, verifyError);
        }
      } catch (saveError) {
        console.error(`[SessionManager] Save failed for ${sessionId} after ${Date.now() - startTime}ms:`, saveError);
        throw saveError; // Re-throw to be caught by outer try-catch
      }
    } catch (error) {
      console.error(`[SessionManager] Failed to save session ${sessionId}:`, error);
      // Try to save the full sessions object as fallback
      try {
        await this.saveSessions();
      } catch (e) {
        console.error('[SessionManager] Fallback saveSessions also failed:', e);
      }
    }
  }
  
  async updateProviderContext(sessionId, providerId, result, preserveChat = true, options = { skipSave: true }) {
    const { skipSave = true } = options;
    const logPrefix = `[SessionManager] [${providerId}]`;
    
    try {
      console.log(`${logPrefix} Updating context for session ${sessionId}`, { 
        skipSave,
        hasText: !!result?.text,
        textLength: result?.text?.length || 0,
        hasMeta: !!result?.meta
      });
      
      const session = this.getOrCreateSession(sessionId);
      
      // Preserve existing context if continuation
      const existingContext = session.providers[providerId] || {};
      
      // Store the previous state for comparison
      const prevText = existingContext.text || '';
      const prevMeta = { ...(existingContext.meta || {}) };
      
      // Update the provider context
      session.providers[providerId] = {
        ...existingContext,
        text: result.text || "",
        meta: {
          ...existingContext.meta,
          ...result.meta,
          // Ensure continuation identifiers are preserved
          chatId: result.meta?.chatId || existingContext.meta?.chatId,
          cursor: result.meta?.cursor || existingContext.meta?.cursor,
          conversationId: result.meta?.conversationId || existingContext.meta?.conversationId,
          parentMessageId: result.meta?.parentMessageId || existingContext.meta?.parentMessageId,
          messageId: result.meta?.messageId || existingContext.meta?.messageId,
        },
        lastUpdated: Date.now()
      };

      // Track conversation turn for history
      if (result.text && result.text !== prevText) {
        session.contextHistory.push({
          turn: session.contextHistory.length + 1,
          providerId,
          timestamp: Date.now(),
          responseLength: result.text.length
        });
      }

      session.lastActivity = Date.now();
      
      console.log(`${logPrefix} Context updated for session ${sessionId}`, {
        textChanged: result.text !== prevText,
        textLength: result.text?.length || 0,
        metaChanged: JSON.stringify(prevMeta) !== JSON.stringify(session.providers[providerId].meta),
        lastActivity: new Date(session.lastActivity).toISOString()
      });
      
      // Only save if not explicitly skipped (will be handled by caller)
      if (!skipSave) {
        console.log(`${logPrefix} Triggering save for session ${sessionId}`);
        this.saveSession(sessionId).catch(err => {
          console.error(`${logPrefix} Failed to save session ${sessionId}:`, err);
        });
      } else {
        console.debug(`${logPrefix} Skipping save for session ${sessionId} (skipSave=${skipSave})`);
      }
      
      return true;
    } catch (error) {
      console.error(`${logPrefix} Error updating context for session ${sessionId}:`, error);
      throw error;
    }
  }

  getProviderContexts(sessionId) {
    const session = this.sessions[sessionId];
    if (!session) return {};

    const contexts = {};
    for (const [providerId, data] of Object.entries(session.providers)) {
      if (data && data.meta) {
        contexts[providerId] = {
          meta: data.meta,
          // Ensure continuation identifiers are available
          chatId: data.meta.chatId,
          cursor: data.meta.cursor,
          conversationId: data.meta.conversationId,
          parentMessageId: data.meta.parentMessageId,
          messageId: data.meta.messageId,
        };
      }
    }
    return contexts;
  }

  logSessionState(sessionId) {
    const session = this.sessions[sessionId];
    if (session) {
      console.log(`[SessionManager] Session ${sessionId} state:`, {
        providers: Object.keys(session.providers),
        contexts: Object.fromEntries(
          Object.entries(session.providers).map(([pid, data]) => [
            pid, 
            { 
              hasChatId: !!data.meta?.chatId,
              hasCursor: !!data.meta?.cursor,
              hasConversationId: !!data.meta?.conversationId,
              hasParentMessageId: !!data.meta?.parentMessageId,
              hasMessageId: !!data.meta?.messageId,
            }
          ])
        ),
        turns: session.contextHistory.length
      });
    }
  }

  // New: delete all background contexts for a session
  async deleteSession(sessionId) {
    if (this.sessions[sessionId]) {
      delete this.sessions[sessionId];
      console.log(`[SessionManager] Deleted session ${sessionId}`);
      
      // Remove from storage
      if (this.isExtensionContext) {
        try {
          const sessionKey = `${this.storageKey}_${sessionId}`;
          await chrome.storage.local.remove(sessionKey);
          console.log(`[SessionManager] Removed session ${sessionId} from storage`);
          // Also persist the updated sessions map to the aggregate key to avoid stale resurrection
          try {
            await chrome.storage.local.set({ [this.storageKey]: this.sessions });
            console.log('[SessionManager] Updated aggregate sessions after deletion');
          } catch (e) {
            console.warn('[SessionManager] Failed to update aggregate sessions after deletion', e);
          }
        } catch (error) {
          console.error(`[SessionManager] Failed to remove session ${sessionId} from storage:`, error);
        }
      }
      
      // Clear any streaming state associated with this session
      try {
        for (const key of Array.from(lastStreamState.keys())) {
          if (typeof key === 'string' && key.startsWith(`${sessionId}:`)) {
            lastStreamState.delete(key);
          }
        }
      } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  }
}

const sessionManager = new SessionManager();

// Track last seen text per provider/session so we can send only deltas
// Keyed as `${sessionId}:${providerId}`
const lastStreamState = new Map();

function makeDelta(sessionId, providerId, fullText = "") {
  try {
    // Defensive guard: sessionId must be valid to avoid keys like "undefined:provider"
    if (!sessionId) {
      try { console.warn('[HTOS] makeDelta called with falsy sessionId, returning full text to avoid invalid key'); } catch {}
      return fullText || "";
    }
     const key = `${sessionId}:${providerId}`;
     const prev = lastStreamState.get(key) || "";
     let delta = "";

     if (fullText && fullText.length > prev.length) {
       // Normal case: provider sends cumulative superset -> send only new suffix
       delta = fullText.slice(prev.length);
     } else if (fullText && fullText !== prev) {
       // Rare case: provider rewrote the text; send full to resync
       delta = fullText;
     }

     // Always update last seen (empty string allowed)
     lastStreamState.set(key, fullText || "");
     return delta;
   } catch (e) {
     // On any error, fallback to sending full text so UI stays in sync
     try { return fullText || ""; } catch { return ""; }
   }
}

// =============================================================================
// PARALLEL EVENT ROUTER - CORE OF THE MANDATE
// =============================================================================
class ParallelEventRouter {
  constructor() {
    this.activeConnections = new Map();
  }

  // Register a connection (popup port or runtime message channel)
  registerConnection(id, sendFn) {
    this.activeConnections.set(id, sendFn);
    console.log(`[EventRouter] Registered connection: ${id}`);
  }

  // Remove connection
  unregisterConnection(id) {
    this.activeConnections.delete(id);
    console.log(`[EventRouter] Unregistered connection: ${id}`);
  }

  // Send to specific connection
  sendToConnection(connectionId, message) {
    const sendFn = this.activeConnections.get(connectionId);
    if (sendFn) {
      try {
        sendFn(message);
      } catch (error) {
        console.warn(`[EventRouter] Failed to send to ${connectionId}:`, error);
        this.unregisterConnection(connectionId);
      }
    }
  }

  // Broadcast to all connections
  broadcast(message) {
    for (const [id, sendFn] of this.activeConnections) {
      try {
        sendFn(message);
      } catch (error) {
        console.warn(`[EventRouter] Failed to broadcast to ${id}:`, error);
        this.unregisterConnection(id);
      }
    }
  }
}

const eventRouter = new ParallelEventRouter();

// =============================================================================
// PROVIDER ADAPTER REGISTRY (ENCAPSULATED COMPLEXITY)
// =============================================================================
class ProviderRegistry {
  constructor() {
    this.adapters = new Map();
    this.controllers = new Map();
  }

  register(providerId, controller, adapter) {
    this.controllers.set(providerId, controller);
    this.adapters.set(providerId, adapter);
    console.log(`[ProviderRegistry] Registered: ${providerId}`);
  }

  getAdapter(providerId) {
    const id = String(providerId).toLowerCase();
    const adapter = this.adapters.get(id);
    if (!adapter) {
      console.warn(`[ProviderRegistry] No adapter found for: ${id}`);
    }
    return adapter;
  }

  getController(providerId) {
    const id = String(providerId).toLowerCase();
    return this.controllers.get(id);
  }

  listProviders() {
    return Array.from(this.adapters.keys());
  }

  isAvailable(providerId) {
    const id = String(providerId).toLowerCase();
    return this.adapters.has(id);
  }
}

const providerRegistry = new ProviderRegistry();
// Expose registry and its internal maps on the global `self` for debugging
try {
  self.providerRegistry = providerRegistry;
  self.adapters = providerRegistry.adapters;
  self.controllers = providerRegistry.controllers;
} catch (e) {
  // ignore in restricted contexts
}

// =============================================================================
// FAULT-TOLERANT ORCHESTRATOR WRAPPER
// =============================================================================
class FaultTolerantOrchestrator {
  constructor() {
    this.activeRequests = new Map();
    // Access the lifecycle manager for streaming keepalive
    this.lifecycleManager = self.lifecycleManager;
    // More aggressive heartbeat interval during streaming
    this.streamingHeartbeatMs = 5000; // 5 seconds during streaming
  }

  async executeParallelFanout(prompt, providers, options = {}) {
    const {
      sessionId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      onPartial = () => {},
      onProviderComplete = () => {},
      onError = () => {},
      onAllComplete = () => {},
      useThinking = false
    } = options;

    console.log(`[FaultTolerantOrchestrator] Starting parallel fanout for ${providers.length} providers`);
    
    // Enable aggressive keepalive for streaming
    if (this.lifecycleManager) {
      console.log('[FaultTolerantOrchestrator] Enabling aggressive keepalive for streaming');
      this.lifecycleManager.keepalive(true);
      this.lifecycleManager.startHeartbeat(this.streamingHeartbeatMs);
      // Also emit workflow.start event to ensure lifecycle manager is in active mode
      chrome.runtime.sendMessage({ type: 'workflow.start', sessionId });
    }
    
    const results = new Map();
    const errors = new Map();
    const abortControllers = new Map();
    
    // Track this request
    this.activeRequests.set(sessionId, {
      providers,
      results,
      errors,
      abortControllers,
      startTime: Date.now(),
      useThinking: Boolean(useThinking)
    });

    // Create individual abort controllers for each provider
    const providerPromises = providers.map(providerId => {
      const abortController = new AbortController();
      abortControllers.set(providerId, abortController);
      
      return this._executeProviderRequest(
        providerId,
        prompt,
        sessionId,
        abortController.signal,
        {
          onPartial: (chunk) => onPartial(providerId, chunk),
          onComplete: (result) => {
            results.set(providerId, result);
            onProviderComplete(providerId, result);
          },
          onError: (error) => {
            errors.set(providerId, error);
            onError(providerId, error);
          }
        }
      );
    });

    // Don't await all - let them complete independently
    // This is the key to the non-blocking event router pattern
    Promise.allSettled(providerPromises).then(() => {
      console.log(`[FaultTolerantOrchestrator] All providers completed for session ${sessionId}`);
      
      // Call onAllComplete in its own try-catch to ensure it doesn't block the save
      try {
        onAllComplete(results, errors);
      } catch (e) {
        console.warn('[FaultTolerantOrchestrator] onAllComplete callback failed:', e);
      }
      
      // Session saving is handled by onAllComplete callback
      
      this.activeRequests.delete(sessionId);
      
      // Disable aggressive keepalive when all providers are done
      if (this.lifecycleManager) {
        console.log('[FaultTolerantOrchestrator] Disabling aggressive keepalive after streaming');
        this.lifecycleManager.keepalive(false);
        // Also emit workflow.end event to return lifecycle manager to idle mode
        chrome.runtime.sendMessage({ type: 'workflow.end', sessionId });
      }
    });

    return {
      sessionId,
      abort: () => this._abortRequest(sessionId)
    };
  }

  async executeContinuationFanout(prompt, providers, sessionId, providerContexts, options = {}) {
    const {
      onPartial = () => {},
      onProviderComplete = () => {},
      onError = () => {},
      onAllComplete = () => {}
    } = options;

    console.log(`[FaultTolerantOrchestrator] Starting continuation fanout for ${providers.length} providers with session ${sessionId}`);
    
    // Enable aggressive keepalive for streaming continuation
    if (this.lifecycleManager) {
      console.log('[FaultTolerantOrchestrator] Enabling aggressive keepalive for streaming continuation');
      this.lifecycleManager.keepalive(true);
      this.lifecycleManager.startHeartbeat(this.streamingHeartbeatMs);
      // Also emit workflow.start event to ensure lifecycle manager is in active mode
      chrome.runtime.sendMessage({ type: 'workflow.start', sessionId });
    }
    
    const results = new Map();
    const errors = new Map();
    const abortControllers = new Map();
    
    // Track this continuation request
    this.activeRequests.set(sessionId, {
      providers,
      results,
      errors,
      abortControllers,
      startTime: Date.now(),
      isContinuation: true
    });

    // Create individual abort controllers for each provider
    const providerPromises = providers.map(providerId => {
      const abortController = new AbortController();
      abortControllers.set(providerId, abortController);
      
      return this._executeContinuationRequest(
        providerId,
        prompt,
        sessionId,
        providerContexts[providerId] || {},
        abortController.signal,
        {
          onPartial: (chunk) => onPartial(providerId, chunk),
          onComplete: (result) => {
            results.set(providerId, result);
            onProviderComplete(providerId, result);
          },
          onError: (error) => {
            errors.set(providerId, error);
            onError(providerId, error);
          }
        }
      );
    });

    // Don't await all - let them complete independently
    Promise.allSettled(providerPromises).then(() => {
      console.log(`[FaultTolerantOrchestrator] All continuation providers completed for session ${sessionId}`);
      
      try {
        // Call the onAllComplete handler with results and errors
        onAllComplete(results, errors);
        
        // Session saving is handled by onAllComplete callback
      } catch (e) {
        console.warn('[FaultTolerantOrchestrator] onAllComplete callback failed:', e);
      }
      
      // Clean up
      this.activeRequests.delete(sessionId);
      
      // Disable aggressive keepalive when all continuation providers are done
      if (this.lifecycleManager) {
        console.log('[FaultTolerantOrchestrator] Disabling aggressive keepalive after streaming continuation');
        this.lifecycleManager.keepalive(false);
        // Also emit workflow.end event to return lifecycle manager to idle mode
        chrome.runtime.sendMessage({ type: 'workflow.end', sessionId });
      }
    });

    return {
      sessionId,
      abort: () => this._abortRequest(sessionId)
    };
  }

  async _executeProviderRequest(providerId, prompt, sessionId, signal, callbacks) {
    const { onPartial, onComplete, onError } = callbacks;
    
    try {
      console.log(
        `[FaultTolerantOrchestrator] Starting provider: ${providerId}`
      );

      const adapter = providerRegistry.getAdapter(providerId);
      if (!adapter) {
        throw new Error(`Provider ${providerId} not available`);
      }

      // Include any persisted continuation context for this provider/session so
      // hidden batch executions can continue existing conversations.
      const providerContext =
        sessionManager &&
        typeof sessionManager.getProviderContexts === "function"
          ? sessionManager.getProviderContexts(sessionId)?.[providerId] || {}
          : {};

      // Resolve final useThinking flag: provider-specific meta > active request opt
      let resolvedUseThinking = false;
      try {
        const active = this.activeRequests.get(sessionId) || {};
        resolvedUseThinking =
          providerContext?.meta?.useThinking !== undefined
            ? Boolean(providerContext.meta.useThinking)
            : active.useThinking !== undefined
            ? Boolean(active.useThinking)
            : false;
      } catch (e) {
        resolvedUseThinking = !!providerContext?.meta?.useThinking;
      }

      const request = {
        originalPrompt: prompt,
        sessionId,
        meta: {
          ...(providerContext?.meta || providerContext || {}),
          useThinking: resolvedUseThinking,
        },
      };

      // Execute with fault isolation
      const result = await adapter.sendPrompt(
        request,
        (chunk) => {
          if (signal.aborted) return;
          onPartial(chunk);
        },
        signal
      );

      if (signal.aborted) return;

      console.log(
        `[FaultTolerantOrchestrator] Provider ${providerId} completed successfully`
      );
      onComplete(result);
    } catch (error) {
      if (signal.aborted) return;
      
      console.error(`[FaultTolerantOrchestrator] Provider ${providerId} failed:`, error);
      onError({
        code: error.code || 'PROVIDER_ERROR',
        message: error.message || 'Provider request failed',
        retryable: error.retryable !== false
      });
    }
  }

  async _executeContinuationRequest(providerId, prompt, sessionId, providerContext, signal, callbacks) {
    const { onPartial, onComplete, onError } = callbacks;
    
    try {
      console.log(`[FaultTolerantOrchestrator] Starting continuation for provider: ${providerId}`);
      
      const adapter = providerRegistry.getAdapter(providerId);
      if (!adapter) {
        throw new Error(`Provider ${providerId} not available`);
      }

      // Check if adapter supports continuation
      if (typeof adapter.sendContinuation !== 'function') {
        console.warn(`[FaultTolerantOrchestrator] Provider ${providerId} does not support continuation, falling back to sendPrompt`);
        
        const request = {
          originalPrompt: prompt,
          sessionId,
          meta: providerContext
        };

        const result = await adapter.sendPrompt(
          request,
          (chunk) => {
            if (signal.aborted) return;
            onPartial(chunk);
          },
          signal
        );

        if (signal.aborted) return;
        onComplete(result);
        return;
      }

      // Use continuation method with preserved context
      const result = await adapter.sendContinuation(
        prompt,
        providerContext,
        sessionId,
        (chunk) => {
          if (signal.aborted) return;
          onPartial(chunk);
        },
        signal
      );

      if (signal.aborted) return;
      
      if (result.ok) {
        console.log(`[FaultTolerantOrchestrator] Provider ${providerId} continuation completed successfully`);
        onComplete(result);
      } else {
        console.error(`[FaultTolerantOrchestrator] Provider ${providerId} continuation failed:`, result.errorCode);
        onError({
          code: result.errorCode || 'CONTINUATION_ERROR',
          message: result.meta?.error || 'Provider continuation failed',
        });
      }
      
    } catch (error) {
      if (signal.aborted) return;
      
      console.error(`[FaultTolerantOrchestrator] Provider ${providerId} continuation failed:`, error);
      onError({
        code: error.code || 'CONTINUATION_ERROR',
        message: error.message || 'Provider continuation failed',
        retryable: error.retryable !== false
      });
    }
  }

  _abortRequest(sessionId) {
    const request = this.activeRequests.get(sessionId);
    if (!request) return;

    console.log(`[FaultTolerantOrchestrator] Aborting request: ${sessionId}`);
    
    for (const [providerId, controller] of request.abortControllers) {
      try {
        controller.abort();
      } catch (error) {
        console.warn(`[FaultTolerantOrchestrator] Failed to abort ${providerId}:`, error);
      }
    }
    
    this.activeRequests.delete(sessionId);
    
    // Disable aggressive keepalive when request is aborted
    if (this.lifecycleManager) {
      console.log('[FaultTolerantOrchestrator] Disabling aggressive keepalive after abort');
      this.lifecycleManager.keepalive(false);
      // Also emit workflow.end event to return lifecycle manager to idle mode
      chrome.runtime.sendMessage({ type: 'workflow.end', sessionId });
    }
  }

  getActiveRequestCount() {
    return this.activeRequests.size;
  }
}


// =============================================================================
// POPUP PORT CONNECTION HANDLER - STREAMING FIRST
// =============================================================================
chrome.runtime.onConnect.addListener((port) => {
  console.log("[HTOS] Port connected:", port.name);

  if (port.name === "htos-popup") {
    const connectionId = `popup-${Date.now()}`;
    
    // Register this connection in the event router
    eventRouter.registerConnection(connectionId, (message) => {
      try {
        port.postMessage(message);
      } catch (error) {
        console.warn("[HTOS] Port message failed:", error);
        eventRouter.unregisterConnection(connectionId);
      }
    });

    port.onMessage.addListener(async (message) => {
      console.log("[HTOS] Message from popup:", message.type);

      // Minimal reconnect handshake to support UI ensurePort()
      if (message.type === "reconnect") {
        try {
          const { uiInstanceId, lastSeenVersion, sessionId } = message;
          // For now we simply acknowledge; future: include session snapshot
          port.postMessage({
            type: "reconnect_ack",
            uiInstanceId,
            lastSeenVersion,
            sessionId: sessionId || null,
            serverTime: Date.now(),
          });
        } catch (e) {
          console.warn('[HTOS] reconnect handler failed:', e);
        }
        return;
      }

      // Hidden batch flow removed

      if (message.type === "sendPrompt") {
        const { prompt, providers, sessionId, useThinking } = message;
        console.log(`[HTOS] Processing prompt for ${providers.length} providers`);

        // Validate providers
        const availableProviders = providers.filter(p => 
          providerRegistry.isAvailable(p)
        );
        
        if (availableProviders.length === 0) {
          port.postMessage({
            type: "error",
            data: {
              message: "No available providers",
              code: "NO_PROVIDERS"
            }
          });
          return;
        }

        // Send immediate acknowledgment
        port.postMessage({
          type: "result",
          providerId: "system",
          text: `Starting parallel execution across ${availableProviders.length} provider(s)...`,
          ok: true,
          partial: false
        });

        // Execute parallel fanout - non-blocking
        // Ensure a stable session id is available synchronously so callbacks
        // used by the orchestrator always reference the intended session.
        const capturedSessionId = sessionId || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log('[HTOS] Using capturedSessionId for sendPrompt:', capturedSessionId);

        // Ensure session state exists before starting the fanout so callbacks
        // can immediately merge contexts and logs have a target session.
        try {
        } catch (e) {
          console.warn('[HTOS] Failed to create session before fanout', e);
        }

        const roundId = sessionManager.beginRound(capturedSessionId, String(prompt || ""));
        const fanout = await self.faultTolerantOrchestrator.executeParallelFanout(
          prompt,
          availableProviders,
          {
            sessionId: capturedSessionId,
            useThinking: Boolean(useThinking),
             onAllComplete: (resultsMap, errorsMap) => {
               try {
                 // Mark round completion (don't save yet, will be handled by the final save)
                 try { sessionManager.completeRound(capturedSessionId, roundId, { skipSave: true }); } catch {}
                 const stepResults = Array.from(resultsMap.entries()).map(([providerId, res]) => ({
                   providerId,
                   ok: res?.ok !== false,
                   text: res?.text || "",
                   meta: res?.meta || {}
                 }));

                 const responses = Object.fromEntries(stepResults.map(r => [r.providerId, { text: r.text }]));

                 port.postMessage({
                   type: "WORKFLOW_COMPLETE",
                   sessionId: capturedSessionId,
                   stepResults,
                   results: responses,
                   payload: { stepResults, responses }
                 });

                 // Finalize persistence at end-of-turn (single consolidated save)
                 try {
                   sessionManager.saveSession(capturedSessionId).catch(err => {
                     console.error('[HTOS] Final save failed (sendPrompt):', err);
                   });
                 } catch (_) {}
               } catch (e) {
                 console.warn('[HTOS] onAllComplete (sendPrompt) failed:', e);
               }
             },
             onPartial: (providerId, chunk) => {
               if (chunk && chunk.partial) {
                 // Instrument which session id is used for this partial
                 try { console.log(`[HTOS] onPartial session=${capturedSessionId} provider=${providerId} textLen=${(chunk.text||'').length}`); } catch {}
                 const delta = makeDelta(capturedSessionId, providerId, chunk.text || "");
                 if (delta) {
                   port.postMessage({
                     type: "result",
                     providerId,
                     text: delta,
                     partial: true,
                     ok: true,
                     sessionId: capturedSessionId,
                   });
                 }
               }
             },
             onProviderComplete: (providerId, result) => {
               console.log(`[HTOS] Provider ${providerId} completed`);
               
               // Instrument and then update session context with result for future continuations
               try { console.log(`[HTOS] onProviderComplete session=${capturedSessionId} provider=${providerId} resultLen=${(result?.text||'').length}`); } catch {}
               if (result && capturedSessionId) {
                 sessionManager.updateProviderContext(capturedSessionId, providerId, result, true, { skipSave: true });
                 // Also persist into the current round transcript
                 try { sessionManager.updateRoundProvider(capturedSessionId, roundId, providerId, result, { skipSave: true }); } catch {}
               }
               
               port.postMessage({
                 type: "result",
                 providerId,
                 text: result?.text || "",
                 ok: result?.ok !== false,
                 partial: false,
                 meta: result?.meta || {},
                 sessionId: capturedSessionId,
               });
             },
             onError: (providerId, error) => {
               console.log(`[HTOS] Provider ${providerId} failed for session=${capturedSessionId}:`, error.message);
               port.postMessage({
                 type: "result",
                 providerId,
                 text: error.message || "Provider error occurred",
                 ok: false,
                 partial: false,
                 error,
                 sessionId: capturedSessionId,
               });
             }
           }
         );

        console.log(`[HTOS] Parallel fanout initiated with session: ${capturedSessionId}`);
         // Inform UI about the session id to guarantee consistent continuation usage
         try {
           port.postMessage({ type: "session", sessionId: capturedSessionId });
         } catch (e) {
           console.warn('[HTOS] Failed to emit session id to port', e);
         }
       }

      if (message.type === "continue") {
        const { prompt, providers, sessionId, providerContexts, useThinking } = message;
        console.log(`[HTOS] Processing continuation for session ${sessionId} with ${providers.length} providers`);

        // Validate providers
        const availableProviders = providers.filter(p => 
          providerRegistry.isAvailable(p)
        );
        
        if (availableProviders.length === 0) {
          port.postMessage({
            type: "error",
            data: {
              message: "No available providers for continuation",
              code: "NO_PROVIDERS"
            }
          });
          return;
        }

        // Enhanced session management for continuation
        // Get contexts from SessionManager instead of relying on UI state
        const storedContexts = sessionManager.getProviderContexts(sessionId);
        const uiContexts = providerContexts || {};
        
        // Merge UI contexts with stored contexts, preferring stored for continuation data
        const mergedContexts = {};
        for (const providerId of availableProviders) {
          mergedContexts[providerId] = {
            ...uiContexts[providerId],
            ...storedContexts[providerId],
            // Ensure continuation identifiers are preserved
            meta: {
              ...uiContexts[providerId]?.meta,
              ...storedContexts[providerId]?.meta
            }
          };
          // Thread useThinking into meta (session-level preference for this continuation)
          try {
            mergedContexts[providerId].meta = {
              ...(mergedContexts[providerId].meta || {}),
              useThinking: Boolean(useThinking)
            };
          } catch {}
        }
        
        console.log("[HTOS] Merged provider contexts for continuation:", mergedContexts);
        sessionManager.logSessionState(sessionId);

        // Send immediate acknowledgment
        port.postMessage({
          type: "result",
          providerId: "system",
          text: `Continuing conversation across ${availableProviders.length} provider(s)...`,
          ok: true,
          partial: false
        });

        // Start a new round for continuation prompt
        const roundId = sessionManager.beginRound(sessionId, String(prompt || ""));
        // Execute continuation fanout - non-blocking
        const result = await self.faultTolerantOrchestrator.executeContinuationFanout(
          prompt,
          availableProviders,
          sessionId,
          mergedContexts,
          {
            onPartial: (providerId, chunk) => {
              if (chunk && chunk.partial) {
                const delta = makeDelta(sessionId, providerId, chunk.text || "");
                if (delta) {
                  port.postMessage({
                    type: "result",
                    providerId,
                    text: delta,
                    partial: true,
                    ok: true
                  });
                }
              }
            },
            onProviderComplete: (providerId, result) => {
              console.log(`[HTOS] Continuation provider ${providerId} completed`);
              
              // Update session context with result
              if (result && sessionId) {
                sessionManager.updateProviderContext(sessionId, providerId, result, true, { skipSave: true });
                try { sessionManager.updateRoundProvider(sessionId, roundId, providerId, result, { skipSave: true }); } catch {}
              }
              
              port.postMessage({
                type: "result",
                providerId,
                text: result?.text || "",
                ok: result?.ok !== false,
                partial: false,
                meta: result?.meta || {},
                sessionId,
              });
            },
            onError: (providerId, error) => {
              console.log(`[HTOS] Continuation provider ${providerId} failed:`, error.message);
              port.postMessage({
                type: "result",
                providerId,
                text: error.message || "Provider continuation error occurred",
                ok: false,
                partial: false,
                error,
                sessionId,
              });
            },
            onAllComplete: (resultMap, errorMap) => {
              try {
                console.log(`[HTOS] Continuation onAllComplete fired for session`, sessionId);
                try { sessionManager.completeRound(sessionId, roundId, { skipSave: true }); } catch {}
                // Lightweight beacon to guarantee UI event
                port.postMessage({ type: "WORKFLOW_COMPLETE", sessionId, results: [] });
              } catch(e) {
                console.warn('[HTOS] Failed to emit continuation WORKFLOW_COMPLETE beacon', e);
              }

              const stepResults = availableProviders.map(pid => {
                const res = resultMap.get(pid);
                const err = errorMap.get(pid);
                return {
                  provider: pid,
                  status: res ? 'completed' : 'failed',
                  result: res ? { response: res.text || '' } : undefined,
                  error: res ? undefined : err?.message || 'provider_failed'
                };
              });

              const responses = availableProviders.map(pid => ({
                providerId: pid,
                text: (resultMap.get(pid)?.text) || (errorMap.get(pid)?.message) || ''
              }));

              try {
                port.postMessage({
                  type: 'WORKFLOW_COMPLETE',
                  sessionId,
                  stepResults,
                  results: responses,
                  payload: { stepResults, responses }
                });
                // Finalize persistence for continuation turn
                try {
                  sessionManager.saveSession(sessionId).catch(err => {
                    console.error('[HTOS] Final save failed (continue):', err);
                  });
                } catch (_) {}
              } catch(err) {
                console.error('[HTOS] Failed to emit continuation WORKFLOW_COMPLETE payload', err);
              }
            }
          }
        );

        console.log(`[HTOS] Continuation fanout initiated for session: ${sessionId}`);
      }

      if (message.type === 'abort') {
        try {
          const { sessionId } = message;
          if (sessionId && self.faultTolerantOrchestrator) {
            self.faultTolerantOrchestrator._abortRequest(sessionId);
            port.postMessage({ type: 'workflow.end', sessionId });
          }
        } catch (e) {
          console.warn('[HTOS] abort handler failed', e);
        }
        return;
      }

      if (message.type === "synthesize") {
        try {
          let sessionId = message.sessionId || `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const isHidden = false; // hidden synthesis disabled
          const useThinking = Boolean(message.useThinking);

          // Normalize providers: support single provider (legacy) or array (batch)
          const singleProvider = (message.provider ? String(message.provider) : (message.synthesisProvider ? String(message.synthesisProvider) : "")).toLowerCase();
          const providersArray = Array.isArray(message.providers)
            ? message.providers.map((p) => String(p).toLowerCase())
            : null;

          const targetProviders = providersArray && providersArray.length > 0 ? providersArray : (singleProvider ? [singleProvider] : []);

          if (!targetProviders.length) {
            port.postMessage({
              type: "WORKFLOW_ERROR",
              sessionId,
              payload: { phase: "synthesis", error: "No synthesis provider(s) specified" },
            });
            return;
          }

          // Validate at least one available provider
          const availableProviders = targetProviders.filter((p) => providerRegistry.isAvailable(p));
          if (!availableProviders.length) {
            port.postMessage({
              type: "WORKFLOW_ERROR",
              sessionId,
              payload: { phase: "synthesis", providers: targetProviders, error: "Provider(s) unavailable" },
            });
            return;
          }

          if (!self.orchestrator) {
            port.postMessage({
              type: "WORKFLOW_ERROR",
              sessionId,
              payload: { phase: "synthesis", providers: availableProviders, error: "Orchestrator not initialized" },
            });
            return;
          }

          // Ensure session exists and gather contexts
          const session = (__HTOS_SESSIONS[sessionId] = __HTOS_SESSIONS[sessionId] || { originalPrompt: "", providers: {} });
          const providerContexts = sessionManager.getProviderContexts(sessionId) || {};

          const originalPrompt = String(message.originalPrompt || session.originalPrompt || "");

          // Prepare allBatchResults map once
          const allBatchResults = (message.allBatchResults && typeof message.allBatchResults === 'object') ? message.allBatchResults : null;

          // Fan-out synthesis calls in parallel
          const synthOutcomes = {};
          const synthPromises = availableProviders.map(async (synthesisProvider) => {
            try {
              // Build otherResults per target provider
              let otherResults = [];
              if (allBatchResults) {
                // Merge missing entries from providerContexts so every target receives all other outputs
                const merged = { ...allBatchResults };
                try {
                  Object.entries(providerContexts).forEach(([pid, ctx]) => {
                    if (
                      merged[pid] == null &&
                      ctx &&
                      typeof ctx.text === "string" &&
                      ctx.text.length > 0
                    ) {
                      merged[pid] = ctx.text;
                    }
                  });
                } catch {}
                otherResults = Object.entries(merged)
                  .filter(([pid]) => pid !== synthesisProvider)
                  .map(([pid, text]) => ({
                    providerId: pid,
                    text: text || "",
                  }));
                try {
                  console.log("[HTOS] Using allBatchResults for synthesis", {
                    synthesisProvider,
                    count: otherResults.length,
                  });
                } catch {}
              } else {
                otherResults = Object.entries(providerContexts)
                  .filter(([pid]) => pid !== synthesisProvider)
                  .map(([pid, ctx]) => ({
                    providerId: pid,
                    text: ctx?.text || "",
                  }));
                try {
                  console.log(
                    "[HTOS] Using provider contexts for synthesis (fallback)",
                    { synthesisProvider, count: otherResults.length }
                  );
                } catch {}
              }

              // Provider-specific meta (preserve continuation)
              const meta = {};
              const synthMeta = providerContexts[synthesisProvider]?.meta || {};
              if (
                synthesisProvider === "claude" &&
                (synthMeta.chatId || synthMeta.threadUrl)
              ) {
                meta.chatId = synthMeta.chatId || synthMeta.threadUrl;
              } else if (synthesisProvider === "gemini" && synthMeta.cursor) {
                meta.cursor = synthMeta.cursor;
              } else if (
                synthesisProvider === "chatgpt" &&
                (synthMeta.conversationId ||
                  synthMeta.parentMessageId ||
                  synthMeta.messageId)
              ) {
                meta.conversationId = synthMeta.conversationId;
                meta.parentMessageId = synthMeta.parentMessageId;
                meta.messageId = synthMeta.messageId;
              }
              // Honor Think-mode for ChatGPT synthesis
              if (synthesisProvider === "chatgpt" && useThinking) {
                meta.useThinking = true;
              }

              // Execute synthesis for this provider
              const res = await self.orchestrator.batchPrompt(originalPrompt, {
                synthesis: {
                  only: true,
                  providerId: synthesisProvider,
                  otherResults,
                  meta,
                },
                onPartial: (_pid, chunk) => {
                  try {
                    if (chunk && chunk.partial) {
                      const delta = makeDelta(
                        sessionId,
                        synthesisProvider,
                        chunk.text || ""
                      );
                      if (delta) {
                        port.postMessage({
                          type: "SYNTHESIS_PARTIAL",
                          sessionId,
                          payload: { provider: synthesisProvider, text: delta },
                        });
                      }
                    }
                  } catch (e) {
                    console.warn(
                      "[HTOS] Failed to stream synthesis partial over port",
                      e
                    );
                  }
                },
              });

              const s = res?.synthesis || null;
              try {
                console.log("[HTOS] Synthesis result meta", {
                  sessionId,
                  synthesisProvider,
                  meta: s?.meta,
                });
              } catch {}

              // Persist provider context for potential continuation or subsequent synthesis
              sessionManager.updateProviderContext(
                sessionId,
                synthesisProvider,
                { text: s?.text || "", meta: s?.meta || {} },
                true,
                { skipSave: true }
              );

              // Completion over the port (per provider)
              port.postMessage({
                type: "SYNTHESIS_COMPLETE",
                sessionId,
                payload: [
                  { provider: synthesisProvider, response: s?.text || "" },
                ],
              });
              // Track outcome
              synthOutcomes[synthesisProvider] = s?.ok !== false;
            } catch (err) {
              console.error("[HTOS] Synthesis error for provider", synthesisProvider, err);
              if (true) {
                port.postMessage({
                  type: "WORKFLOW_ERROR",
                  sessionId,
                  payload: { phase: "synthesis", provider: synthesisProvider, error: err?.message || "Synthesis failed" },
                });
              }
              // Track failure outcome
              synthOutcomes[synthesisProvider] = false;
            }
          });

          // Wait for all syntheses to settle (non-blocking for streaming, but we keep the try/catch scope)
          await Promise.allSettled(synthPromises);
          // Hidden synthesis aggregator removed

        } catch (error) {
          console.error("[HTOS] Port synthesis error:", error);
          const sessionId = message.sessionId || "unknown";
          const synthesisProvider = String(message.provider || "").toLowerCase();
          port.postMessage({
            type: "WORKFLOW_ERROR",
            sessionId,
            payload: { phase: "synthesis", provider: synthesisProvider, error: error?.message || "Synthesis failed" },
          });
        }
      }

      // FINAL ENSEMBLING (Round 3) — stream a single visible answer from chosen provider
      if (message.type === 'ensemble_finalize') {
        try {
          const { sessionId, userPrompt, modelOutputs, ensemblerProvider, ensemblerPrompt, useThinking } = message;
          const providerId = String(ensemblerProvider || 'claude').toLowerCase();
          const adapter = providerRegistry.getAdapter(providerId);
          if (!adapter) {
            port.postMessage({ type: 'WORKFLOW_ERROR', sessionId, payload: { phase: 'ensemble_finalize', error: 'Ensembler provider unavailable' } });
            return;
          }

          const request = {
            originalPrompt: ensemblerPrompt,
            sessionId,
            meta: {
              // carry forward minimal context if exists
              ...(sessionManager.getProviderContexts(sessionId)?.[providerId]?.meta || {}),
              ensemble: true,
              userPrompt,
              modelOutputs,
              ...(providerId === 'chatgpt' ? { useThinking: Boolean(useThinking) } : {})
            },
          };

          const startedAt = Date.now();
          const controller = new AbortController();
          const result = await adapter.sendPrompt(
            request,
            (chunk) => {
              if (chunk && chunk.partial) {
                const delta = makeDelta(sessionId, providerId, chunk.text || "");
                if (delta) {
                  port.postMessage({ type: 'result', providerId: providerId, text: delta, partial: true, ok: true, sessionId });
                }
              }
            },
            controller.signal
          );

          // completion
          port.postMessage({ type: 'result', providerId: providerId, text: result?.text || '', partial: false, ok: result?.ok !== false, sessionId, meta: result?.meta || {} });
          const duration = Date.now() - startedAt;
          try { console.log('[HTOS] ensemble_finalize complete', { sessionId, providerId, duration }); } catch {}
          // Persist final ensemble result at end-of-turn
          try {
            sessionManager.updateProviderContext(sessionId, providerId, { text: result?.text || '', meta: result?.meta || {} }, true, { skipSave: true });
            sessionManager.saveSession(sessionId).catch(err => {
              console.error('[HTOS] Final save failed (ensemble_finalize):', err);
            });
          } catch (_) {}
        } catch (e) {
          console.error('[HTOS] ensemble_finalize failed', e);
          try { port.postMessage({ type: 'WORKFLOW_ERROR', sessionId: message.sessionId, payload: { phase: 'ensemble_finalize', error: e?.message || String(e) } }); } catch {}
        }
      }

    });

    port.onDisconnect.addListener(() => {
      console.log("[HTOS] Port disconnected:", port.name);
      eventRouter.unregisterConnection(connectionId);
    });
  }
});

// =============================================================================
// EXTENSION ACTION HANDLER
// =============================================================================
try {
  if (chrome.action && chrome.tabs) {
    chrome.action.onClicked.addListener(async () => {
      try {
        const url = chrome.runtime.getURL("ui/index.html");
        const existing = await chrome.tabs.query({ url: [url] });
        if (existing && existing.length > 0) {
          const t = existing[0];
          if (t.id) await chrome.tabs.update(t.id, { active: true });
          if (t.windowId != null)
            await chrome.windows.update(t.windowId, { focused: true });
        } else {
          await chrome.tabs.create({ url });
        }
      } catch (e) {
        console.error("[HTOS] Failed to open UI tab:", e);
      }
    });
  }
} catch (e) {
  console.warn("[HTOS] Action click handler init failed", e);
}

// =============================================================================
// GLOBAL INFRASTRUCTURE INITIALIZATION (MANDATE STEP 3)
// =============================================================================
let initializationInProgress = false;

async function initializeGlobalInfrastructure() {
  if (initializationInProgress) {
    console.log("[HTOS] Infrastructure initialization already in progress");
    return;
  }
  
  initializationInProgress = true;
  console.log("[HTOS] Starting global infrastructure initialization...");

  // Step 1: Core network and security infrastructure
  try {
    if (chrome.alarms) {
      
      // Ensure NetRulesManager is properly initialized before calling register
      if (typeof NetRulesManager !== 'undefined' && typeof NetRulesManager.init === 'function') {
        try {
          await NetRulesManager.init();
          console.log("[HTOS] ✓ NetRulesManager initialized");
        } catch (initErr) {
          console.error('[HTOS] NetRulesManager.init() failed', initErr);
        }
      } else {
        console.warn('[HTOS] NetRulesManager not available or missing init()');
      }
      
      CSPController.init();
      console.log("[HTOS] ✓ CSPController initialized");
      
      await UserAgentController.init();
      console.log("[HTOS] ✓ UserAgentController initialized");
      
      if (typeof ArkoseController !== "undefined") {
        await ArkoseController.init();
        console.log("[HTOS] ✓ ArkoseController initialized");
      }

      // Register a DNR rule to allow embedding the local oi host in the offscreen document
      try {
        await NetRulesManager.register({
          key: 'allow-offscreen-oi-local',
          condition: {
            urlFilter: 'http://localhost:3000/oi*'
          },
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'permissions-policy', operation: 'remove' }
            ]
          }
        });
        console.log('[HTOS] ✓ DNR: allowed embedding http://localhost:3000/oi');
      } catch (e) {
        console.warn('[HTOS] Failed to register local offscreen oi DNR rule', e);
      }
    } else {
      console.warn("[HTOS] chrome.alarms API not available, skipping dependent initializations");
    }
  } catch (e) {
    console.error("[HTOS] Core infrastructure init failed", e);
  }

  // Step 2: Persistent offscreen document (critical for Arkose)
  try {
    await OffscreenController.init();
    console.log("[HTOS] ✓ Persistent offscreen document ready");
  } catch (e) {
    console.error('[HTOS] OffscreenController init failed', e);
  }

  // Step 3: Message bus initialization (idempotent)
  try {
    if (typeof BusController !== "undefined" && !self.bus) {
      await BusController.init();
      self.bus = BusController;
      console.log("[HTOS] ✓ BusController initialized");
    }
  } catch (e) {
    console.error("[HTOS] Bus init failed", e);
  }

  console.log("[HTOS] Global infrastructure initialization complete");
}

// =============================================================================
// PROVIDER INITIALIZATION - ENCAPSULATED COMPLEXITY
// =============================================================================
async function initializeProviders() {
  console.log("[HTOS] Starting provider initialization...");
  
  const providerConfigs = [
    { name: 'claude', Controller: ClaudeProviderController, Adapter: ClaudeAdapter },
    { name: 'gemini', Controller: GeminiProviderController, Adapter: GeminiAdapter },
    { name: 'chatgpt', Controller: ChatGPTProviderController, Adapter: ChatGPTAdapter },
  ];

  const initializedProviders = [];
  
  // Initialize providers sequentially to avoid resource conflicts
  for (const config of providerConfigs) {
    try {
      console.log(`[HTOS] Initializing ${config.name}...`);
      
      // Create controller
      const controller = new config.Controller();
      
      // Initialize controller with timeout for problematic providers
      if (typeof controller.init === 'function') {
        if (config.name === 'chatgpt') {
          // ChatGPT needs special handling due to Arkose complexity
          try {
            await Promise.race([
              controller.init(),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('ChatGPT init timeout')), 15000)
              )
            ]);
            console.log(`[HTOS] ${config.name} controller initialized with timeout protection`);
          } catch (timeoutError) {
            console.warn(`[HTOS] ${config.name} init timed out, using minimal initialization`);
            // Continue with adapter creation - ChatGPT can work without full init
          }
        } else {
          await controller.init();
          console.log(`[HTOS] ${config.name} controller initialized`);
        }
      }
      
      // Create adapter
      const adapter = new config.Adapter(controller);
      
      // Initialize adapter
      if (typeof adapter.init === 'function') {
        await adapter.init();
        console.log(`[HTOS] ${config.name} adapter initialized`);
      }
      
      // Register with registry
      providerRegistry.register(config.name, controller, adapter);
      
      // Keep global references for backward compatibility
      self[`${config.name}Controller`] = controller;
      self[`${config.name}Adapter`] = adapter;
      
      initializedProviders.push(config.name);
      console.log(`[HTOS] ✓ ${config.name} fully initialized`);
      
    } catch (e) {
      console.error(`[HTOS] Failed to initialize ${config.name}:`, e);
      
      // Special recovery for critical providers
      if (config.name === 'chatgpt') {
        try {
          console.log(`[HTOS] Attempting ChatGPT recovery without init...`);
          const controller = new config.Controller();
          const adapter = new config.Adapter(controller);
          
          providerRegistry.register(config.name, controller, adapter);
          self[`${config.name}Controller`] = controller;
          self[`${config.name}Adapter`] = adapter;
          
          initializedProviders.push(config.name + '-recovery');
          console.log(`[HTOS] ✓ ChatGPT recovery mode initialized`);
        } catch (recoveryError) {
          console.error(`[HTOS] ChatGPT recovery also failed:`, recoveryError);
        }
      }
    }
  }

  console.log(`[HTOS] Provider initialization complete. Available: [${initializedProviders.join(', ')}]`);
  return initializedProviders;
}

// =============================================================================
// ORCHESTRATOR INITIALIZATION
// =============================================================================
async function initializeOrchestrator(availableProviders) {
  try {
    if (availableProviders.length === 0) {
      console.warn("[HTOS] No providers available for orchestrator");
      return;
    }

    // Get adapters for orchestrator
    const adapters = availableProviders
      .map(name => providerRegistry.getAdapter(name.replace('-recovery', '')))
      .filter(Boolean);

    if (adapters.length > 0) {
      self.lifecycleManager = new LifecycleManager();
      self.requestLifecycle = new HTOSRequestLifecycleManager(utils, {});
      
      if (typeof self.requestLifecycle.init === 'function') {
        self.requestLifecycle.init();
      }
      
      self.orchestrator = new Orchestrator(
        adapters,
        {
          perProviderTimeoutMs: 30000,
          globalTimeoutMs: 45000,
          maxProviders: 8,
        },
        self.lifecycleManager,
        self.requestLifecycle
      );
      
      console.log(
        "[HTOS] ✓ Orchestrator initialized with providers:",
        self.orchestrator.listProviders().map((p) => p.id)
      );
      
      // Initialize FaultTolerantOrchestrator after lifecycleManager is available
      self.faultTolerantOrchestrator = new FaultTolerantOrchestrator();
      console.log("[HTOS] ✓ FaultTolerantOrchestrator initialized");
    } else {
      console.warn("[HTOS] No valid adapters for orchestrator");
    }
  } catch (e) {
    console.error("[HTOS] Orchestrator init failed", e);
  }
}

// =============================================================================
// MAIN INITIALIZATION SEQUENCE
// =============================================================================
(async () => {
  try {
    // Global infrastructure first (network, bus, offscreen)
    await initializeGlobalInfrastructure();
    
    // Provider initialization with fault tolerance
    const availableProviders = await initializeProviders();
    
    // Orchestrator setup
    await initializeOrchestrator(availableProviders);
    
    console.log("[HTOS] 🚀 Complete bootstrap finished - system ready for parallel fanout");
    
  } catch (e) {
    console.error("[HTOS] Bootstrap failed:", e);
  }
})();

// Initialize service worker bootstrap
SWBootstrap.init();

// Handle extension installation/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[HTOS] Extension installed/updated:", details.reason);

  if (details.reason === "install") {
    console.log("[HTOS] First time installation");
  } else if (details.reason === "update") {
    console.log("[HTOS] Extension updated from version:", details.previousVersion);
  }
});

// =============================================================================
// RUNTIME MESSAGE HANDLER - FAULT TOLERANT UI WORKFLOWS
// =============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Defensive validation: ensure we have a request object with a string `type` field
  if (!request || typeof request !== 'object') {
    console.warn('[HTOS] Runtime message received with invalid payload:', request, sender);
    try {
      if (typeof sendResponse === 'function') sendResponse({ success: false, error: 'Invalid runtime message' });
    } catch (e) {}
    return true; // keep channel open safely
  }

  // If this is an internal BusController message, ignore it here - BusController has its own handler
  if (request.$bus) {
    // Debugging info - avoid noisy logs in normal runs
    console.debug('[HTOS] SW runtime handler ignoring internal bus message from', sender?.url || sender?.id || sender);
    return false; // Do NOT indicate async response for ignored messages
  }

  const reqType = typeof request.type === 'string' ? request.type : undefined;
  console.log('[HTOS] Runtime message received:', reqType);

  if (!reqType) {
    console.warn('[HTOS] Runtime message missing or invalid type field:', request, sender);
    try {
      if (typeof sendResponse === 'function') sendResponse({ success: false, error: 'Missing message type' });
    } catch (e) {}
    return true;
  }

  // Handle CSP bypass
  if (request.type === "bypassCSP" && sender.tab) {
    sendResponse({ success: true });
    return;
  }

  // New: handle session deletion/cleanup
  if (reqType === 'DELETE_SESSION') {
    try {
      const sessionId = request?.payload?.sessionId || request?.sessionId;
      if (!sessionId) {
        sendResponse({ success: false, error: { message: 'Missing sessionId' } });
        return true;
      }
      const removed = sessionManager.deleteSession(sessionId);
      sendResponse({ success: true, data: { removed } });
    } catch (e) {
      console.warn('[HTOS] Failed to delete session from background:', e);
      try { sendResponse({ success: false, error: { message: e?.message || 'Deletion failed' } }); } catch {}
    }
    return true;
  }

  // Handle UI workflow execution with parallel fanout
  if (request.type === "EXECUTE_WORKFLOW" && request.payload) {
    // Acknowledge UI immediately to avoid message channel errors
    try {
      if (typeof sendResponse === 'function') sendResponse({ success: true });
    } catch(e) { console.warn('[HTOS] EXECUTE_WORKFLOW sendResponse failed', e); }
    // Use async IIFE with proper channel management
    (async () => {
      try {
        const workflow = request.payload || {};
        const context = workflow.context || {};
        const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
        const isSynthesis = steps.length === 1 && steps[0]?.stepId === "synthesis_step";
        const isContinuation = steps.length >= 1 && steps.every((s) => s?.stepId === "continuation_step");

        const sessionId = context.sessionId || `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log(`[HTOS] Executing workflow ${sessionId}: ${steps.length} steps, synthesis: ${isSynthesis}, continuation: ${isContinuation}`);

        // Get session for synthesis/continuation
        const session = (__HTOS_SESSIONS[sessionId] = __HTOS_SESSIONS[sessionId] || {
          originalPrompt: "",
          providers: {},
        });

        if (isSynthesis && self.orchestrator) {
          // SYNTHESIS PATH - Use existing synthesis from SW3
          const synthesisProvider = steps[0]?.provider;
          const originalPrompt = session.originalPrompt || context?.variables?.originalPrompt || steps[0]?.payload?.prompt || "";

          let otherResults = Object.entries(session.providers).map(
            ([pid, v]) => ({ providerId: pid, text: v?.text || "" })
          );

          if (otherResults.length === 0 && context?.variables?.allBatchResults) {
            otherResults = Object.entries(context.variables.allBatchResults).map(
              ([pid, text]) => ({ providerId: pid, text: String(text) })
            );
          }

          const meta = {};
          if (synthesisProvider === "claude") {
            meta.chatId = session.providers?.claude?.meta?.chatId || undefined;
          } else if (synthesisProvider === "gemini") {
            meta.cursor = session.providers?.gemini?.meta?.cursor || undefined;
          } else if (synthesisProvider === "chatgpt") {
            // Carry ChatGPT conversation identifiers forward for synthesis
            meta.conversationId = session.providers?.chatgpt?.meta?.conversationId || undefined;
            meta.parentMessageId = session.providers?.chatgpt?.meta?.parentMessageId || undefined;
            meta.messageId = session.providers?.chatgpt?.meta?.messageId || undefined;
          }

          try {
            const res = await self.orchestrator.batchPrompt(originalPrompt, {
              synthesis: {
                only: true,
                providerId: synthesisProvider,
                otherResults,
                meta,
              },
              onPartial: (_pid, chunk) => {
                try {
                  if (chunk && chunk.partial) {
                    const delta = makeDelta(
                      sessionId,
                      synthesisProvider,
                      chunk.text || ""
                    );
                    if (delta) {
                      port.postMessage({
                        type: "SYNTHESIS_PARTIAL",
                        sessionId,
                        payload: { provider: synthesisProvider, text: delta },
                      });
                    }
                  }
                } catch (e) {
                  console.warn(
                    "[HTOS] Failed to stream synthesis partial over port",
                    e
                  );
                }
              },
            });

            const s = res?.synthesis || null;
            try {
              console.log("[HTOS] Synthesis result meta", {
                sessionId,
                synthesisProvider,
                meta: s?.meta,
              });
            } catch {}

            // Persist provider context for potential continuation or subsequent synthesis
            sessionManager.updateProviderContext(
              sessionId,
              synthesisProvider,
              { text: s?.text || "", meta: s?.meta || {} },
              true,
              { skipSave: true }
            );

            // Final synthesis completion over the port
            chrome.runtime.sendMessage({
              type: "SYNTHESIS_COMPLETE",
              sessionId,
              payload: [
                { provider: synthesisProvider, response: s?.text || "" },
              ],
            });
          } catch (error) {
            console.error("[HTOS] Synthesis error:", error);
            chrome.runtime.sendMessage({
              type: "WORKFLOW_ERROR",
              sessionId,
              payload: { phase: "synthesis", provider: synthesisProvider, error: error?.message || "Synthesis failed" },
            });
          }
          }
          else if (isContinuation && self.orchestrator) {
          // CONTINUATION PATH - Use orchestrator batch with providerMeta (unified route)
          const continuationPrompt = context?.variables?.prompt || steps[0]?.payload?.prompt || "";

          const requestedProviders = steps.map(step => String(step.provider));
          const availableProviders = [...new Set(requestedProviders.filter(p => providerRegistry.isAvailable(p)))];
          if (availableProviders.length === 0) {
            chrome.runtime.sendMessage({
              type: "WORKFLOW_ERROR",
              sessionId,
              payload: { phase: "continuation", error: "No available providers" },
            });
            return;
          }

          // Build per-provider continuation meta from session store
          const providerMeta = availableProviders.reduce((acc, pid) => {
            const stored = session.providers?.[pid]?.meta || {};
            if (pid === 'claude' && (stored.chatId || stored.threadUrl)) {
              acc[pid] = { chatId: stored.chatId || stored.threadUrl };
            } else if (pid === 'gemini' && stored.cursor) {
              acc[pid] = { cursor: stored.cursor };
            } else if (pid === 'chatgpt' && (stored.conversationId || stored.parentMessageId)) {
              acc[pid] = {
                conversationId: stored.conversationId,
                parentMessageId: stored.parentMessageId,
                messageId: stored.messageId,
              };
            } else if (Object.keys(stored).length > 0) {
              // Pass through any other provider meta as-is
              acc[pid] = { ...stored };
            }
            return acc;
          }, {});

          console.log('[HTOS] Continuation providerMeta for session', sessionId, providerMeta);
          console.log('[HTOS] Continuation prompt:', continuationPrompt?.slice?.(0, 200));

          try {
            const res = await self.orchestrator.batchPrompt(continuationPrompt, {
              includeProviderIds: availableProviders,
              providerMeta,
              onPartial: (providerId, chunk) => {
                try {
                  if (chunk && chunk.partial) {
                    const delta = makeDelta(sessionId, providerId, chunk.text || "");
                    if (delta) {
                      chrome.runtime.sendMessage({
                        type: "WORKFLOW_PARTIAL",
                        sessionId,
                        payload: { provider: providerId, text: delta },
                      });
                    }
                  }
                } catch (e) {
                  console.warn("[HTOS] Failed to stream continuation partial", e);
                }
              },
            });

            // Persist results back to session store
            for (const r of res?.raw || []) {
              try {
                sessionManager.updateProviderContext(sessionId, r.providerId, r, true, { skipSave: true });
              } catch (e) {
                // Fallback to direct assign if manager fails for any reason
                session.providers[r.providerId] = { text: r?.text || "", meta: r?.meta || {} };
              }
            }

            // Log session state after continuation batch
            try { sessionManager.logSessionState(sessionId); } catch {}
            try { console.log('Session after continuation:', __HTOS_SESSIONS[sessionId]); } catch {}

            // Build step results
            const stepResults = steps.map((step) => {
              const r = (res?.raw || []).find((x) => x.providerId === step.provider);
              if (!r || r.ok === false) {
                return {
                  stepId: step.stepId,
                  provider: step.provider,
                  status: 'failed',
                  error: r?.errorCode || 'provider_failed',
                };
              }
              return {
                stepId: step.stepId,
                provider: step.provider,
                status: 'completed',
                result: { response: r.text ?? '' },
              };
            });

            const responses = availableProviders.map(pid => ({
              providerId: pid,
              text: (resultMap.get(pid)?.text) || (errorMap.get(pid)?.message) || ''
            }));

            // Ensure we save the final session state
            console.log('[HTOS] About to save final session state for', sessionId);
            try {
              await sessionManager.saveSession(sessionId);
              console.log('[HTOS] Final session state saved for', sessionId);
            } catch (saveError) {
              console.error('[HTOS] Failed to save final session state:', saveError);
            }

            // Send completion message
            chrome.runtime.sendMessage({
              type: "WORKFLOW_COMPLETE",
              sessionId,
              stepResults,
              results: responses,
              payload: { stepResults, responses }
            });

          } catch (e) {
            console.error('[HTOS] Continuation workflow error:', e);
            chrome.runtime.sendMessage({
              type: 'WORKFLOW_ERROR',
              sessionId,
              payload: { phase: 'continuation', error: e?.message || String(e) },
            });
          }

        } else {
          // BATCH FANOUT PATH - Use fault-tolerant orchestrator
          const originalPrompt = context?.variables?.originalPrompt || steps[0]?.payload?.prompt || "";
          if (!session.originalPrompt) {
            session.originalPrompt = String(originalPrompt || "");
          }

          // Reset provider results for this new batch workflow run to avoid stale results blocking completion
          session.providers = {};

          const providers = steps.map(step => step.provider);
          // Ensure we count each provider only once to avoid mismatched completion checks
          const availableProviders = [...new Set(providers.filter(p => providerRegistry.isAvailable(p)))];
          
          if (availableProviders.length === 0) {
            chrome.runtime.sendMessage({
              type: "WORKFLOW_ERROR",
              sessionId,
              payload: { phase: "batch", error: "No available providers" },
            });
            return;
          }

          // Execute parallel fanout
          await self.faultTolerantOrchestrator.executeParallelFanout(
            originalPrompt,
            availableProviders,
            {
              onAllComplete: (resultMap, errorMap) => {
                try {
                  console.log('[HTOS] onAllComplete fired for session', sessionId);
                  // Get current session state for all providers
                  const session = sessionManager.getOrCreateSession(sessionId);
                  const providerStates = availableProviders.map(providerId => ({
                    provider: providerId,
                    status: resultMap.has(providerId) ? 'completed' : 'failed',
                    text: resultMap.get(providerId)?.text || '',
                    error: errorMap.get(providerId)?.message
                  }));
                  
                  // Update all provider contexts in memory first without saving
                  providerStates.forEach(state => {
                    if (state.status === 'completed') {
                      sessionManager.updateProviderContext(
                        sessionId,
                        state.provider,
                        { 
                          text: state.text,
                          meta: { 
                            status: 'completed',
                            completedAt: new Date().toISOString()
                          }
                        },
                        true,  // preserveChat
                        { skipSave: true }  // Skip individual saves, will save once at the end
                      );
                    }
                  });
                  
                  // Single final save of the session with all updates
                  console.log('[HTOS] Starting final save for session', sessionId);
                  try {
                    const savePromise = sessionManager.saveSession(sessionId);
                    console.log('[HTOS] Save promise created for', sessionId);
                    
                    savePromise.then(() => {
                      console.log('[HTOS] Final session state saved for', sessionId);
                      
                      // Prepare step results
                      const stepResults = availableProviders.map(providerId => {
                        const state = providerStates.find(s => s.provider === providerId);
                        const res = resultMap.get(providerId);
                        const err = errorMap.get(providerId);
                        return {
                          stepId: providerId,
                          provider: providerId,
                          status: res ? 'completed' : 'failed',
                          result: res ? { response: res.text || '' } : undefined,
                          error: res ? undefined : (err?.message || 'provider_failed')
                        };
                      });
                      
                      // Single consolidated message send
                      chrome.runtime.sendMessage({
                        type: 'WORKFLOW_COMPLETE',
                        sessionId,
                        results: providerStates,
                        payload: {
                          stepResults,
                          responses: providerStates.map(state => ({
                            provider: state.provider,
                            response: state.text || ''
                          }))
                        }
                      });
                    }).catch(err => {
                      console.error('[HTOS] Failed to save final session state:', err);
                      // Still send the message even if save fails
                      chrome.runtime.sendMessage({ 
                        type: 'WORKFLOW_COMPLETE',
                        sessionId,
                        results: providerStates,
                        error: 'Failed to save session state',
                        payload: {
                          stepResults: availableProviders.map(providerId => ({
                            stepId: providerId,
                            provider: providerId,
                            status: 'failed',
                            error: 'Failed to save session state'
                          }))
                        }
                      });
                    });
                  } catch (saveError) {
                    console.error('[HTOS] Error during save process:', saveError);
                    // Ensure we still send the completion message even if save setup fails
                    chrome.runtime.sendMessage({
                      type: 'WORKFLOW_COMPLETE',
                      sessionId,
                      results: providerStates,
                      error: 'Error during save process',
                      payload: {
                        stepResults: availableProviders.map(providerId => ({
                          stepId: providerId,
                          provider: providerId,
                          status: 'failed',
                          error: 'Error during save process'
                        }))
                      }
                    });
                  }
                } catch(e) {
                  console.warn('[HTOS] Failed to process workflow completion:', e);
                  // Send error message if something fails during processing
                  chrome.runtime.sendMessage({
                    type: 'WORKFLOW_COMPLETE',
                    sessionId,
                    error: `Processing error: ${e.message}`,
                    results: availableProviders.map(providerId => ({
                      provider: providerId,
                      status: 'failed',
                      error: e.message
                    }))
                  });
                } finally {
                  try { console.log('[HTOS] Session after batch:', __HTOS_SESSIONS[sessionId]); } catch {}
                  try { sessionManager.logSessionState(sessionId); } catch {}
                }
              },
              sessionId,
              onPartial: (providerId, chunk) => {
                try {
                  if (chunk && chunk.partial) {
                    const delta = makeDelta(sessionId, providerId, chunk.text || "");
                    if (delta) {
                      chrome.runtime.sendMessage({
                        type: "WORKFLOW_PARTIAL",
                        sessionId,
                        payload: { provider: providerId, text: delta },
                      });
                    }
                  }
                } catch (e) {
                  console.warn("[HTOS] Failed to stream workflow partial", e);
                }
              },
              onProviderComplete: (providerId, result) => {
                session.providers[providerId] = { 
                  text: result?.text || "", 
                  meta: result?.meta || {} 
                };
                try { console.log('[HTOS] onProviderComplete meta', { sessionId, providerId, meta: result?.meta }); } catch {}
                
                // Update session context with result for future continuations
                if (result && sessionId) {
                  sessionManager.updateProviderContext(sessionId, providerId, result, true, { skipSave: true });
                }
                
                console.log('Providers map now:', session.providers, 'waiting for', availableProviders.length);
              },
              onError: (providerId, error) => {
                // Mark provider as failed but continue with others
                console.log(`[HTOS] Provider ${providerId} failed in workflow:`, error.message);

                // Record failure so it counts towards completion checks
                session.providers[providerId] = { error: error?.message || "provider_failed" };

                // Check if we should send completion (all providers done/failed)
                const processedCount = Object.keys(session.providers).length;

                if (processedCount >= availableProviders.length) {
                  const stepResults = steps.map((step) => {
                    const entry = session.providers[step.provider];
                    const success = entry && entry.text !== undefined;
                    return {
                      stepId: step.stepId,
                      provider: step.provider,
                      status: success ? "completed" : "failed",
                      result: success ? { response: entry.text } : undefined,
                      error: success ? undefined : entry?.error || "provider_failed"
                    };
                  });

                  const responses = availableProviders.map(pid => ({
                    provider: pid,
                    response: (session.providers[pid] && session.providers[pid].text) || ""
                  }));

                  chrome.runtime.sendMessage({
                    type: "WORKFLOW_COMPLETE",
                    sessionId,
                    results: responses,
                    payload: { stepResults, responses },
                  });
                }
              }
            }
          );
        }
      } catch (e) {
        console.error("[HTOS] Failed to execute workflow", e);
        chrome.runtime.sendMessage({
          type: "WORKFLOW_ERROR",
          sessionId: request.payload?.context?.sessionId || "unknown",
          payload: { phase: "execution", error: e?.message || String(e) },
        });
      }
    })();
    // No further response expected; channel can close safely
  }

  // ChatGPT specific methods - fault tolerant handling
  const handleChatGPTMessage = async (handler) => {
    try {
      let controller = providerRegistry.getController('chatgpt');
      if (!controller) {
        console.log("[HTOS] Creating ChatGPT controller on demand...");
        controller = new ChatGPTProviderController();
        // Don't init - let the adapter handle its own complexity
        const adapter = new ChatGPTAdapter(controller);
        providerRegistry.register('chatgpt', controller, adapter);
        // Expose created instances to global self for console/runtime access
        try {
          self.chatgptController = controller;
          self.chatgptAdapter = adapter;
        } catch (e) {}
      }
      
      const result = await handler(controller);
      sendResponse({ success: true, data: result });
    } catch (error) {
      console.error(`[HTOS] ChatGPT ${request.type} error:`, error);
      sendResponse({ 
        success: false, 
        error: error?.message || String(error),
        code: error?.code || 'CHATGPT_ERROR',
        retryable: error?.retryable !== false
      });
    }
  };

  if (request.type.startsWith("CHATGPT_") || request.type === "GET_CHATGPT_ACCESS_TOKEN") {
    // Use setTimeout to prevent message channel issues
    setTimeout(() => {
      handleChatGPTMessage(async (provider) => {
        console.log(`[HTOS] Handling ChatGPT method: ${request.type}`);
        switch (request.type) {
          case "GET_CHATGPT_ACCESS_TOKEN":
            return await provider._getAccessToken();
          case "CHATGPT_CHECK_REQUIREMENTS":
            return await provider._fetchRequirements();
          case "CHATGPT_TEST_ARKOSE":
            const requirements = await provider._fetchRequirements();
            return {
              arkoseRequired: requirements?.arkose?.required || false,
              powRequired: requirements?.proofofwork?.required || false,
              requirements,
            };
          case "CHATGPT_GET_STATUS":
            const hasOffscreen = await chrome.offscreen.hasDocument();
            return {
              initialized: !!provider,
              offscreenReady: hasOffscreen,
              adapterAvailable: providerRegistry.isAvailable('chatgpt'),
              timestamp: Date.now(),
            };
          case "CHATGPT_GENERATE_PROOF":
            const { seed, difficulty } = request.payload || {};
            if (!seed || !difficulty) {
              throw new Error("Missing seed or difficulty for proof generation");
            }
            return await provider._generateProofToken(seed, difficulty);
          case "CHATGPT_RETRIEVE_ARKOSE":
            const { dx } = request.payload || {};
            if (!dx) {
              throw new Error("Missing dx blob for Arkose retrieval");
            }
            return await provider._retrieveArkoseToken(dx);
          default:
            throw new Error(`Unknown ChatGPT request type: ${request.type}`);
        }
      });
    }, 0);
    return true;
  }

  // History endpoints - backend is source of truth
  if (reqType === 'GET_FULL_HISTORY') {
    try {
      const sessions = Object.values(sessionManager.sessions || {}).map((s) => {
        const turns = Array.isArray(s.turns) ? s.turns : [];
        const firstUserText = (turns[0]?.user?.text) || s.originalPrompt || '';
        const createdAt = s.createdAt || (turns[0]?.createdAt) || s.lastActivity || Date.now();
        const lastActivity = s.lastActivity || createdAt;
        const messageCount = Math.max(0, turns.length * 2);
        return {
          id: s.sessionId,
          sessionId: s.sessionId,
          title: (firstUserText || 'New Chat'),
          startTime: createdAt,
          lastActivity,
          messageCount,
          firstMessage: firstUserText
        };
      }).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
      sendResponse({ success: true, data: { sessions } });
    } catch (e) {
      sendResponse({ success: false, error: { message: e?.message || 'Failed to read history' } });
    }
    return true;
  }

  if (reqType === 'GET_HISTORY_SESSION') {
    try {
      const sessionId = request?.payload?.sessionId || request?.sessionId;
      const s = sessionManager.sessions[sessionId];
      if (!s) {
        sendResponse({ success: false, error: { message: 'Session not found' } });
        return true;
      }
      const turns = Array.isArray(s.turns) ? s.turns : [];
      const providerContexts = sessionManager.getProviderContexts(sessionId) || {};
      const createdAt = s.createdAt || (turns[0]?.createdAt) || s.lastActivity || Date.now();
      const lastActivity = s.lastActivity || createdAt;
      const title = (turns[0]?.user?.text) || s.title || s.originalPrompt || 'New Chat';
      sendResponse({
        success: true,
        data: {
          id: sessionId,
          sessionId,
          title,
          createdAt,
          lastActivity,
          turns,
          providerContexts
        }
      });
    } catch (e) {
      sendResponse({ success: false, error: { message: e?.message || 'Failed to load session' } });
    }
    return true;
  }

  if (reqType === 'GET_LAST_ESCALATION') {
    sendResponse({ success: true, data: null });
    return true;
  }

  if (reqType === 'GET_SYSTEM_STATUS') {
    sendResponse({ success: true, data: {
      availableProviders: providerRegistry.listProviders(),
      activeRequests: self.faultTolerantOrchestrator?.getActiveRequestCount?.() || 0,
      offscreenReady: true,
      busReady: !!self.bus,
      orchestratorReady: !!self.orchestrator,
      timestamp: Date.now()
    }});
    return true;
  }

  // Handle lifecycle/liveness messages emitted by SW/orchestrator to avoid noisy logs
  if (reqType === 'htos.keepalive' || reqType === '__htos_keepalive' || reqType === 'workflow.start' || reqType === 'workflow.end') {
    try {
      // Optionally record a lightweight heartbeat metric
      try { healthMonitor?.recordRequest?.('keepalive'); } catch (e) {}
      // Acknowledge silently so callers don't see Unknown-type warnings
      if (typeof sendResponse === 'function') sendResponse({ success: true });
    } catch (e) {}
    return true;
  }

  // Graceful degradation for unknown message types
  console.warn("[HTOS] Unknown message type:", request.type);
  sendResponse({ 
     success: false, 
     error: "Unknown message type",
     type: request.type,
    supportedTypes: Object.keys(typeof historyResponses !== 'undefined' && historyResponses ? historyResponses : {}).concat([
       'EXECUTE_WORKFLOW', 
       'CHATGPT_*', 
       'GET_CHATGPT_ACCESS_TOKEN',
       'bypassCSP'
     ])
   });
   return true;
});


// =============================================================================
// SYSTEM HEALTH MONITORING
// =============================================================================
class SystemHealthMonitor {
  constructor() {
    this.metrics = {
      startTime: Date.now(),
      totalRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      providerStats: new Map()
    };
    
    // Start health check interval
    setInterval(() => this.performHealthCheck(), 60000); // Every minute
  }

  recordRequest(sessionId) {
    this.metrics.totalRequests++;
  }

  recordCompletion(sessionId, duration, providerId, success = true) {
    if (success) {
      this.metrics.completedRequests++;
    } else {
      this.metrics.failedRequests++;
    }
    
    // Update provider stats
    if (!this.metrics.providerStats.has(providerId)) {
      this.metrics.providerStats.set(providerId, {
        requests: 0,
        successes: 0,
        failures: 0,
        totalTime: 0
      });
    }
    
    const providerStats = this.metrics.providerStats.get(providerId);
    providerStats.requests++;
    providerStats.totalTime += duration;
    
    if (success) {
      providerStats.successes++;
    } else {
      providerStats.failures++;
    }
    
    // Update average response time
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (this.metrics.completedRequests - 1) + duration) 
      / this.metrics.completedRequests;
  }

  async performHealthCheck() {
    const uptime = Date.now() - this.metrics.startTime;
    const hasOffscreen = await chrome.offscreen.hasDocument();
    
    console.log("[HTOS] Health Check:", {
      uptime: `${Math.floor(uptime / 1000)}s`,
      totalRequests: this.metrics.totalRequests,
      successRate: `${((this.metrics.completedRequests / this.metrics.totalRequests) * 100 || 0).toFixed(1)}%`,
      averageResponseTime: `${this.metrics.averageResponseTime.toFixed(0)}ms`,
      activeConnections: eventRouter.activeConnections.size,
      activeRequests: self.faultTolerantOrchestrator.getActiveRequestCount(),
      offscreenReady: hasOffscreen,
      availableProviders: providerRegistry.listProviders()
    });
  }

  getMetrics() {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime,
      providerStats: Object.fromEntries(this.metrics.providerStats)
    };
  }
}

const healthMonitor = new SystemHealthMonitor();

// =============================================================================
// CLEANUP AND ERROR RECOVERY
// =============================================================================
self.addEventListener('error', (event) => {
  console.error('[HTOS] Global error:', event.error);
  healthMonitor.recordCompletion('global-error', 0, 'system', false);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[HTOS] Unhandled promise rejection:', event.reason);
  healthMonitor.recordCompletion('unhandled-promise', 0, 'system', false);
});

// Graceful cleanup on service worker suspension
self.addEventListener('beforeunload', () => {
  console.log('[HTOS] Service worker suspending, cleaning up...');
  // Abort any active requests
  // Note: Service workers don't actually get beforeunload, but this is here for completeness
});

console.log('[HTOS] Service Worker initialized with parallel fault-tolerant architecture');
console.log('[HTOS] Available providers at startup:', providerRegistry.listProviders());
console.log('[HTOS] System ready for parallel fanout operations');