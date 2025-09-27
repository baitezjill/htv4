// src/ui/services/extension-api.ts
// PERSISTENT CONNECTION VERSION

import {
  EXECUTE_WORKFLOW,
  GET_FULL_HISTORY,
  GET_HISTORY_SESSION,
  GET_LAST_ESCALATION,
  CHATGPT_CHECK_REQUIREMENTS,
  CHATGPT_TEST_ARKOSE,
  CHATGPT_GET_STATUS,
  CHATGPT_GENERATE_PROOF,
  CHATGPT_RETRIEVE_ARKOSE,
  DELETE_SESSION,
} from "../../shared/messaging";
import type { LLMProvider, ChatSession, HistoryApiResponse } from "../types";
import type {
  WorkflowRequest,
  ProviderKey,
} from "../../shared/contract";

interface BackendApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

let EXTENSION_ID: string | null = null;
let activePort: any | null = null;
let activeListener: ((message: any) => void) | null = null;

// Stable UI instance identity for reconnect handshakes (stub for future use)
const UI_INSTANCE_ID: string = ((): string => {
  try {
    // @ts-ignore
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      // @ts-ignore
      return crypto.randomUUID();
    }
  } catch {}
  return `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
})();
const LAST_SEEN_VERSION = 1; // bump when protocol changes

/**
 * ContextTracker manages UI-side context state and synchronizes with SessionManager
 */
class ContextTracker {
  private contexts: Record<string, Record<string, any>> = {};
  private sessionId: string | null = null;

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  updateProviderContext(providerId: string, context: any): void {
    if (!this.sessionId) return;
    
    if (!this.contexts[this.sessionId]) {
      this.contexts[this.sessionId] = {};
    }
    
    this.contexts[this.sessionId][providerId] = {
      ...this.contexts[this.sessionId][providerId],
      ...context
    };
  }

  getProviderContext(providerId: string): any {
    if (!this.sessionId) return null;
    return this.contexts[this.sessionId]?.[providerId] || null;
  }

  getSessionContexts(): Record<string, any> {
    if (!this.sessionId) return {};
    return this.contexts[this.sessionId] || {};
  }

  clearSession(sessionId?: string): void {
    const targetSessionId = sessionId || this.sessionId;
    if (targetSessionId && this.contexts[targetSessionId]) {
      delete this.contexts[targetSessionId];
    }
  }

  getAllContexts(): Record<string, Record<string, any>> {
    return { ...this.contexts };
  }
}

const contextTracker = new ContextTracker();


// Public API shape for the UI extension-api module
export interface ExtensionApi {
  setExtensionId(id: string): void;
  queryBackend<T>(message: { type: string; payload?: any }): Promise<T>;
  dispatchWorkflow(workflow: WorkflowRequest): void;
  createPort(): any;
  ensurePort(options?: { sessionId?: string; onReconnectAck?: (msg: any) => void; timeoutMs?: number; }): Promise<any>;
  executeBatchPrompt(
    prompt: string,
    providers: LLMProvider[],
    isVisible: boolean,
    uiTabId?: number,
    onMessage?: (message: any) => void,
    sessionId?: string,
    useThinking?: boolean
  ): { sessionId: string; port: any };
  executeSynthesis(
    sessionId: string,
    originalPrompt: string,
    allBatchResults: Record<string, string>,
    synthesisProviders: ('claude' | 'gemini' | 'chatgpt') | Array<'claude' | 'gemini' | 'chatgpt'>,
    uiTabId?: number,
    options?: { idempotencyToken?: string; useThinking?: boolean }
  ): Promise<void>;
  executeEnsembler(args: {
    sessionId: string;
    userPrompt: string;
    modelOutputs: Record<string, string>; // from hidden synthesis results
    ensemblerProvider: string; // default 'claude'
    ensemblerPrompt: string; // exact prompt provided by UI
    uiTabId?: number;
    options?: { idempotencyToken?: string; useThinking?: boolean };
  }): Promise<void>;
  executeContinuationPrompt(args: {
    prompt: string;
    providers: string[];
    sessionId: string;
    providerContexts: Record<string, any>;
    uiTabId?: number;
    options?: { idempotencyToken?: string };
  }): Promise<void>;
  disconnectPort(): void;
  getActivePort(): any | null;
  getHistoryList(): Promise<HistoryApiResponse>;
  getHistorySession(sessionId: string): Promise<ChatSession>;
  deleteBackgroundSession(sessionId: string): Promise<{ removed: boolean }>;
  chatgptCheckRequirements(): Promise<{ ok: boolean }>;
  chatgptTestArkose(): Promise<{ ok: boolean }>;
  chatgptGetStatus(): Promise<{ status: string }>;
  chatgptGenerateProof(): Promise<{ token: string }>;
  chatgptRetrieveArkose(): Promise<{ token: string }>;
  setSessionId(sessionId: string): void;
  updateProviderContext(providerId: string, context: any): void;
  getProviderContext(providerId: string): any;
  getSessionContexts(): Record<string, any>;
  clearSession(sessionId?: string): void;
  getAllContexts(): Record<string, Record<string, any>>;
}

const api: ExtensionApi = {
  setExtensionId(id: string): void {
    EXTENSION_ID = id;
    console.log("Extension API connected with ID:", EXTENSION_ID);
  },

  /**
   * Sends a message and expects an immediate response. Used for simple, fast queries.
   * This is the "request-response" pattern.
   */
  async queryBackend<T>(message: { type: string; payload?: any }): Promise<T> {
    if (!EXTENSION_ID) throw new Error("Extension not connected.");

    return new Promise<T>((resolve, reject) => {
      chrome.runtime.sendMessage(
        EXTENSION_ID as string,
        message,
        (response: BackendApiResponse<T>) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (response?.success) {
            resolve(response.data as T);
          } else {
            reject(
              new Error(response?.error?.message || "Unknown backend error.")
            );
          }
        }
      );
    });
  },

  /**
   * Sends a "fire-and-forget" command to the backend to start a long-running task.
   * It does not wait for the task to complete.
   */
  dispatchWorkflow(workflow: WorkflowRequest): void {
    if (!EXTENSION_ID) {
      console.error("Extension not connected. Cannot dispatch workflow.");
      return;
    }
    // We don't await a response. The UI will get updates via the onMessage listener.
    chrome.runtime.sendMessage(EXTENSION_ID as string, {
      type: EXECUTE_WORKFLOW,
      payload: workflow,
    });
  },

  /**
   * Creates a persistent port connection for streaming communication
   */
  createPort(): any {
    if (!EXTENSION_ID) {
      throw new Error("Extension not connected. Cannot create port.");
    }
    
    // Reuse existing port if it is still connected
    if (activePort) {
      try {
        // Lightweight keep-alive ping; will throw if the port is already disconnected
        activePort.postMessage({ type: "__htos_keepalive" });
        return activePort;
      } catch (_) {
        // Port is disconnected – safely dispose and recreate
        try {
          activePort.disconnect();
        } catch { /* ignore */ }
        activePort = null;
        activeListener = null;
      }
    }
    
    // Create new persistent connection
    // @ts-ignore chrome.runtime.connect is available in extension context
    activePort = (chrome.runtime as any).connect(EXTENSION_ID, { name: "htos-popup" });
    activePort.onDisconnect.addListener(() => {
      activePort = null;
      activeListener = null;
    });
    return activePort;
  },

  /**
   * Ensure we have a connected Port, and perform a minimal reconnect handshake.
   * This lays the groundwork for a more robust reconnect protocol later.
   */
  async ensurePort(options?: {
    sessionId?: string;
    onReconnectAck?: (msg: any) => void;
    timeoutMs?: number;
  }): Promise<any> {
    console.log('[ExtensionAPI DEBUG] Entered ensurePort');
    const timeoutMs = options?.timeoutMs ?? 3000;
    // Create or reuse
    let port: any;
    try {
      port = this.createPort();
    } catch (e) {
      // If extension missing, rethrow
      throw e;
    }

    // Attempt a lightweight reconnect handshake; do not fail hard if no ack
    try {
      await new Promise<void>((resolve) => {
        let settled = false;
        const t = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve();
          }
        }, timeoutMs);

        const tempListener = (msg: any) => {
          if (msg && msg.type === "reconnect_ack") {
            try { options?.onReconnectAck?.(msg); } catch {}
            if (!settled) {
              settled = true;
              clearTimeout(t);
              port.onMessage.removeListener(tempListener);
              resolve();
            }
          }
        };
        port.onMessage.addListener(tempListener);

        try {
          port.postMessage({
            type: "reconnect",
            uiInstanceId: UI_INSTANCE_ID,
            lastSeenVersion: LAST_SEEN_VERSION,
            sessionId: options?.sessionId || null,
            ts: Date.now(),
          });
        } catch {
          // If this fails, try recreating once
          try {
            port = this.createPort();
            port.postMessage({
              type: "reconnect",
              uiInstanceId: UI_INSTANCE_ID,
              lastSeenVersion: LAST_SEEN_VERSION,
              sessionId: options?.sessionId || null,
              ts: Date.now(),
            });
          } catch {}
        }
      });
    } catch {}

    return port;
  },

  /**
   * STAGE 1: Executes the initial "batch prompt" workflow using persistent connection.
   */
  executeBatchPrompt(
    prompt: string,
    providers: LLMProvider[],
    isVisible: boolean,
    uiTabId?: number,
    onMessage?: (message: any) => void,
    sessionId?: string,
    useThinking?: boolean
  ): { sessionId: string; port: any } {
    const sid = sessionId || `sid-${Date.now()}`;
    
    // Create persistent port connection
    const port = this.createPort();
    
    // Set up message listener if provided
    if (onMessage) {
      if (activeListener) {
        try { port.onMessage.removeListener(activeListener); } catch (e) { console.warn('[ExtensionAPI] Failed to remove old listener', e); }
      }
      port.onMessage.addListener(onMessage);
      activeListener = onMessage;
    }
    
    // Send prompt request via port
    port.postMessage({
      type: "sendPrompt",
      prompt,
      providers: providers.map(p => p.id),
      sessionId: sid,
      uiTabId,
      executionMode: isVisible ? "visible" : "headless",
      // Forward Think-mode preference for this run (optional)
      useThinking
    });

    console.log("[ExtensionAPI] Sent sendPrompt via port:", { sessionId: sid, providers: providers.map(p => p.id) });

    // Return the session ID and port for the UI to manage
    return { sessionId: sid, port };
  },

  /**
   * STAGE 2: Executes the synthesis step using the active port.
   */
  async executeSynthesis(
    sessionId: string,
    originalPrompt: string,
    allBatchResults: Record<string, string>,
    synthesisProviders: ("claude" | "gemini" | "chatgpt") | Array<"claude" | "gemini" | "chatgpt">,
    uiTabId?: number,
    options?: { idempotencyToken?: string; useThinking?: boolean }
  ): Promise<void> {
    // Ensure we have a port; perform reconnect handshake if needed
    const port = await this.ensurePort({ sessionId });
    
    // Support single-provider (back-compat) and multi-provider batch synthesis
    if (Array.isArray(synthesisProviders)) {
      const providers = synthesisProviders;
      port.postMessage({
        type: "synthesize",
        sessionId,
        originalPrompt,
        allBatchResults,
        providers,
        uiTabId,
        idempotencyToken: options?.idempotencyToken,
        useThinking: options?.useThinking
      });
      console.log("[ExtensionAPI] Sent batch synthesis request via port:", { sessionId, providers });
    } else {
      const synthesisProvider = synthesisProviders;
      port.postMessage({
        type: "synthesize",
        sessionId,
        originalPrompt,
        allBatchResults,
        // Back-compat + SW expects 'provider'
        provider: synthesisProvider,
        synthesisProvider,
        uiTabId,
        idempotencyToken: options?.idempotencyToken,
        useThinking: options?.useThinking
      });
      console.log("[ExtensionAPI] Sent synthesis request via port:", { sessionId, synthesisProvider });
    }
  },

  /**
   * Final Round 3: Execute the Ensembler provider with a constructed prompt, streaming to UI.
   */
  async executeEnsembler({
    sessionId,
    userPrompt,
    modelOutputs,
    ensemblerProvider,
    ensemblerPrompt,
    uiTabId,
    options,
  }: {
    sessionId: string;
    userPrompt: string;
    modelOutputs: Record<string, string>;
    ensemblerProvider: string;
    ensemblerPrompt: string;
    uiTabId?: number;
    options?: { idempotencyToken?: string; useThinking?: boolean };
  }): Promise<void> {
    console.log('[ExtensionAPI DEBUG] Entered executeEnsembler');
    const port = await this.ensurePort({ sessionId });
    port.postMessage({
      type: "ensemble_finalize",
      sessionId,
      userPrompt,
      modelOutputs,
      ensemblerProvider,
      ensemblerPrompt,
      uiTabId,
      idempotencyToken: options?.idempotencyToken,
      useThinking: options?.useThinking,
    });
    console.log("[ExtensionAPI] Sent ensemble_finalize via port:", { sessionId, ensemblerProvider });
  },

  /**
   * CONTINUATION: Executes a continuation prompt that preserves provider contexts.
   */
  async executeContinuationPrompt({
    prompt,
    providers,
    sessionId,
    providerContexts,
    uiTabId,
    options,
  }: {
    prompt: string;
    providers: string[];
    sessionId: string;
    providerContexts: Record<string, any>;
    uiTabId?: number;
    options?: { idempotencyToken?: string; useThinking?: boolean };
  }): Promise<void> {
    // Ensure we have a port; perform reconnect handshake if needed
    const port = await this.ensurePort({ sessionId });
    
    port.postMessage({
      type: "continue",
      prompt,
      providers,
      sessionId,
      providerContexts,
      uiTabId,
      idempotencyToken: options?.idempotencyToken,
      useThinking: options?.useThinking,
    });
    
    console.log("[ExtensionAPI] Sent continuation request via port:", { sessionId, providers, providerContexts });
  },

  /**
   * Disconnects the active port connection
   */
  disconnectPort(): void {
    if (activePort) {
      activePort.disconnect();
      activePort = null;
      activeListener = null;
      console.log("[ExtensionAPI] Port disconnected");
    }
  },

  /**
   * Gets the current active port
   */
  getActivePort(): any | null {
    return activePort;
  },

  // History API wrappers
  async getHistoryList(): Promise<HistoryApiResponse> {
    return this.queryBackend<HistoryApiResponse>({ type: GET_FULL_HISTORY });
  },
  async getHistorySession(sessionId: string): Promise<ChatSession> {
    return this.queryBackend<ChatSession>({ type: GET_HISTORY_SESSION, payload: { sessionId } });
  },

  // Background maintenance
  async deleteBackgroundSession(sessionId: string): Promise<{ removed: boolean }> {
    return this.queryBackend<{ removed: boolean }>({ type: DELETE_SESSION, payload: { sessionId } });
  },

  // Arkose/ChatGPT debug utilities
  async chatgptCheckRequirements() {
    return this.queryBackend<{ ok: boolean }>({ type: CHATGPT_CHECK_REQUIREMENTS });
  },
  async chatgptTestArkose() {
    return this.queryBackend<{ ok: boolean }>({ type: CHATGPT_TEST_ARKOSE });
  },
  async chatgptGetStatus() {
    return this.queryBackend<{ status: string }>({ type: CHATGPT_GET_STATUS });
  },
  async chatgptGenerateProof() {
    return this.queryBackend<{ token: string }>({ type: CHATGPT_GENERATE_PROOF });
  },
  async chatgptRetrieveArkose() {
    return this.queryBackend<{ token: string }>({ type: CHATGPT_RETRIEVE_ARKOSE });
  },

  // ContextTracker methods
  setSessionId(sessionId: string): void {
    contextTracker.setSessionId(sessionId);
  },

  updateProviderContext(providerId: string, context: any): void {
    contextTracker.updateProviderContext(providerId, context);
  },

  getProviderContext(providerId: string): any {
    return contextTracker.getProviderContext(providerId);
  },

  getSessionContexts(): Record<string, any> {
    return contextTracker.getSessionContexts();
  },

  clearSession(sessionId?: string): void {
    contextTracker.clearSession(sessionId);
  },

  getAllContexts(): Record<string, Record<string, any>> {
    return contextTracker.getAllContexts();
  },
};

export default api;
