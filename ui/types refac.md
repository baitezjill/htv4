## Now Update App.tsx

Here’s how to replace all WorkflowBuilder calls with simple ExecuteWorkflowRequest:

typescript
// ============================================================================
// BEFORE: Using WorkflowBuilder (imperative, verbose)
// ============================================================================

const handleSendPrompt = useCallback(async (prompt: string) => {
  const builder = new WorkflowBuilder({ 
    sessionId: currentSessionId, 
    targetUserTurnId: userTurn.id, 
    uiTabId 
  });
  
  const shouldUseSynthesis = synthesisProvider && activeProviders.length > 1;

  if (shouldUseSynthesis) {
    const batchStepId = builder.addBatchPrompt(prompt, activeProviders, {
      hidden: true,
      useThinking: computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: prompt })
    });
    builder.addSynthesis(synthesisProvider as ProviderKey, [batchStepId], prompt, {
      useThinking: thinkOnChatGPT && synthesisProvider === 'chatgpt'
    });
  } else {
    builder.addBatchPrompt(prompt, activeProviders, {
      useThinking: computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: prompt })
    });
  }

  await api.executeWorkflow(builder.build());
}, [/* deps */]);

// ============================================================================
// AFTER: Using ExecuteWorkflowRequest (declarative, simple)
// ============================================================================

const handleSendPrompt = useCallback(async (prompt: string) => {
  const request: ExecuteWorkflowRequest = {
    sessionId: currentSessionId || 'new-session',
    threadId: 'default-thread',
    mode: 'new-message',
    payload: {
      userMessage: prompt,
      providers: activeProviders,
      synthesis: synthesisProvider && activeProviders.length > 1 ? {
        enabled: true,
        provider: synthesisProvider as ProviderKey,
        strategy: 'fresh'
      } : undefined,
      useThinking: computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: prompt })
    }
  };

  await api.executeWorkflow(request);
}, [currentSessionId, activeProviders, synthesisProvider, thinkOnChatGPT]);

// ============================================================================
// Continuation
// ============================================================================

const handleContinuation = useCallback(async (prompt: string) => {
  const request: ExecuteWorkflowRequest = {
    sessionId: currentSessionId,
    threadId: 'default-thread',
    mode: 'continuation',
    payload: {
      userMessage: prompt,
      providers: activeProviders,
      useThinking: computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: prompt })
    }
  };

  await api.executeWorkflow(request);
}, [currentSessionId, activeProviders, thinkOnChatGPT]);

// ============================================================================
// Rerun Synthesis (from round action bar)
// ============================================================================

const handleRunSynthesisForRound = useCallback(async (userTurnId: string) => {
  const selected = Object.entries(synthSelectionsByRound[userTurnId] || {})
    .filter(([_, on]) => on)
    .map(([pid]) => pid);

  if (selected.length === 0) return;

  const roundInfo = findRoundForUserTurn(userTurnId);
  if (!roundInfo) return;

  const request: ExecuteWorkflowRequest = {
    sessionId: currentSessionId,
    threadId: 'default-thread',
    mode: 'rerun-synthesis',
    payload: {
      historicalTurnId: userTurnId,
      providers: selected as ProviderKey[],
      originalPrompt: roundInfo.user.text || '',
      useThinking: !!thinkSynthByRound[userTurnId]
    }
  };

  await api.executeWorkflow(request);
}, [currentSessionId, synthSelectionsByRound, thinkSynthByRound, findRoundForUserTurn]);

// ============================================================================
// Rerun Ensemble (from round action bar)
// ============================================================================

const handleRunEnsembleForRound = useCallback(async (userTurnId: string) => {
  const provider = ensembleSelectionByRound[userTurnId];
  if (!provider) return;

  const roundInfo = findRoundForUserTurn(userTurnId);
  if (!roundInfo) return;

  const request: ExecuteWorkflowRequest = {
    sessionId: currentSessionId,
    threadId: 'default-thread',
    mode: 'rerun-ensemble',
    payload: {
      historicalTurnId: userTurnId,
      provider: provider as ProviderKey,
      originalPrompt: roundInfo.user.text || '',
      useThinking: !!thinkEnsembleByRound[userTurnId] && provider === 'chatgpt'
    }
  };

  await api.executeWorkflow(request);
}, [currentSessionId, ensembleSelectionByRound, thinkEnsembleByRound, findRoundForUserTurn]);
