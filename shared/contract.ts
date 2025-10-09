// ============================================================================
// CORE TYPES
// ============================================================================

export type ProviderKey = 'claude' | 'gemini' | 'chatgpt' | 'qwen';
export type WorkflowStepType = 'prompt' | 'synthesis' | 'ensemble';

// NEW: Synthesis strategy types
export type SynthesisStrategy = 'continuation' | 'fresh';

// NEW: Workflow modes (maps to your UI selector)
// Conversation display/selection mode (legacy UI concept)
export type ConversationMode = 'full-parley' | 'selective' | 'single';

// ============================================================================
// PERSISTENT ENTITIES (Database Models)
// ============================================================================

/**
 * Session: Top-level container for a user's research session
 */
export interface Session {
  id: string;
  userId: string;
  activeThreadId: string;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    papId?: string; // Future: Personal Assistant Pad reference
  };
}

/**
 * Thread: A conversation timeline (main thread or branch)
 */
export interface Thread {
  id: string;
  sessionId: string;
  parentThreadId: string | null;
  branchPointTurnId: string | null;
  name: string;
  color: string; // UI tinting
  collapsed: boolean;
  lastAccessedAt: string;
  createdAt: string;
}

/**
 * Turn: A single user action + system response(s)
 * This is your existing AiTurn concept, enhanced
 */
export interface Turn {
  id: string;
  threadId: string;
  sessionId: string;
  turnNumber: number;
  userMessage: string;
  mode: ConversationMode;
  requestedProviders: ProviderKey[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  
  // References to outputs
  batchOutputIds: string[];
  synthesisOutputIds: string[]; // Array for multi-take support
  ensembleOutputIds: string[];  // Array for multi-take support
  
  createdAt: string;
  completedAt?: string;
}

/**
 * Conversation: Model-specific conversation thread
 * Persists across turns, tracks context window usage
 */
export interface Conversation {
  id: string;
  sessionId: string;
  threadId: string;
  modelId: ProviderKey;
  provider: string;
  
  // Provider-specific conversation ID (for API calls)
  providerConversationId: string;
  
  // Context tracking
  messageCount: number;
  tokenCount: number;
  
  status: 'active' | 'archived';
  
  // Future: PAP seeding context
  seedContext?: {
    papVersion?: string;
    compressedHistory?: string;
  };
  
  createdAt: string;
  lastMessageAt: string;
}

/**
 * Output: Immutable artifact from a model
 */
export interface Output {
  id: string;
  turnId: string;
  conversationId: string;
  modelId: ProviderKey;
  provider: string;
  
  content: string;
  contentType: 'text' | 'code' | 'markdown';
  
  role: 'batch' | 'synthesis' | 'ensemble';
  
  // Metadata (varies by role)
  metadata: {
    // For synthesis/ensemble
    sourceOutputIds?: string[];
    strategy?: SynthesisStrategy;
    attemptNumber?: number;
    
    // For ensemble
    options?: Array<{
      id: string;
      label: string;
      description: string;
      branchId?: string; // If user explored this option
    }>;
    
    // For all
    tokens?: number;
    latencyMs?: number;
  };
  
  createdAt: string;
}

// ============================================================================
// WORKFLOW EXECUTION (Your existing architecture, enhanced)
// ============================================================================

/**
 * Historical reference - your existing concept, unchanged
 */
export interface HistoricalStepReference {
  turnId: string;
  responseType: 'batch' | 'synthesis' | 'ensemble';
  providerIds?: ProviderKey[];
}

/**
 * Step Payloads - enhanced with new fields
 */
export interface PromptStepPayload {
  prompt: string;
  providers: ProviderKey[];
  providerContexts?: Record<ProviderKey, {
    conversationId: string; // Reference to existing conversation
    continueThread: boolean; // true = continue, false = new conversation
  }>;
  hidden?: boolean;
  useThinking?: boolean;
}

export interface SynthesisStepPayload {
  synthesisProvider: ProviderKey;
  strategy: SynthesisStrategy; // NEW: Explicitly specify strategy
  
  sourceStepIds?: string[];
  sourceHistorical?: HistoricalStepReference;
  
  originalPrompt: string;
  useThinking?: boolean;
  
  // NEW: For continuation strategy, reference the conversation
  continueConversationId?: string;
}

export interface EnsembleStepPayload {
  ensembleProvider: ProviderKey;
  strategy: SynthesisStrategy; // NEW: Ensemble also supports strategies
  
  sourceStepIds?: string[];
  sourceHistorical?: HistoricalStepReference;
  
  originalPrompt: string;
  useThinking?: boolean;
  
