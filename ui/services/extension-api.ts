// src/ui/services/extension-api.ts

// This file is now streamlined for the declarative workflow architecture.
// Old imperative methods have been removed in favor of `executeWorkflow`.

import {
  EXECUTE_WORKFLOW,
  GET_FULL_HISTORY,
  GET_HISTORY_SESSION,
  DELETE_SESSION,
  // Keep any non-workflow queries like this if needed
  GET_SYSTEM_STATUS, 
} from "../../shared/messaging";

import type { HistorySessionSummary, HistoryApiResponse } from "../types";
import type { ExecuteWorkflowRequest } from "../../shared/contract";

interface BackendApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

let EXTENSION_ID: string | null = null;
let activePort: chrome.runtime.Port | null = null;
let activeListener: ((message: any) => void) | null = null;

/**
 * A simplified API module for communicating with the extension's backend.
 * It primarily uses a single entry point `executeWorkflow` for all AI tasks
 * and `queryBackend` for simple request-response data fetching.
 */
const api = {
  /**
   * Sets the extension ID. This must be called once on application startup.
   */
  setExtensionId(id: string): void {
    if (!EXTENSION_ID) {
      EXTENSION_ID = id;
      console.log("Extension API connected with ID:", EXTENSION_ID);
    }
  },

  /**
   * Creates or retrieves a persistent port connection to the backend.
   * This is used for streaming workflow updates.
   */
  ensurePort(options?: { sessionId?: string }): Promise<chrome.runtime.Port> {
    return new Promise((resolve, reject) => {
      if (!EXTENSION_ID) {
        return reject(new Error("Extension not connected. Cannot create port."));
      }

      // If port exists and is presumed connected, resolve immediately.
      // The backend handles disconnects gracefully.
      if (activePort) {
        return resolve(activePort);
      }

      console.log("[API] Creating new persistent port...");
      activePort = chrome.runtime.connect(EXTENSION_ID, { name: "htos-popup" });

      activePort.onDisconnect.addListener(() => {
        console.warn("[API] Port disconnected.");
        activePort = null;
        activeListener = null; // Clear listener on disconnect
      });

      // It's good practice to wait a moment for the connection to establish
      setTimeout(() => resolve(activePort as chrome.runtime.Port), 50);
    });
  },

  /**
   * Registers a single message handler for the active port. 
   * Replaces any existing handler.
   */
  setPortMessageHandler(handler: ((message: any) => void) | null): void {
    this.ensurePort().then(port => {
      // Remove the old listener if it exists
      if (activeListener && port?.onMessage) {
        try {
          port.onMessage.removeListener(activeListener);
        } catch (e) {
          console.warn('[API] Failed to remove old port listener:', e);
        }
      }

      // Add the new handler
      if (handler && port?.onMessage) {
        activeListener = handler;
        port.onMessage.addListener(activeListener);
        console.log("[API] Port message handler registered.");
      } else {
        activeListener = null;
      }
    });
  },

  /**
   * The primary method for executing all AI-related tasks.
   * Constructs a workflow and sends it to the backend's WorkflowEngine.
   */
  async executeWorkflow(request: ExecuteWorkflowRequest): Promise<void> {
    const port = await this.ensurePort({ sessionId: request.sessionId });
    
    // Send high-level request - backend will compile it
    port.postMessage({
      type: EXECUTE_WORKFLOW,
      payload: request
    });
    console.log(`[API] Dispatched request mode: ${request.mode} for session: ${request.sessionId}`);
  },

  /**
   * Sends a simple request-response message to the backend.
   * Used for fetching data like history, not for streaming AI responses.
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
            reject(new Error(response?.error?.message || "Unknown backend error."));
          }
        }
      );
    });
  },

  // === DATA & SESSION METHODS ===

  getHistoryList(): Promise<HistoryApiResponse> {
    return this.queryBackend<HistoryApiResponse>({ type: GET_FULL_HISTORY });
  },

  getHistorySession(sessionId: string): Promise<HistorySessionSummary> {
    return this.queryBackend<HistorySessionSummary>({ type: GET_HISTORY_SESSION, payload: { sessionId } });
  },

  deleteBackgroundSession(sessionId: string): Promise<{ removed: boolean }> {
    return this.queryBackend<{ removed: boolean }>({ type: DELETE_SESSION, payload: { sessionId } });
  },

  // Simple passthrough for session ID management in the backend
  // In the new model, the UI rarely needs to do this manually.
  // It's primarily handled via the workflow context.
  setSessionId(sessionId: string): void {
    this.ensurePort().then(port => {
        port.postMessage({ type: 'sync_session', sessionId });
    });
  },

  // The UI no longer manages context. These are now NO-OPs or deprecated.
  updateProviderContext(providerId: string, context: any): void {
    console.warn("`updateProviderContext` is deprecated. Context is managed by the backend.");
  },
  
  clearSession(sessionId: string): void {
      // This can be kept to signal a clear event to the backend if needed,
      // but deleting the session is more explicit.
      console.log(`Clearing UI-related state for session ${sessionId}`);
  }
};

export default api;