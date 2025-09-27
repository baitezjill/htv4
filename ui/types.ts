// src/types.ts

/**
 * UI-LAYER TYPES
 * 
 * This file contains type definitions exclusively for the React UI components
 * and their state. It is decoupled from the backend's internal system contracts.
 */

// import type React from 'react';

/** The current step of the UI, controlling what controls are shown */
export type AppStep = 'initial' | 'awaitingSynthesis' | 'synthesis' | 'synthesisDone';

/** Defines the allowed LLM providers for the synthesis step */
export type SynthesisProvider = 'claude' | 'gemini' | 'chatgpt';

/** Defines the properties for a supported LLM provider for UI rendering */
export interface LLMProvider {
  id: string;
  name: string;
  hostnames: string[];
  color: string;
  logoBgClass: string;
  icon?: any;
}

/** The data structure for a single AI model's response within a message block */
export interface LLMStreamData {
  providerId: string;
  firstSentenceSummary: string;
  fullOutput: string;
  isStreamingSummary: boolean;
  isStreamingOutput: boolean;
  isExpanded: boolean;
}

/** The core data structure for a single message (user or AI) in the chat log */
export interface Message {
  id: string;
  type: 'user' | 'ai';
  sessionId: string | null;
  text?: string; // For user messages
  overallSummary?: string; // For AI synthesis messages
  llmData?: LLMStreamData[]; // For multi-model AI responses
  isOverallSummaryStreaming?: boolean;
  isFinalSynthesis?: boolean;
  timestamp: number;
}

/** The data structure for a single session in the history panel */
export interface ChatSession {
  id: string;
  sessionId: string;
  input?: string;
  workflowId?: string;
  startTime: number;
  lastActivity: number;
  title: string;
  firstMessage?: string;
  messageCount: number;
  messages?: Message[]; // Optional full message history for rehydration
}

/** The shape of the response when fetching the list of chat sessions for the history panel */
export interface HistoryApiResponse {
  sessions: ChatSession[];
}

// Backend session detail (full transcript + continuation contexts)
export interface BackendRoundProviderEntry {
  text: string;
  meta?: any;
}

export interface BackendRound {
  id: string;
  createdAt: number;
  completedAt?: number;
  user: { text: string; createdAt: number };
  providers: Record<string, BackendRoundProviderEntry>;
}

export interface BackendFullSession {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  lastActivity: number;
  turns: BackendRound[];
  providerContexts: ProviderContinuationContexts;
}

export interface BackendMessage {
  type: 'WORKFLOW_STEP_UPDATE' | 'WORKFLOW_COMPLETE' | 'SYNTHESIS_COMPLETE' | 'SYNTHESIS_PARTIAL' | 'WORKFLOW_FAILED' | 'BATCH_COMPLETE' | 'BATCH_PARTIAL' | 'HIDDEN_BATCH_COMPLETE' | 'HIDDEN_BATCH_PARTIAL';
  sessionId: string;
  data?: {
    providerKey: string;
    result: string;
    threadUrl?: string | null;
  };
  results?: Array<{
    provider: string;
    result: string;
    threadUrl?: string;
  }>;
  payload?: {
    successCount?: number;
    failCount?: number;
    [key: string]: unknown;
  };
  error?: string;
}

// =============================================================================
// TURN-BASED CHAT MODEL (New Architecture - Additive, Non-Breaking)
// =============================================================================

/** Status of a provider's response in the turn-based model */
export type ProviderResponseStatus = 'pending' | 'streaming' | 'completed' | 'error';

/** A provider's response within a turn - replaces individual state tracking */
export interface ProviderResponse {
  // optional providerId here for convenience when extracted from legacy formats
  providerId?: string;
  text: string;
  status: ProviderResponseStatus;
  error?: string;
  // align naming with backend `meta` used across the service worker
  meta?: {
    threadUrl?: string;
    tokensUsed?: number;
    responseTime?: number;
    [key: string]: any;
  };
  // timestamps to aid migration and ordering
  createdAt?: number;
  updatedAt?: number;
}

/** User turn in the conversation */
export interface UserTurn {
  type: 'user';
  id: string;
  text: string;
  createdAt: number;
  sessionId: string | null;
}