  continueConversationId?: string;
}

/**
 * Workflow Step - unchanged
 */
export interface WorkflowStep {
  stepId: string;
  type: WorkflowStepType;
  payload: PromptStepPayload | SynthesisStepPayload | EnsembleStepPayload;
}

/**
 * Workflow Context - enhanced with thread reference
 */
export interface WorkflowContext {
  sessionId: string;
  threadId: string; // NEW: Which thread is this workflow executing in
  targetUserTurnId: string;
  uiTabId?: number;
}

/**
 * Workflow Request - unchanged
 */
export interface WorkflowRequest {
  workflowId: string;
  context: WorkflowContext;
  steps: WorkflowStep[];
}

// ============================================================================
// REAL-TIME MESSAGING (Backend -> UI)
// ============================================================================

export interface SessionStartedMessage {
  type: 'SESSION_STARTED';
  sessionId: string;
}

export interface PartialResultMessage {
  type: 'PARTIAL_RESULT';
  sessionId: string;
  stepId: string;
  providerId: ProviderKey;
  chunk: {
    text?: string;
    meta?: any;
  };
}

/**
 * Enhanced step update with output metadata
 */
export interface WorkflowStepUpdateMessage {
  type: 'WORKFLOW_STEP_UPDATE';
  sessionId: string;
  stepId: string;
  status: 'completed' | 'failed';
  
  // NEW: Structured result with output references
  result?: {
    outputId: string;
    conversationId: string;
    content: string;
    metadata: Output['metadata'];
  };
  
  error?: string;
}

export interface WorkflowCompleteMessage {
  type: 'WORKFLOW_COMPLETE';
  sessionId: string;
  workflowId: string;
  
  // NEW: Reference the completed turn
  turnId: string;
  
  finalResults: Record<string, {
    outputId: string;
    conversationId: string;
  }>;
}

export type PortMessage =
  | SessionStartedMessage
  | PartialResultMessage
  | WorkflowStepUpdateMessage
  | WorkflowCompleteMessage;

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Request to execute a workflow
 * This is what your UI sends to the backend
 */
// ============================================================================
// UNIFIED EXECUTION REQUEST (Declarative Frontend API)
// ============================================================================

/**
 * Unified request type for ALL workflow executions.
 * The frontend only describes WHAT to do, never HOW.
 */
export interface ExecuteWorkflowRequest {
  sessionId: string;
  threadId: string;

  // Discriminated union based on mode
  mode: WorkflowMode;

  // Mode-specific payloads
  payload:
    | NewMessagePayload
    | ContinuationPayload
    | RerunSynthesisPayload
    | RerunEnsemblePayload
    | BranchPayload;
}

// Execution modes (request-level)
export type WorkflowMode =
  | 'new-message'      // User sends new prompt
  | 'continuation'     // User continues conversation
  | 'rerun-synthesis'  // User reruns synthesis for a historical round
  | 'rerun-ensemble'   // User reruns ensemble for a historical round
  | 'branch';          // User creates branch from historical turn

/**
 * NEW MESSAGE: User sends a fresh prompt
 */
export interface NewMessagePayload {
  userMessage: string;
  providers: ProviderKey[];

  // Optional: Enable synthesis
  synthesis?: {
    enabled: boolean;
    provider: ProviderKey;
    strategy: SynthesisStrategy;
  };

  // Optional: Enable ensemble
  ensemble?: {
    enabled: boolean;
    provider: ProviderKey;
    strategy: SynthesisStrategy;
  };

  // Optional: Thinking mode (for ChatGPT)
  useThinking?: boolean;
}

/**
 * CONTINUATION: User continues existing conversation
 * (Same as new message, but with provider contexts handled by backend)
 */
export interface ContinuationPayload extends NewMessagePayload {
  // Backend will auto-fetch provider contexts from session
}

/**
 * RERUN SYNTHESIS: User clicks “Run Synthesis” on historical round
 */
export interface RerunSynthesisPayload {
  historicalTurnId: string;     // The user turn ID for this round
  providers: ProviderKey[];     // Which providers to use for synthesis (multi-select)
  originalPrompt: string;       // The original user message
  useThinking?: boolean;        // For ChatGPT thinking mode
}

/**
 * RERUN ENSEMBLE: User clicks “Run Ensemble” on historical round
 */
export interface RerunEnsemblePayload {
  historicalTurnId: string;     // The user turn ID for this round
  provider: ProviderKey;        // Which provider to use for ensemble (single-select)
  originalPrompt: string;       // The original user message
  useThinking?: boolean;        // For ChatGPT thinking mode
}

/**
 * BRANCH: User creates a new branch from a historical turn
 * (Future feature - stubbed for completeness)
 */
export interface BranchPayload {
  branchPointTurnId: string;
  newMessage: string;
  providers: ProviderKey[];
}

export interface ExecuteWorkflowResponse {
  turnId: string;
  workflowId: string;
  status: 'processing';
  streamUrl: string; // WebSocket URL for real-time updates
}

/**
 * Request to get thread state
 */
export interface GetThreadRequest {
  sessionId: string;
  threadId: string;
  
