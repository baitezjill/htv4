// shared/contract.ts
// Minimal shared types for UI <-> background workflow coordination

export type ProviderKey = 'claude' | 'gemini' | 'chatgpt';

export interface WorkflowStep {
  stepId: string;
  provider: ProviderKey;
  type: 'prompt';
  payload: { prompt: string };
}

export interface WorkflowContext {
  sessionId?: string;
  uiTabId?: number;
  executionMode?: 'visible' | 'headless';
  variables?: Record<string, unknown>;
}

export interface WorkflowRequest {
  workflowId: string;
  context: WorkflowContext;
  steps: WorkflowStep[];
}

export interface WorkflowStepResult {
  stepId: string;
  status: 'completed' | 'failed';
  result?: { response: string };
  error?: string;
}
