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
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { DNRUtils } from "./core/dnr-utils.js";

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

// Helper function to build synthesis prompt
function buildSynthesisPrompt(originalPrompt, batchResults, synthesisProvider) {
  const otherResults = Object.entries(batchResults)
    .filter(([providerId]) => providerId !== synthesisProvider)
    .map(([providerId, text]) => `**${providerId.toUpperCase()}:**\n${text}`)
    .join('\n\n');

  return `You are tasked with synthesizing multiple AI responses into a single, comprehensive answer.

**Original User Query:**
${originalPrompt}

**Responses from other AI models:**
${otherResults}

**Instructions:**
- Synthesize the above responses into a single, well-structured answer
- Identify common themes and reconcile any contradictions
- Provide the most accurate and helpful response possible
- Do not simply concatenate the responses - create a cohesive synthesis
- If the responses disagree, explain the different perspectives and provide your best judgment
- Maintain a natural, conversational tone

Please provide your synthesized response:`;
}

// Helper function to build Ensemble prompt (mirrors UI's buildEnsemblerPrompt)
function buildEnsemblerPrompt(userPrompt, modelOutputsMap) {
  try {
    const entries = Object.entries(modelOutputsMap || {}).filter(([_, t]) => (t || '').trim().length > 0);
    const modelOutputsBlock = entries
      .map(([providerId, text]) => `=== ${String(providerId).toUpperCase()} ===\n${String(text)}`)
      .join('\n\n');

    const tpl = `You are not a synthesizer. You are a mirror that reveals what others cannot see.
Task: Present ALL insights from the models below in their most useful form for decision-making on "(user's Prompt)".
Critical instruction: Do NOT synthesize into a single answer. Instead, reason internally via this structure—then output ONLY as seamless, narrative prose that implicitly embeds it all:
Map the landscape — Group similar ideas, preserving tensions and contradictions.
Surface the invisible — Highlight consensus (2+ models), unique sightings (one model) as natural flow.
Frame the choices — present alternatives as "If you prioritize X, this path fits because Y."
Flag the unknowns — Note disagreements/uncertainties as subtle cautions.
Internal format for reasoning (NEVER output directly):
What Everyone Sees (consensus)
Point 1
Point 2
The Tensions (disagreements)
Option A: [suggestion X] implies...
Option B: [suggestion Y] posits...
The Unique Insights
[suggestion]: Overlooked angle...
The Choice Framework
If priority [goal 1]: lean toward [option]
If priority [goal 2]: lean toward [option]
Confidence Check
- High confidence: [what's solid]
- Check this: [what needs verification]
- Unknown: [what's missing]


finally output your response as a narrative explaining everything implicitly to the user, like a natural response to the users prompt fluid, insightful, redacting model names/extraneous details. Build feedback as emergent wisdom—evoke clarity, agency, and subtle awe. Weave your final narrative as representation of a cohesive response of the collective thought  to the users prompt:

User Prompt: ${String(userPrompt || '')}

Model outputs to analyze:
${modelOutputsBlock}`;
    return tpl;
  } catch (e) {
    console.warn('[HTOS] buildEnsemblerPrompt failed, falling back to raw prompt', e);
    return String(userPrompt || '');
  }
}

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
          if (signal?.aborted) return;
          onPartial(chunk);
        },
        signal
      );

      if (signal?.aborted) return;

      console.log(
        `[FaultTolerantOrchestrator] Provider ${providerId} completed successfully`
      );
      onComplete(result);
    } catch (error) {
      if (signal?.aborted) return;
      
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
            if (signal?.aborted) return;
            onPartial(chunk);
          },
          signal
        );

        if (signal?.aborted) return;
        onComplete(result);
        return;
      }

      // Use continuation method with preserved context
      const result = await adapter.sendContinuation(
        prompt,
        providerContext,
        sessionId,
        (chunk) => {
          if (signal?.aborted) return;
          onPartial(chunk);
        },
        signal
      );

      if (signal?.aborted) return;
      
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
      if (signal?.aborted) return;
      
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

        // Soft-timeout support: don't abort background work on UI timeout.
        // Track per-session timeout timer and completed providers so we can
        // notify UI and persist late results for popup reconnection.
        self._sessionTimeoutTimers = self._sessionTimeoutTimers || new Map();
        self._timedOutSessions = self._timedOutSessions || new Set();
        const timeoutTimers = self._sessionTimeoutTimers;
        const timedOutSessions = self._timedOutSessions;
        const completedProviders = new Set();
        const timeoutMs = (self.orchestrator && self.orchestrator.opts && self.orchestrator.opts.globalTimeoutMs) ? self.orchestrator.opts.globalTimeoutMs : 45000;

        // Start a soft UI timeout: after timeoutMs, tell UI to stop streaming but keep background work alive
        try {
          const t = setTimeout(() => {
            try {
              timedOutSessions.add(capturedSessionId);
              const pending = availableProviders.filter(p => !completedProviders.has(p));
              port.postMessage({
                type: 'timed_out',
                sessionId: capturedSessionId,
                message: 'Request timed out (UI-level). Background providers may complete later.',
                pendingProviders: pending
              });
            } catch (e) {
              console.warn('[HTOS] Failed to emit timed_out message to port', e);
            }
            // Persist current session state so popup reconnect can reconcile
            try { sessionManager.saveSession(capturedSessionId).catch(()=>{}); } catch(e){}
          }, timeoutMs);
          timeoutTimers.set(capturedSessionId, t);
        } catch (e) {
          console.warn('[HTOS] Failed to start soft timeout timer', e);
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
                 // Clear soft-timeout timer if present
                 try {
                   const t = timeoutTimers.get(capturedSessionId);
                   if (t) { clearTimeout(t); timeoutTimers.delete(capturedSessionId); }
                   timedOutSessions.delete(capturedSessionId);
                 } catch (e) {}
 
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
                 // Mark provider as completed for timeout/pending calculations
                 try { completedProviders.add(providerId); } catch {}
 
                 // If the UI already timed out for this session, persist per-provider results immediately
                 const saveNow = timedOutSessions.has(capturedSessionId);
                 try {
                   sessionManager.updateProviderContext(capturedSessionId, providerId, result, true, { skipSave: !saveNow });
                 } catch (e) {
                   console.warn('[HTOS] updateProviderContext failed', e);
                 }
                 // Also persist into the current round transcript; save if timed out
                 try { sessionManager.updateRoundProvider(capturedSessionId, roundId, providerId, result, { skipSave: !saveNow }); } catch (e) { console.warn('[HTOS] updateRoundProvider failed', e); }
 
                 // If we saved now because UI timed out (and maybe disconnected), ensure session persisted so popup can reconcile
                 if (saveNow) {
                   try { sessionManager.saveSession(capturedSessionId).catch(()=>{}); } catch(e){}
                 }
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

      if (message.type === "sendPromptWithSynthesis") {
        const { prompt, providers, synthesisProvider, sessionId, useThinking } = message;
        console.log(`[HTOS] Processing synthesis-first prompt for ${providers.length} providers with synthesis by ${synthesisProvider}`);

        // Validate providers
        const availableProviders = providers.filter(p => providerRegistry.isAvailable(p));
        if (availableProviders.length === 0) {
          port.postMessage({ type: "error", data: { message: "No available providers", code: "NO_PROVIDERS" } });
          return;
        }
        // Validate synthesis provider
        const synthId = String(synthesisProvider || '').toLowerCase();
        if (!providerRegistry.isAvailable(synthId)) {
          port.postMessage({ type: "error", data: { message: `Synthesis provider ${synthId} not available`, code: "SYNTHESIS_PROVIDER_UNAVAILABLE" } });
          return;
        }

        // Acknowledge start
        port.postMessage({
          type: "result",
          providerId: "system",
          text: `Gathering sources from ${availableProviders.length} provider(s) before synthesis by ${synthId}...`,
          ok: true,
          partial: false
        });

        const capturedSessionId = sessionId || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log('[HTOS] Using capturedSessionId for sendPromptWithSynthesis:', capturedSessionId);
        try { sessionManager.getOrCreateSession(capturedSessionId, String(prompt || "")); } catch {}
        try { port.postMessage({ type: "session", sessionId: capturedSessionId }); } catch {}

        const roundId = sessionManager.beginRound(capturedSessionId, String(prompt || ""));

        // Track hidden results and progress
        const totalProviders = availableProviders.length;
        let completed = 0;
        let succeeded = 0;
        const hiddenResults = new Map(); // providerId -> text

        // Execute hidden batch (include synthesizer)
        await self.faultTolerantOrchestrator.executeParallelFanout(
          prompt,
          availableProviders,
          {
            sessionId: capturedSessionId,
            useThinking: Boolean(useThinking),
            onPartial: () => {}, // suppress partials for hidden batch
            onProviderComplete: (providerId, result) => {
              if (result && capturedSessionId) {
                try { sessionManager.updateProviderContext(capturedSessionId, providerId, result, true, { skipSave: true }); } catch {}
                try { sessionManager.updateRoundProvider(capturedSessionId, roundId, providerId, result, { skipSave: true }); } catch {}
              }
              const text = result?.text || '';
              hiddenResults.set(providerId, text);
              completed += 1;
              if (result?.ok !== false && (text || '').trim().length > 0) succeeded += 1;
              // Emit revealable snapshot and progress
              try {
                port.postMessage({ type: 'HIDDEN_BATCH_RESULT', sessionId: capturedSessionId, providerId, text, ok: result?.ok !== false, meta: result?.meta || {} });
                port.postMessage({ type: 'HIDDEN_BATCH_PROGRESS', sessionId: capturedSessionId, payload: { completed, total: totalProviders, succeeded } });
              } catch {}
            },
            onError: (providerId, error) => {
              completed += 1;
              try {
                port.postMessage({ type: 'HIDDEN_BATCH_RESULT', sessionId: capturedSessionId, providerId, text: '', ok: false, error: error?.message || 'Provider error' });
                port.postMessage({ type: 'HIDDEN_BATCH_PROGRESS', sessionId: capturedSessionId, payload: { completed, total: totalProviders, succeeded } });
              } catch {}
            },
            onAllComplete: async (resultsMap, errorsMap) => {
              try {
                const successCount = Array.from(resultsMap.values())
                  .filter(r => r && r.ok !== false && (r.text || '').trim().length > 0)
                  .length;
                const errorCount = (errorsMap && typeof errorsMap.size === 'number')
                  ? errorsMap.size
                  : Array.from(errorsMap.values()).length;
                // Fail count should include both explicit errors and non-text/empty successes
                // This simplifies to totalProviders - successCount
                const failCount = Math.max(0, totalProviders - successCount);

                try {
                  // Build batch results object for UI to reveal sources under synthesis
                  const batchResults = {};
                  for (const pid of availableProviders) {
                    const res = resultsMap.get(pid);
                    const err = (errorsMap && typeof errorsMap.get === 'function') ? errorsMap.get(pid) : undefined;
                    const txt = (res && typeof res.text === 'string') ? res.text : (hiddenResults.get(pid) || '');
                    const ok = !err && (res ? (res.ok !== false) : ((txt || '').trim().length > 0));
                    batchResults[pid] = {
                      providerId: pid,
                      text: txt || '',
                      status: ok ? 'completed' : 'error',
                      meta: (res && res.meta) ? res.meta : {}
                    };
                  }

                  // Emit hidden batch complete with both payload and top-level batchResults for wider UI compatibility
                  port.postMessage({
                    type: 'HIDDEN_BATCH_COMPLETE',
                    sessionId: capturedSessionId,
                    batchResults,
                    payload: { successCount, failCount, errorCount, batchResults }
                  });
                } catch (emitErr) {
                  console.warn('[HTOS] Failed to emit HIDDEN_BATCH_COMPLETE', emitErr);
                }

                // Build ok-text map for gating
                const okTextsByProvider = new Map();
                for (const pid of availableProviders) {
                  const res = resultsMap.get(pid);
                  const txt = res?.text || hiddenResults.get(pid) || '';
                  if (res && res.ok !== false && (txt || '').trim().length > 0) okTextsByProvider.set(pid, txt);
                }

                const otherOk = Array.from(okTextsByProvider.keys()).filter(pid => pid !== synthId);
                // Proceed to synthesis as long as we have at least one non-synth source.
                // Do NOT gate on synthesizer producing batch text; synthesis can start a new turn.
                const enoughSources = (otherOk.length >= 1);

                if (!enoughSources) {
                  // Fallback to normal batch round (no synthesis)
                  try { port.postMessage({ type: 'SYNTHESIS_SKIPPED_NO_SOURCES', sessionId: capturedSessionId, payload: { synthProvider: synthId, otherCount: otherOk.length } }); } catch {}

                  try { sessionManager.completeRound(capturedSessionId, roundId, { skipSave: true }); } catch {}
                  const stepResults = Array.from(resultsMap.entries()).map(([providerId, res]) => ({
                    providerId,
                    ok: res?.ok !== false,
                    text: res?.text || '',
                    meta: res?.meta || {}
                  }));
                  const responses = Object.fromEntries(stepResults.map(r => [r.providerId, { text: r.text }]));
                  port.postMessage({ type: 'WORKFLOW_COMPLETE', sessionId: capturedSessionId, stepResults, results: responses, payload: { stepResults, responses } });
                  try { sessionManager.saveSession(capturedSessionId).catch(() => {}); } catch {}
                  return;
                }

                // Proceed to synthesis using orchestrator meta prompt
                const providerContexts = sessionManager.getProviderContexts(capturedSessionId) || {};
                const otherResults = otherOk.map(pid => ({ providerId: pid, text: okTextsByProvider.get(pid) || '' }));

                // Build synthesizer meta for continuation when possible
                const meta = {};
                const synthMeta = providerContexts[synthId]?.meta || {};
                if (synthId === 'claude' && (synthMeta.chatId || synthMeta.threadUrl)) meta.chatId = synthMeta.chatId || synthMeta.threadUrl;
                else if (synthId === 'gemini' && synthMeta.cursor) meta.cursor = synthMeta.cursor;
                else if (synthId === 'chatgpt') {
                  if (synthMeta.conversationId) meta.conversationId = synthMeta.conversationId;
                  if (synthMeta.parentMessageId) meta.parentMessageId = synthMeta.parentMessageId;
                  if (synthMeta.messageId) meta.messageId = synthMeta.messageId;
                  if (Boolean(useThinking)) meta.useThinking = true; // optional think-mode for ChatGPT
                } else if (synthId === 'qwen') {
                  if (synthMeta.sessionId) meta.sessionId = synthMeta.sessionId;
                  if (synthMeta.parentMsgId) meta.parentMsgId = synthMeta.parentMsgId;
                }

                try { port.postMessage({ type: 'SYNTHESIS_STARTING', sessionId: capturedSessionId, payload: { provider: synthId, sources: otherResults.length } }); } catch {}

                // Execute synthesis first
                const res = await self.orchestrator.batchPrompt(String(prompt || ''), {
                  synthesis: {
                    only: true,
                    providerId: synthId,
                    otherResults,
                    meta,
                  },
                  onPartial: (_pid, chunk) => {
                    if (chunk && chunk.partial) {
                      const delta = makeDelta(capturedSessionId, synthId, chunk.text || '');
                      if (delta) {
                        try { port.postMessage({ type: 'SYNTHESIS_PARTIAL', sessionId: capturedSessionId, payload: { provider: synthId, text: delta } }); } catch {}
                      }
                    }
                  }
                });

                const s = res?.synthesis || null;
                const synthesisText = s?.text || '';
                
                // Persist synthesized result and its sources
                try {
                  sessionManager.updateProviderContext(capturedSessionId, synthId, { text: synthesisText, meta: { ...(s?.meta || {}), sources: Object.fromEntries(hiddenResults) } }, true, { skipSave: true });
                  sessionManager.updateRoundProvider(capturedSessionId, roundId, synthId, { text: synthesisText, meta: { ...(s?.meta || {}), sources: Object.fromEntries(hiddenResults) } }, { skipSave: true });
                } catch {}

                // Emit synthesis completion
                try { port.postMessage({ type: 'SYNTHESIS_COMPLETE', sessionId: capturedSessionId, providerId: synthId, text: synthesisText, ok: s?.ok !== false, payload: [{ provider: synthId, response: synthesisText }] }); } catch {}

                // Now run ensemble AFTER synthesis completes (sequential execution)
                let ensembleProviderId = 'gemini';
                if (synthId === 'gemini') {
                  if (availableProviders.includes('claude')) ensembleProviderId = 'claude';
                  else if (availableProviders.includes('chatgpt')) ensembleProviderId = 'chatgpt';
                  else {
                    const fallback = availableProviders.find(pid => pid !== synthId);
                    if (fallback) ensembleProviderId = fallback;
                  }
                }
                const runEnsemble = ensembleProviderId && ensembleProviderId !== synthId && providerRegistry.isAvailable(ensembleProviderId);
                
                if (runEnsemble) {
                  // Include synthesis output in ensemble inputs
                  const modelOutputsForEnsemble = {
                    [synthId]: synthesisText,
                    ...Object.fromEntries(
                      otherResults
                        .filter(r => r.providerId !== ensembleProviderId)
                        .map(r => [r.providerId, r.text])
                    )
                  };
                  const ensemblePrompt = buildEnsemblerPrompt(String(prompt || ''), modelOutputsForEnsemble);

                  try {
                    const ensembleResult = await self.faultTolerantOrchestrator._executeProviderRequest(
                      ensembleProviderId,
                      ensemblePrompt,
                      capturedSessionId,
                      new AbortController().signal,
                      {
                        onPartial: () => {},
                        onComplete: (result) => {
                          const text = result?.text || '';
                          try {
                            sessionManager.updateProviderContext(
                              capturedSessionId,
                              ensembleProviderId,
                              { text, meta: { ...(result?.meta || {}), ensembleOf: Object.keys(modelOutputsForEnsemble || {}) } },
                              true,
                              { skipSave: true }
                            );
                            sessionManager.updateRoundProvider(
                              capturedSessionId,
                              roundId,
                              ensembleProviderId,
                              { text, meta: { ...(result?.meta || {}), ensembleOf: Object.keys(modelOutputsForEnsemble || {}) } },
                              { skipSave: true }
                            );
                          } catch {}

                          try {
                            port.postMessage({
                              type: 'ENSEMBLE_COMPLETE',
                              sessionId: capturedSessionId,
                              providerId: ensembleProviderId,
                              text,
                              ok: result?.ok !== false,
                              meta: { ...(result?.meta || {}), ensembleOf: Object.keys(modelOutputsForEnsemble || {}) }
                            });
                          } catch (emitErr) {
                            console.warn('[HTOS] Failed to emit ENSEMBLE_COMPLETE', emitErr);
                          }
                        },
                        onError: (err) => {
                          try {
                            port.postMessage({ type: 'ENSEMBLE_COMPLETE', sessionId: capturedSessionId, providerId: ensembleProviderId, text: '', ok: false, error: err?.message || 'Ensemble error' });
                          } catch {}
                        }
                      }
                    );
                  } catch (ensembleErr) {
                    console.warn('[HTOS] Ensemble execution failed', ensembleErr);
                    try {
                      port.postMessage({ type: 'ENSEMBLE_COMPLETE', sessionId: capturedSessionId, providerId: ensembleProviderId, text: '', ok: false, error: ensembleErr?.message || 'Ensemble error' });
                    } catch {}
                  }
                }

                // After both synthesis and ensemble complete, reveal hidden batch outputs
                try {
                  port.postMessage({
                    type: 'HIDDEN_BATCH_REVEAL',
                    sessionId: capturedSessionId,
                    batchResults: Object.fromEntries(hiddenResults),
                    payload: { batchResults: Object.fromEntries(hiddenResults) }
                  });
                } catch {}

                // Wrap up
                try { sessionManager.completeRound(capturedSessionId, roundId, { skipSave: true }); } catch {}
                try { sessionManager.saveSession(capturedSessionId).catch(() => {}); } catch {}
                try { port.postMessage({ type: 'WORKFLOW_COMPLETE', sessionId: capturedSessionId, stepResults: [{ providerId: synthId, ok: s?.ok !== false, text: synthesisText }], results: { [synthId]: { text: synthesisText } } }); } catch {}

              } catch (e) {
                console.error('[HTOS] synthesis-first onAllComplete failed', e);
                // As a last resort, try to finalize the round and surface batch-only results
                try { sessionManager.completeRound(capturedSessionId, roundId, { skipSave: true }); } catch {}
                const batchOnly = Object.fromEntries(Array.from(hiddenResults.entries()).map(([pid, text]) => [pid, { text }]));
                try { port.postMessage({ type: 'WORKFLOW_COMPLETE', sessionId: capturedSessionId, results: batchOnly }); } catch {}
              }
            }
          }
        );

        console.log(`[HTOS] Synthesis-first workflow initiated with session: ${capturedSessionId}`);
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
      if (NetRulesManager && typeof NetRulesManager.init === 'function') {
        // Simplified: call init directly. Let errors propagate to the outer init flow
        await NetRulesManager.init();
        console.log("[HTOS] ✓ NetRulesManager initialized");
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

      // Ensure Qwen DNR rules are cleared on startup to avoid stale/orphaned rules
      try {
        await DNRUtils.initialize(); // idempotent
        await DNRUtils.removeProviderRules('qwen');
        console.log('[HTOS] ✓ Cleared Qwen DNR rules at startup');
      } catch (e) {
        console.warn('[HTOS] Failed to clear Qwen DNR rules at startup', e);
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
    { name: 'qwen', Controller: QwenProviderController, Adapter: QwenAdapter },
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