// src/ui/types.ts

/**
 * UI-LAYER TYPES
 * 
 * This file contains the complete type definitions for the React UI.
 * It is based on the new declarative, turn-based architecture and serves
 * as the single source of truth for the application's data structures.
 */

import type { Descendant } from 'slate';
import type { ProviderKey } from '../shared/contract'; // Corrected import path

// =============================================================================
// CORE UI STATE, CONFIGURATION & ENUMS
// =============================================================================

/** The current high-level step of the UI, controlling what major controls are shown. */
export type AppStep = 'initial' | 'awaitingSynthesis' | 'synthesis' | 'synthesisDone';

/** The UI's finite state for core user interactions. */
export type UiPhase = 'idle' | 'streaming' | 'awaiting_action';

/** Defines the primary view mode of the application. */
export enum ViewMode {
  CHAT = 'chat',
  COMPOSER = 'composer',
  HISTORY = 'history' // Kept from original
}

/** Defines the properties for rendering a supported LLM provider in the UI. */
export interface LLMProvider {
  id: ProviderKey | string;
  name: string;
  hostnames: string[];
  color: string;
  logoBgClass: string;
  icon?: any;
  emoji?: string;
}

// =============================================================================
// CHAT TURN-BASED DATA MODEL (New Architecture)
// =============================================================================

/** The status of a provider's response within an AiTurn. */
export type ProviderResponseStatus = 'pending' | 'streaming' | 'completed' | 'error';

/** Represents a single provider's response. This is the core building block for an AiTurn. */
export interface ProviderResponse {
  providerId: ProviderKey | string;
  text: string;
  status: ProviderResponseStatus;
  error?: string;
  meta?: { [key: string]: any };
  createdAt?: number;
  updatedAt?: number;
}

/** Represents a turn initiated by the user. */
export interface UserTurn {
  type: 'user';
  id: string;
  text: string;
  createdAt: number;
  sessionId: string | null;
}

/** 
 * Represents a turn from the AI, containing all provider responses.
 * This structure is designed to be additive, preventing data loss on reruns.
 */
export interface AiTurn {
  type: 'ai';
  id: string;
  createdAt: number;
  sessionId: string | null;

  // NEW: Each response type has its own container for clarity and robustness.
  batchResponses: Record<string, ProviderResponse>;
  synthesisResponses: Record<string, ProviderResponse[]>;
  ensembleResponses: Record<string, ProviderResponse[]>;
  hiddenBatchOutputs?: Record<string, ProviderResponse>;

  isSynthesisAnswer?: boolean; // Kept for transition
  isEnsembleAnswer?: boolean; // Kept for transition
  isHidden?: boolean;

  meta?: {
    synthForUserTurnId?: string;
    [key: string]: any;
  };
  
  composerState?: ComposerState;

  
  // DEPRECATED BUT KEPT FOR TRANSITION:
  // This allows old component props to still function while you migrate them.
  /** @deprecated Use `batchResponses`, `synthesisResponses`, or `ensembleResponses` instead. */
  providerResponses?: Record<string, ProviderResponse>;
}

/** The union type for any message in the chat timeline. This is the main type for the `messages` state array. */
export type TurnMessage = UserTurn | AiTurn;

/** Type guard to check if a turn is a UserTurn. */
export const isUserTurn = (turn: TurnMessage): turn is UserTurn => turn.type === 'user';

/** Type guard to check if a turn is an AiTurn. */
export const isAiTurn = (turn: TurnMessage): turn is AiTurn => turn.type === 'ai';

// =============================================================================
// HISTORY & SESSION LOADING
// =============================================================================

/** Represents a session summary object used for display in the history panel. */
export interface HistorySessionSummary {
  id: string;
  sessionId: string;
  startTime: number;
  lastActivity: number;
  title: string;
  firstMessage?: string;
  messageCount: number;
  messages?: TurnMessage[]; // Use the new TurnMessage type
}

/** ALIAS: This keeps `App.tsx` working without needing to find/replace `ChatSession` everywhere yet. */
export type ChatSession = HistorySessionSummary;

/** The shape of the API response when fetching the list of chat sessions. */
export interface HistoryApiResponse {
  sessions: HistorySessionSummary[];
}

/** 
 * The shape of the API response when fetching a full session to load into the UI.
 */
export interface FullSessionPayload {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  lastActivity: number;
  turns: TurnMessage[]; // Backend should send data in the new, correct TurnMessage format.
  providerContexts: Record<string, any>;
}

/** ALIAS: This keeps `App.tsx` working without needing to find/replace `BackendFullSession` yet. */
export type BackendFullSession = FullSessionPayload;

/** DEPRECATED: Old message format from legacy port communication. Replaced by contract.ts types. */
/** @deprecated Replaced by the PortMessage types in `shared/contract.ts` */
export interface BackendMessage {
  type: string;
  sessionId: string;
  [key: string]: any;
}


// =============================================================================
// COMPOSER MODE TYPE DEFINITIONS (Restored from Original)
// =============================================================================

export type SlateDescendant = Descendant;

export interface ContentSourceMap {
  [nodeId: string]: {
    providerId: string;
    sourceType: 'batch' | 'synthesis' | 'ensemble' | 'hidden';
    originalIndex: number;
    granularity: 'full' | 'paragraph' | 'sentence';
    text: string;
    timestamp: number;
    metadata?: Record<string, any>;
  };
}

export interface RefinementEntry {
  id: string;
  timestamp: number;
  inputContent: string;
  refinedContent: string;
  refinementType: 'grammar' | 'style' | 'tone' | 'structure' | 'custom';
  model: string;
  status: 'pending' | 'completed' | 'error';
  userRating?: number;
  appliedChanges: boolean;
  error?: string;
}

export interface ExportEntry {
  id: string;
  timestamp: number;
  format: 'markdown' | 'html' | 'text' | 'json';
  content: string;
  metadata?: Record<string, any>;
}

export interface ComposerState {
  canvasContent: SlateDescendant[];
  granularity: 'full' | 'paragraph' | 'sentence';
  sourceMap: ContentSourceMap;
  isDirty: boolean;
  createdAt: number;
  lastModified: number;
  lastSaved?: number;
  refinementHistory: RefinementEntry[];
  exportHistory: ExportEntry[];
}

export interface GranularUnit {
  id: string;
  text: string;
  type: 'full' | 'paragraph' | 'sentence';
  sourceId: string;
  providerId: string;
  index: number;
}

export interface ComposableSource {
  id: string;
  type: 'batch' | 'synthesis' | 'ensemble' | 'hidden';
  providerId: string;
  content: string;
  status: ProviderResponseStatus;
  metadata?: Record<string, any>;
}

export interface ComposerContextValue {
  activeAiTurn: AiTurn | null;
  canvasContent: SlateDescendant[];
  granularityLevel: 'full' | 'paragraph' | 'sentence';
  selectedSources: ComposableSource[];
  updateCanvas: (content: SlateDescendant[]) => void;
  persistComposerState: () => void;
  setGranularity: (level: 'full' | 'paragraph' | 'sentence') => void;
}