/** AI turn containing all provider responses and optional synthesis */
export interface AiTurn {
  type: 'ai';
  id: string;
  createdAt: number;
  sessionId: string | null;
  providerResponses: Record<string, ProviderResponse>;
  synthesisResponse?: ProviderResponse; // Kept for legacy data compatibility
  // Marks if this turn is an ensemble answer (synthesis of multiple models)
  isEnsembleAnswer?: boolean;
  // Marks if this turn is a synthesis answer (from a single model)
  isSynthesisAnswer?: boolean;
  // Optional metadata container; used for ensemble persistence flags and telemetry
  meta?: {
    // Summary of ensemble run used for badges/tooltips/history
    ensemble?: {
      providers: string[]; // selected synthesizers
      sourceProviders: string[]; // original batch providers
      startTs?: number | null;
      durationMs?: number;
    };
    [key:string]: any;
  };
}

/** Union type for all turn-based messages */
export type TurnMessage = UserTurn | AiTurn;

/** Type guard for user turns */
export const isUserTurn = (turn: TurnMessage): turn is UserTurn => turn.type === 'user';

/** Type guard for AI turns */
export const isAiTurn = (turn: TurnMessage): turn is AiTurn => turn.type === 'ai';

/** Utility type for live streaming states during turn construction */
export type LiveProviderStates = Record<string, ProviderResponse>;

/** Session data structure updated for turn-based model */
export interface TurnBasedChatSession {
  id: string;
  sessionId: string;
  title: string;
  startTime: number;
  turns: TurnMessage[];
}

/** Convenience aliases for the domain model (non-breaking) */
export type Session = TurnBasedChatSession;
export type ProviderResult = ProviderResponse;

/**
 * Minimal UI finite state machine for the chat surface.
 * This runs orthogonally to provider/synthesis details and avoids overloading AppStep.
 */
export type UiPhase = 'idle' | 'streaming' | 'awaiting_action';

/** Per-provider continuation context (e.g., threadUrl, chatId) kept per session */
export type ProviderContinuationContexts = Record<string, any>;

/**
 * A "Round" represents a single prompt→responses trip within a session.
 * It pairs the user turn with the corresponding AI turn, and can carry synthesis and continuation context.
 */
export interface Round {
  id: string;
  sessionId: string;
  user: UserTurn;
  ai?: AiTurn;
  synthesis?: ProviderResponse;
  providerContexts?: ProviderContinuationContexts;
  createdAt: number;
}

// =============================================================================
// Ensemble UI State (authoritative; maintained in App.tsx)
// =============================================================================

// Hidden/round-tracking types removed with hidden flows

/** Migration utility - converts legacy Message to TurnMessage */
export const convertLegacyMessageToTurn = (message: Message): TurnMessage => {
  const ts = message.timestamp || Date.now();

  if (message.type === 'user') {
    const userTurn: UserTurn = {
      type: 'user',
      id: message.id,
      text: message.text || '',
      createdAt: ts,
      sessionId: message.sessionId || null,
    };
    return userTurn;
  }

  // AI/legacy message -> AiTurn
  const providerResponses: Record<string, ProviderResponse> = {};

  // Convert llmData (if present) into providerResponses keyed by providerId
  if (Array.isArray(message.llmData)) {
    for (const d of message.llmData) {
      const pid = String(d.providerId || 'unknown').toLowerCase();
      providerResponses[pid] = {
        providerId: pid,
        text: (d.fullOutput && String(d.fullOutput)) || (d.firstSentenceSummary && String(d.firstSentenceSummary)) || '',
        status: (d.isStreamingOutput || d.isStreamingSummary) ? 'streaming' : 'completed',
        meta: {
          firstSentenceSummary: d.firstSentenceSummary,
          isStreamingSummary: d.isStreamingSummary,
          isStreamingOutput: d.isStreamingOutput,
          isExpanded: d.isExpanded,
        },
        createdAt: ts,
        updatedAt: ts,
      };
    }
  }

  // If llmData was not present but overallSummary exists, create a default provider entry
  if (Object.keys(providerResponses).length === 0) {
    // try to infer a provider key from message (best-effort)
    const inferredKey = 'synthesis';
    providerResponses[inferredKey] = {
      providerId: inferredKey,
      text: message.text || message.overallSummary || '',
      status: 'completed',
      meta: {},
      createdAt: ts,
      updatedAt: ts,
    };
  }

  const synthesisResponse: ProviderResponse | undefined = message.overallSummary
    ? {
        text: message.overallSummary,
        status: 'completed',
        createdAt: ts,
        updatedAt: ts,
      }
    : undefined;

  const aiTurn: AiTurn = {
    type: 'ai',
    id: message.id,
    createdAt: message.timestamp || Date.now(),
    sessionId: message.sessionId || null,
    providerResponses: {},
    synthesisResponse: undefined,
  };

  return aiTurn;
};