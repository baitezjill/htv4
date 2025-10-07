async function _executeWorkflow(prompt, providers, services, sessionId, port, options = {}) {
  const { withContext = false } = options;
  // FIX: Extract useThinking from the options object.
  const useThinking = options.useThinking || false;
  
  try {
    // 1. Generate sessionId if not provided and post back to UI immediately
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    port.postMessage({
      type: 'SESSION_STARTED',
      responseType: 'session',
      sessionId,
      payload: { sessionId }
    });

    // 2. Begin a new round in SessionManager
    const roundId = sessionManager.beginRound(sessionId, prompt);
    
    // 3. Execute the Batch Step
    const collectedBatchResults = new Map();

    if (services.batch && providers && providers.length > 0) {
      await new Promise((resolve, reject) => {
        const batchOptions = {
          sessionId,
          // FIX: Pass the useThinking flag to the orchestrator options.
          useThinking,
          onPartial: (providerId, chunk) => {
            if (chunk && chunk.partial) {
              const delta = makeDelta(sessionId, providerId, chunk.text || "");
              if (delta) {
                port.postMessage({
                  type: 'BATCH_PARTIAL',
                  responseType: 'batch',
                  sessionId,
                  providerId,
                  text: delta,
                  partial: true
                });
              }
            }
          },
          onProviderComplete: (providerId, result) => {
            port.postMessage({
              type: 'BATCH_COMPLETE',
              responseType: 'batch',
              sessionId,
              providerId,
              text: result?.text || '',
              partial: false,
              ok: result?.ok !== false,
              meta: result?.meta || {}
            });
            
            if (result?.ok !== false && result?.text) {
              collectedBatchResults.set(providerId, result.text);
            }
            
            sessionManager.updateRoundProvider(sessionId, roundId, providerId, result, { skipSave: true });
          },
          onError: (providerId, error) => {
            port.postMessage({
              type: 'BATCH_ERROR',
              responseType: 'batch',
              sessionId,
              providerId,
              error: error?.message || 'Batch request failed'
            });
          },
          onAllComplete: () => {
            resolve();
          }
        };

        if (withContext) {
          const providerContexts = sessionManager.getProviderContexts(sessionId);
          self.faultTolerantOrchestrator.executeContinuationFanout(
            prompt, providers, sessionId, providerContexts, batchOptions
          ).catch(reject);
        } else {
          // FIX: The call to executeParallelFanout was missing the options object.
          // It now correctly passes `batchOptions`.
          self.faultTolerantOrchestrator.executeParallelFanout(
            prompt, providers, batchOptions
          ).catch(reject);
        }
      });
    }

    const finalBatchResults = Object.fromEntries(collectedBatchResults);

    // 4. Execute Subsequent Services in Parallel
    const tasks = [];

    if (services.synthesis && services.synthesis.providers && services.synthesis.providers.length > 0) {
      for (const synthProvider of services.synthesis.providers) {
        tasks.push(
          // FIX: Pass the useThinking flag down to the synthesis step.
          runSynthesisStep(prompt, finalBatchResults, synthProvider, sessionId, port, { useThinking })
        );
      }
    }

    if (services.ensemble && services.ensemble.provider) {
      tasks.push(
        // FIX: Pass the useThinking flag down to the ensemble step.
        runEnsembleStep(prompt, finalBatchResults, services.ensemble.provider, sessionId, port, { useThinking })
      );
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }

    // 5. Complete the round and persist results
    sessionManager.completeRound(sessionId, roundId, { skipSave: true });
    await sessionManager.saveSession(sessionId);
    
    // 6. Send final completion message
    port.postMessage({
      type: 'WORKFLOW_COMPLETE',
      responseType: 'complete',
      sessionId,
      payload: { sessionId, roundId }
    });

  } catch (error) {
    console.error('[HTOS] _executeWorkflow error:', error);
    port.postMessage({
      type: 'WORKFLOW_ERROR',
      responseType: 'error',
      sessionId: sessionId || 'unknown',
      payload: { phase: 'workflow', error: error?.message || 'Workflow execution failed' }
    });
  }
}