  // Optional: Pagination for large threads
  turnRange?: {
    start: number;
    end: number;
  };
}

export interface GetThreadResponse {
  thread: Thread;
  turns: Array<{
    turn: Turn;
    outputs: Output[];
  }>;
  conversations: Conversation[]; // Active conversations in this thread
}

/**
 * Request to create a branch
 */
export interface CreateBranchRequest {
  sessionId: string;
  parentThreadId: string;
  branchPointTurnId: string;
  name: string;
  color?: string;
  
  // Optional: Start with an initial query
  initialMessage?: string;
  initialRequest?: ExecuteWorkflowRequest;
}

export interface CreateBranchResponse {
  thread: Thread;
  turnId?: string; // If initialMessage was provided
}

/**
 * Request to re-synthesize (multi-take)
 */
export interface ResynthesizeRequest {
  turnId: string;
  provider: ProviderKey;
  strategy: SynthesisStrategy;
  
  // Optional: Override source outputs
  sourceOutputIds?: string[];
}

export interface ResynthesizeResponse {
  outputId: string;
  attemptNumber: number;
  content: string;
}

/**
 * Request to switch active thread
 */
export interface SwitchThreadRequest {
  sessionId: string;
  threadId: string;
}

export interface SwitchThreadResponse {
  success: boolean;
  thread: Thread;
  
  // Return recent turns for immediate display
  recentTurns: Array<{
    turn: Turn;
    outputs: Output[];
  }>;
}

// ============================================================================
// UI STATE TYPES (For your frontend store)
// ============================================================================

/**
 * UI representation of session state
 */
export interface SessionState {
  session: Session;
  threads: Record<string, Thread>;
  activeThreadId: string;
  
  // Current thread's turns (loaded incrementally)
  turns: Record<string, Turn>;
  outputs: Record<string, Output>;
  conversations: Record<string, Conversation>;
  
  // UI state
  selectedTurn?: string;
  composerOpen: boolean;
  papOpen: boolean;
}

/**
 * UI representation of a turn (hydrated with outputs)
 */
export interface TurnView {
  turn: Turn;
  batchOutputs: Output[];
  synthesisOutputs: Output[]; // Multiple for multi-take
  ensembleOutputs: Output[];
  
  // UI state
  selectedSynthesisIndex: number; // Which synthesis tab is active
  selectedEnsembleIndex: number;
}

// ============================================================================
// FUTURE: PAP TYPES (Stubbed for compatibility)
// ============================================================================

export interface PersonalAssistantPad {
  id: string;
  sessionId: string;
  
  userContext: {
    projectGoal: string;
    constraints: string[];
    preferences: string[];
    mustHaves: string[];
    mustNotHaves: string[];
  };
  
  decisions: Array<{
    id: string;
    turnId: string;
    decision: string;
    rationale: string;
    createdAt: string;
  }>;
  
  insights: Array<{
    id: string;
    sourceOutputId: string;
    content: string;
    tags: string[];
    createdAt: string;
  }>;
  
  versions: Array<{
    versionId: string;
    compressedContext: string;
    turnRange: { start: number; end: number };
    createdAt: string;
  }>;
  
  updatedAt: string;
}

// ============================================================================
// FUTURE: COMPOSER TYPES (Stubbed for compatibility)
// ============================================================================

export interface ComposerDraft {
  id: string;
  sessionId: string;
  name: string;
  
  fragments: Array<{
    id: string;
    outputId: string;
    startChar: number;
    endChar: number;
    order: number;
  }>;
  
  gaps: Array<{
    id: string;
    afterFragmentId: string;
    beforeFragmentId: string;
    generatedContent: string;
    accepted: boolean;
  }>;
  
  compiledContent: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * For building workflows in the UI
 */
export interface WorkflowBuilder {
  addPromptStep(providers: ProviderKey[], prompt: string, options?: {
    hidden?: boolean;
    useThinking?: boolean;
    providerContexts?: PromptStepPayload['providerContexts'];
  }): WorkflowBuilder;
  
  addSynthesisStep(provider: ProviderKey, options: {
    strategy: SynthesisStrategy;
    sourceStepIds?: string[];
    sourceHistorical?: HistoricalStepReference;
    continueConversationId?: string;
  }): WorkflowBuilder;
  
  addEnsembleStep(provider: ProviderKey, options: {
    strategy: SynthesisStrategy;
    sourceStepIds?: string[];
    sourceHistorical?: HistoricalStepReference;
    continueConversationId?: string;
  }): WorkflowBuilder;
  
  build(): WorkflowRequest;
}

/**
 * Type guards
 */
export function isPromptPayload(payload: any): payload is PromptStepPayload {
  return 'prompt' in payload && 'providers' in payload;
}

export function isSynthesisPayload(payload: any): payload is SynthesisStepPayload {
  return 'synthesisProvider' in payload;
}

export function isEnsemblePayload(payload: any): payload is EnsembleStepPayload {
  return 'ensembleProvider' in payload;
}