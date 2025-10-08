// shared/contract.ts

export type ProviderKey = 'claude' | 'gemini' | 'chatgpt' | 'qwen';
export type WorkflowStepType = 'prompt' | 'synthesis' | 'ensemble';

/**
 * NEW: A reference to a completed step in a previous turn.
 * This allows the UI to request re-runs without sending the source data.
 * The backend's HistoricalDataResolver is responsible for fetching this data.
 */
export interface HistoricalStepReference {
  turnId: string; // The ID of the AiTurn containing the source data
  responseType: 'batch' | 'synthesis' | 'ensemble';
  providerIds?: ProviderKey[]; // Optional: filter to specific providers from the source
}

// --- Step Payloads ---

export interface PromptStepPayload {
  prompt: string;
  providers: ProviderKey[];
  providerContexts?: Record<string, any>; // For continuation
  hidden?: boolean; // For synthesis-first workflows
  useThinking?: boolean; // For ChatGPT think mode
}

export interface SynthesisStepPayload {
  synthesisProvider: ProviderKey;
  // A step can source from a live step in the current workflow OR a historical turn
  sourceStepIds?: string[];
  sourceHistorical?: HistoricalStepReference;
  originalPrompt: string;
  useThinking?: boolean;
}

export interface EnsembleStepPayload {
  ensembleProvider: ProviderKey;
  sourceStepIds?: string[];
  sourceHistorical?: HistoricalStepReference;
  originalPrompt: string;
  useThinking?: boolean;
}

// --- Core Workflow Structures ---

export interface WorkflowStep {
  stepId: string;
  type: WorkflowStepType;
  payload: PromptStepPayload | SynthesisStepPayload | EnsembleStepPayload;
}

export interface WorkflowContext {
  sessionId: string;
  targetUserTurnId: string; // Associates results with the correct user prompt
  uiTabId?: number;
}

export interface WorkflowRequest {
  workflowId: string;
  context: WorkflowContext;
  steps: WorkflowStep[];
}

// --- Backend -> UI Message Protocol (NEW) ---

export interface SessionStartedMessage {
  type: 'SESSION_STARTED';
  sessionId: string;
}

export interface PartialResultMessage {
  type: 'PARTIAL_RESULT';
  sessionId: string;
  stepId: string;
  providerId: string;
  chunk: {
    text?: string;
    meta?: any;
  };
}

export interface WorkflowStepUpdateMessage {
  type: 'WORKFLOW_STEP_UPDATE';
  sessionId: string;
  stepId: string;
  status: 'completed' | 'failed';
  result?: any; // Contains the final structured output for the step
  error?: string;
}

export interface WorkflowCompleteMessage {
  type: 'WORKFLOW_COMPLETE';
  sessionId: string;
  workflowId: string;
  finalResults: Record<string, any>; // A map of all step results
}

export type PortMessage =
  | SessionStartedMessage
  | PartialResultMessage
  | WorkflowStepUpdateMessage
  | WorkflowCompleteMessage;