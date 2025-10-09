// src/core/workflow-compiler.js

/**

- WorkflowCompiler
- 
- THE SINGLE SOURCE OF TRUTH for translating user intent into execution steps.
- 
- KEY PRINCIPLE: The frontend describes WHAT the user wants.
- 
             The compiler determines HOW to execute it.
  
- 
- This eliminates the need for WorkflowBuilder in the frontend.
  */

export class WorkflowCompiler {
constructor(sessionManager) {
this.sessionManager = sessionManager;
}

/**

- Main compilation entry point
- Routes to specific compilers based on mode
  */
  compile(request) {
  this._validateRequest(request);


const { mode } = request;

switch (mode) {
  case 'new-message':
    return this._compileNewMessage(request);
  
  case 'continuation':
    return this._compileContinuation(request);
  
  case 'rerun-synthesis':
    return this._compileRerunSynthesis(request);
  
  case 'rerun-ensemble':
    return this._compileRerunEnsemble(request);
  
  case 'branch':
    return this._compileBranch(request);
  
  default:
    throw new Error(`Unknown workflow mode: ${mode}`);
}


}

// ==========================================================================
// MODE COMPILERS
// ==========================================================================

/**

- NEW MESSAGE: Fresh user prompt
- Strategy: Batch → optional synthesis → optional ensemble
  */
  _compileNewMessage(request) {
  const { sessionId, threadId, payload } = request;
  const { userMessage, providers, synthesis, ensemble, useThinking } = payload;


const workflowId = this._generateWorkflowId('new-message');
const steps = [];

// Determine if synthesis-first (hidden batch)
const isSynthesisFirst = synthesis?.enabled && providers.length > 1;

// Step 1: Batch prompt
const batchStepId = `batch-${Date.now()}`;
steps.push({
  stepId: batchStepId,
  type: 'prompt',
  payload: {
    prompt: userMessage,
    providers: providers,
    hidden: isSynthesisFirst,
    useThinking: useThinking || false,
    providerContexts: undefined // New conversation
  }
});

// Step 2: Optional synthesis
if (synthesis?.enabled && providers.length >= 2) {
  const synthStepId = `synthesis-${synthesis.provider}-${Date.now()}`;
  steps.push({
    stepId: synthStepId,
    type: 'synthesis',
    payload: {
      synthesisProvider: synthesis.provider,
      strategy: synthesis.strategy || 'fresh',
      sourceStepIds: [batchStepId],
      originalPrompt: userMessage,
      useThinking: useThinking && synthesis.provider === 'chatgpt'
    }
  });
}

// Step 3: Optional ensemble
if (ensemble?.enabled && providers.length >= 2) {
  const ensembleStepId = `ensemble-${ensemble.provider}-${Date.now()}`;
  steps.push({
    stepId: ensembleStepId,
    type: 'ensemble',
    payload: {
      ensembleProvider: ensemble.provider,
      strategy: ensemble.strategy || 'fresh',
      sourceStepIds: [batchStepId],
      originalPrompt: userMessage,
      useThinking: useThinking && ensemble.provider === 'chatgpt'
    }
  });
}

return {
  workflowId,
  context: {
    sessionId: sessionId || 'new-session',
    threadId: threadId || 'default-thread',
    targetUserTurnId: '', // Will be filled by caller
  },
  steps
};


}

/**

- CONTINUATION: User continues existing conversation
- Strategy: Same as new message, but with provider contexts
  */
  _compileContinuation(request) {
  const { sessionId, threadId, payload } = request;
  const { userMessage, providers, synthesis, ensemble, useThinking } = payload;


const workflowId = this._generateWorkflowId('continuation');
const steps = [];

// Step 1: Batch prompt with provider contexts
const batchStepId = `batch-${Date.now()}`;
steps.push({
  stepId: batchStepId,
  type: 'prompt',
  payload: {
    prompt: userMessage,
    providers: providers,
    hidden: false,
    useThinking: useThinking || false,
    providerContexts: this._getProviderContexts(sessionId, providers)
  }
});

// Step 2: Optional synthesis (rarely used in continuation)
if (synthesis?.enabled && providers.length >= 2) {
  const synthStepId = `synthesis-${synthesis.provider}-${Date.now()}`;
  steps.push({
    stepId: synthStepId,
    type: 'synthesis',
    payload: {
      synthesisProvider: synthesis.provider,
      strategy: 'continuation', // Use continuation strategy
      sourceStepIds: [batchStepId],
      originalPrompt: userMessage,
      useThinking: useThinking && synthesis.provider === 'chatgpt',
      continueConversationId: this._getConversationId(sessionId, synthesis.provider)
    }
  });
}

return {
  workflowId,
  context: {
    sessionId,
    threadId: threadId || 'default-thread',
    targetUserTurnId: '',
  },
  steps
};


}

/**

- RERUN SYNTHESIS: User clicks “Run Synthesis” on a historical round
- Strategy: Fetch historical batch outputs → synthesize with selected providers
  */
  _compileRerunSynthesis(request) {
  const { sessionId, threadId, payload } = request;
  const { historicalTurnId, providers, originalPrompt, useThinking } = payload;


const workflowId = this._generateWorkflowId('rerun-synthesis');
const steps = [];

// Create one synthesis step per selected provider
providers.forEach(provider => {
  const synthStepId = `synthesis-rerun-${provider}-${Date.now()}`;
  steps.push({
    stepId: synthStepId,
    type: 'synthesis',
    payload: {
      synthesisProvider: provider,
      strategy: 'fresh', // Reruns are always fresh
      sourceHistorical: {
        turnId: historicalTurnId,
        responseType: 'batch'
      },
      originalPrompt: originalPrompt,
      useThinking: useThinking && provider === 'chatgpt'
    }
  });
});

return {
  workflowId,
  context: {
    sessionId,
    threadId: threadId || 'default-thread',
    targetUserTurnId: historicalTurnId,
  },
  steps
};


}

/**

- RERUN ENSEMBLE: User clicks “Run Ensemble” on a historical round
- Strategy: Fetch historical batch outputs → ensemble with selected provider
  */
  _compileRerunEnsemble(request) {
  const { sessionId, threadId, payload } = request;
  const { historicalTurnId, provider, originalPrompt, useThinking } = payload;


const workflowId = this._generateWorkflowId('rerun-ensemble');

const ensembleStepId = `ensemble-rerun-${provider}-${Date.now()}`;
const steps = [{
  stepId: ensembleStepId,
  type: 'ensemble',
  payload: {
    ensembleProvider: provider,
    strategy: 'fresh',
    sourceHistorical: {
      turnId: historicalTurnId,
      responseType: 'batch'
    },
    originalPrompt: originalPrompt,
    useThinking: useThinking && provider === 'chatgpt'
  }
}];

return {
  workflowId,
  context: {
    sessionId,
    threadId: threadId || 'default-thread',
    targetUserTurnId: historicalTurnId,
  },
  steps
};


}

/**

- BRANCH: User creates new branch from historical turn
- Future feature - stubbed for completeness
  */
  _compileBranch(request) {
  throw new Error('Branch mode not yet implemented');
  }

// ==========================================================================
// HELPER METHODS
// ==========================================================================

/**

- Generate unique workflow ID
  */
  _generateWorkflowId(mode) {
    // FIX: Corrected template literal
    return `wf-${mode}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

/**

- Get provider contexts for continuation
  */
  _getProviderContexts(sessionId, providers) {
  if (!sessionId || sessionId === 'new-session') {
  return undefined;
  }


const contexts = this.sessionManager.getProviderContexts(sessionId);
const result = {};

providers.forEach(providerId => {
  if (contexts[providerId]) {
    result[providerId] = {
      meta: contexts[providerId].meta,
      continueThread: true
    };
  }
});

return Object.keys(result).length > 0 ? result : undefined;


}

/**

- Get conversation ID for a specific provider (for continuation strategy)
  */
  _getConversationId(sessionId, providerId) {
  if (!sessionId || sessionId === 'new-session') {
  return undefined;
  }


const contexts = this.sessionManager.getProviderContexts(sessionId);
return contexts[providerId]?.meta?.conversationId;


}

/**

- Validate ExecuteWorkflowRequest
  */
  _validateRequest(request) {
  if (!request) {
  throw new Error('Request is required');
  }


if (!request.mode) {
  throw new Error('mode is required');
}

if (!request.payload) {
  throw new Error('payload is required');
}

const { mode, payload } = request;

// Mode-specific validation
switch (mode) {
  case 'new-message':
  case 'continuation':
    if (!payload.userMessage || !payload.userMessage.trim()) {
      throw new Error('userMessage is required');
    }
    if (!payload.providers || payload.providers.length === 0) {
      throw new Error('providers must be non-empty array');
    }
    break;

  case 'rerun-synthesis':
    if (!payload.historicalTurnId) {
      throw new Error('historicalTurnId is required');
    }
    if (!payload.providers || payload.providers.length === 0) {
      throw new Error('providers must be non-empty array');
    }
    if (!payload.originalPrompt) {
      throw new Error('originalPrompt is required');
    }
    break;

  case 'rerun-ensemble':
    if (!payload.historicalTurnId) {
      throw new Error('historicalTurnId is required');
    }
    if (!payload.provider) {
      throw new Error('provider is required');
    }
    if (!payload.originalPrompt) {
      throw new Error('originalPrompt is required');
    }
    break;
}

// Validate provider IDs
const validProviders = ['claude', 'gemini', 'chatgpt', 'qwen'];
const providers = payload.providers || [payload.provider];
const invalidProviders = providers.filter(p => p && !validProviders.includes(p));

if (invalidProviders.length > 0) {
  throw new Error(`Invalid providers: ${invalidProviders.join(', ')}`);
}


}
}