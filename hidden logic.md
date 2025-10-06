 // Include any persisted continuation context for this provider/session so
      // hidden batch executions can continue existing conversations.
      const providerContext = ((sessionManager && typeof sessionManager.getProviderContexts === 'function')
        ? (sessionManager.getProviderContexts(sessionId)?.[providerId] || {})
        : {});
      const request = {
        originalPrompt: prompt,
        sessionId,
        meta: (providerContext?.meta || providerContext || {})
      };

      // Execute with fault isolation
      const result = await adapter.sendPrompt(
        request,
        (chunk) => {
          if (signal.aborted) return;
          onPartial(chunk);
        },
        signal
      );

      if (signal.aborted) return;
      
      console.log(`[FaultTolerantOrchestrator] Provider ${providerId} completed successfully`);
      onComplete(result);
      
    } catch (error) {
      if (signal.aborted) return;
      
      console.error(`[FaultTolerantOrchestrator] Provider ${providerId} failed:`, error);
      onError({
        code: error.code || 'PROVIDER_ERROR',
        message: error.message || 'Provider request failed',
        retryable: error.retryable !== false
      });
    }
  }

  async _executeContinuationRequest(providerId, prompt, sessionId, providerContext, signal, callbacks) {
    const { onPartial, onComplete, onError } = callbacks;
    
    try {
      console.log(`[FaultTolerantOrchestrator] Starting continuation for provider: ${providerId}`);
      
      const adapter = providerRegistry.getAdapter(providerId);
      if (!adapter) {
        throw new Error(`Provider ${providerId} not available`);
      }

      // Check if adapter supports continuation
      if (typeof adapter.sendContinuation !== 'function') {
        console.warn(`[FaultTolerantOrchestrator] Provider ${providerId} does not support continuation, falling back to sendPrompt`);
        
        const request = {
          originalPrompt: prompt,
          sessionId,
          meta: providerContext
        };

        const result = await adapter.sendPrompt(
          request,
          (chunk) => {
            if (signal.aborted) return;
            onPartial(chunk);
          },
          signal
        );

        if (signal.aborted) return;
        onComplete(result);
        return;
      }

      // Use continuation method with preserved context
      const result = await adapter.sendContinuation(
        prompt,
        providerContext,
        sessionId,
        (chunk) => {
          if (signal.aborted) return;
          onPartial(chunk);
        },
        signal
      );

      if (signal.aborted) return;
      
      if (result.ok) {
        console.log(`[FaultTolerantOrchestrator] Provider ${providerId} continuation completed successfully`);
        onComplete(result);
      } else {
        console.error(`[FaultTolerantOrchestrator] Provider ${providerId} continuation failed:`, result.errorCode);
        onError({
          code: result.errorCode || 'CONTINUATION_ERROR',
          message: result.meta?.error || 'Provider continuation failed',
        });
      }
      
    } catch (error) {
      if (signal.aborted) return;
      
      console.error(`[FaultTolerantOrchestrator] Provider ${providerId} continuation failed:`, error);
      onError({
        code: error.code || 'CONTINUATION_ERROR',
        message: error.message || 'Provider continuation failed',
        retryable: error.retryable !== false
      });
    }
  }

  _abortRequest(sessionId) {
    const request = this.activeRequests.get(sessionId);
    if (!request) return;

    console.log(`[FaultTolerantOrchestrator] Aborting request: ${sessionId}`);
    
    for (const [providerId, controller] of request.abortControllers) {
      try {
        controller.abort();
      } catch (error) {
        console.warn(`[FaultTolerantOrchestrator] Failed to abort ${providerId}:`, error);
      }
    }
    
    this.activeRequests.delete(sessionId);
    
    // Disable aggressive keepalive when request is aborted
    if (this.lifecycleManager) {
      console.log('[FaultTolerantOrchestrator] Disabling aggressive keepalive after abort');
      this.lifecycleManager.keepalive(false);
      // Also emit workflow.end event to return lifecycle manager to idle mode
      chrome.runtime.sendMessage({ type: 'workflow.end', sessionId });
    }
  }

  getActiveRequestCount() {
    return this.activeRequests.size;
  }
}


// =============================================================================
// POPUP PORT CONNECTION HANDLER - STREAMING FIRST
// =============================================================================
chrome.runtime.onConnect.addListener((port) => {
  console.log("[HTOS] Port connected:", port.name);

  if (port.name === "htos-popup") {
    const connectionId = `popup-${Date.now()}`;
    
    // Register this connection in the event router
    eventRouter.registerConnection(connectionId, (message) => {
      try {
        port.postMessage(message);
      } catch (error) {
        console.warn("[HTOS] Port message failed:", error);
        eventRouter.unregisterConnection(connectionId);
      }
    });

    port.onMessage.addListener(async (message) => {
      console.log("[HTOS] Message from popup:", message.type);

      // Minimal reconnect handshake to support UI ensurePort()
      if (message.type === "reconnect") {
        try {
          const { uiInstanceId, lastSeenVersion, sessionId } = message;
          // For now we simply acknowledge; future: include session snapshot
          port.postMessage({
            type: "reconnect_ack",
            uiInstanceId,
            lastSeenVersion,
            sessionId: sessionId || null,
            serverTime: Date.now(),
          });
        } catch (e) {
          console.warn('[HTOS] reconnect handler failed:', e);
        }
        return;
      }

      // Hidden Round 1: parallel fanout without visible streaming
      if (message.type === "hiddenBatchExecute") {
        try {
          const { prompt, providers = [], sessionId } = message;
          const availableProviders = (Array.isArray(providers) ? providers : []).filter((p) => providerRegistry.isAvailable(p));

          const capturedSessionId = sessionId || `sid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // Ensure session exists and broadcast session binding to UI early
          try { sessionManager.getOrCreateSession(capturedSessionId, String(prompt || "")); } catch (_) {}
          try { port.postMessage({ type: "session", sessionId: capturedSessionId }); } catch (_) {}

          if (availableProviders.length === 0) {
            try {
              port.postMessage({
                type: "HIDDEN_BATCH_COMPLETE",
                sessionId: capturedSessionId,
                payload: { successCount: 0, failCount: (Array.isArray(providers) ? providers.length : 0) }
              });
            } catch (_) {}
            return;
          }

          // Execute non-blocking fanout. We suppress partial streaming; only emit per-provider completion.
          await self.faultTolerantOrchestrator.executeParallelFanout(
            String(prompt || ""),
            availableProviders,
            {
              sessionId: capturedSessionId,
              onPartial: (_providerId, _chunk) => {
                // Intentionally no-op for hidden batch
              },
              onProviderComplete: (providerId, result) => {
                // Merge continuation context and emit hidden result snapshot
                try { 
                  sessionManager.updateProviderContext(capturedSessionId, providerId, result, true, { skipSave: true }); 
                } catch (_) {}
                try {
                  port.postMessage({
                    type: "HIDDEN_BATCH_RESULT",
                    sessionId: capturedSessionId,
                    providerId,
                    text: result?.text || "",
                    ok: result?.ok !== false,
                    meta: result?.meta || {}
                  });
                } catch (e) {
                  console.warn('[HTOS] Failed to emit HIDDEN_BATCH_RESULT', e);
                }
              },
              onError: (providerId, error) => {
                try {
                  port.postMessage({
                    type: "HIDDEN_BATCH_RESULT",
                    sessionId: capturedSessionId,
                    providerId,
                    text: "",
                    ok: false,
                    error: error?.message || "Provider error"
                  });
                } catch (e) {
                  console.warn('[HTOS] Failed to emit HIDDEN_BATCH_RESULT (error)', e);
                }
              },
              onAllComplete: (resultsMap, errorsMap) => {
                try {
                  const successCount = Array.from(resultsMap.values()).filter((r) => r && r.ok !== false).length;
                  const errorCount = Array.from(errorsMap.values()).length;
                  port.postMessage({
                    type: "HIDDEN_BATCH_COMPLETE",
                    sessionId: capturedSessionId,
                    payload: { successCount, failCount: errorCount }
                  });
                } catch (e) {
                  console.warn('[HTOS] Failed to emit HIDDEN_BATCH_COMPLETE', e);
                }
              }
            }
          );
        } catch (e) {
          console.error('[HTOS] hiddenBatchExecute handler failed', e);
          try {
            port.postMessage({ type: "HIDDEN_BATCH_COMPLETE", sessionId: message.sessionId || null, payload: { successCount: 0, failCount: (Array.isArray(message.providers) ? message.providers.length : 0) } });
          } catch (_) {}
        }
        return;
      }

      if (message.type === "sendPrompt") {
        const { prompt, providers, sessionId } = message;
        console.log(`[HTOS] Processing prompt for ${providers.length} providers`);

        // Validate providers
        const availableProviders = providers.filter(p => 
          providerRegistry.isAvailable(p)
        );
        
        if (availableProviders.length === 0) {
          port.postMessage({
            type: "error",
            data: {
              message: "No available providers",
              code: "NO_PROVIDERS"
            }
          });
          return;
        }

        // Send immediate acknowledgment
        port.postMessage({
          type: "result",
          providerId: "system",
          text: `Starting parallel execution across ${availableProviders.length} provider(s)...`,
          ok: true,
          partial: false
        });

        // Execute parallel fanout - non-blocking
        // Ensure a stable session id is available synchronously so callbacks
        // used by the orchestrator always reference the intended session.
        const capturedSessionId = sessionId || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log('[HTOS] Using capturedSessionId for sendPrompt:', capturedSessionId);

        // Ensure session state exists before starting the fanout so callbacks
        // can immediately merge contexts and logs have a target session.
        try {
          sessionManager.getOrCreateSession(capturedSessionId);
        } catch (e) {
          console.warn('[HTOS] Failed to create session before fanout', e);
        }

        const roundId = sessionManager.beginRound(capturedSessionId, String(prompt || ""));
        const fanout = await self.faultTolerantOrchestrator.executeParallelFanout(
          prompt,
          availableProviders,
          {
            sessionId: capturedSessionId,
             onAllComplete: (resultsMap, errorsMap) => {
               try {
                 // Mark round completion (don't save yet, will be handled by the final save)
                 try { sessionManager.completeRound(capturedSessionId, roundId, { skipSave: true }); } catch {}
                 const stepResults = Array.from(resultsMap.entries()).map(([providerId, res]) => ({
                   providerId,
                   ok: res?.ok !== false,
                   text: res?.text || "",
                   meta: res?.meta || {}
                 }));

                 const responses = Object.fromEntries(stepResults.map(r => [r.providerId, { text: r.text }]));

                 port.postMessage({
                   type: "WORKFLOW_COMPLETE",
                   sessionId: capturedSessionId,
                   stepResults,
                   results: responses,
                   payload: { stepResults, responses }
                 });

                 // Finalize persistence at end-of-turn (single consolidated save)
                 try {
                   sessionManager.saveSession(capturedSessionId).catch(err => {
                     console.error('[HTOS] Final save failed (sendPrompt):', err);
                   });
                 } catch (_) {}
               } catch (e) {
                 console.warn('[HTOS] onAllComplete (sendPrompt) failed:', e);
               }
             },
             onPartial: (providerId, chunk) => {
               if (chunk && chunk.partial) {
                 // Instrument which session id is used for this partial
                 try { console.log(`[HTOS] onPartial session=${capturedSessionId} provider=${providerId} textLen=${(chunk.text||'').length}`); } catch {}
                 const delta = makeDelta(capturedSessionId, providerId, chunk.text || "");
                 if (delta) {
                   port.postMessage({
                     type: "result",
                     providerId,
                     text: delta,
                     partial: true,
                     ok: true,
                     sessionId: capturedSessionId,
                   });
                 }
               }
             },
             onProviderComplete: (providerId, result) => {
               console.log(`[HTOS] Provider ${providerId} completed`);
               
               // Instrument and then update session context with result for future continuations
               try { console.log(`[HTOS] onProviderComplete session=${capturedSessionId} provider=${providerId} resultLen=${(result?.text||'').length}`); } catch {}
               if (result && capturedSessionId) {
                 sessionManager.updateProviderContext(capturedSessionId, providerId, result, true, { skipSave: true });
                 // Also persist into the current round transcript
                 try { sessionManager.updateRoundProvider(capturedSessionId, roundId, providerId, result, { skipSave: true }); } catch {}
               }
               
               port.postMessage({
                 type: "result",
                 providerId,
                 text: result?.text || "",
                 ok: result?.ok !== false,
                 partial: false,
                 meta: result?.meta || {},
                 sessionId: capturedSessionId,
               });
             },
             onError: (providerId, error) => {
               console.log(`[HTOS] Provider ${providerId} failed for session=${capturedSessionId}:`, error.message);
               port.postMessage({
                 type: "result",
                 providerId,
                 text: error.message || "Provider error occurred",
                 ok: false,
                 partial: false,
                 error,
                 sessionId: capturedSessionId,
               });
             }
           }
         );

        console.log(`[HTOS] Parallel fanout initiated with session: ${capturedSessionId}`);
         // Inform UI about the session id to guarantee consistent continuation usage
         try {
           port.postMessage({ type: "session", sessionId: capturedSessionId });
         } catch (e) {
           console.warn('[HTOS] Failed to emit session id to port', e);
         }
       }

      if (message.type === "continue") {
        const { prompt, providers, sessionId, providerContexts } = message;
        console.log(`[HTOS] Processing continuation for session ${sessionId} with ${providers.length} providers`);

        // Validate providers
        const availableProviders = providers.filter(p => 
          providerRegistry.isAvailable(p)
        );
        
        if (availableProviders.length === 0) {
          port.postMessage({
            type: "error",
            data: {
              message: "No available providers for continuation",
              code: "NO_PROVIDERS"
            }
          });
          return;
        }

        // Enhanced session management for continuation
        // Get contexts from SessionManager instead of relying on UI state
        const storedContexts = sessionManager.getProviderContexts(sessionId);
        const uiContexts = providerContexts || {};
        
        // Merge UI contexts with stored contexts, preferring stored for continuation data
        const mergedContexts = {};
        for (const providerId of availableProviders) {
          mergedContexts[providerId] = {
            ...uiContexts[providerId],
            ...storedContexts[providerId],
            // Ensure continuation identifiers are preserved
            meta: {
              ...uiContexts[providerId]?.meta,
              ...storedContexts[providerId]?.meta
            }
          };
        }
        
        console.log("[HTOS] Merged provider contexts for continuation:", mergedContexts);
        sessionManager.logSessionState(sessionId);

        // Send immediate acknowledgment
        port.postMessage({
          type: "result",
          providerId: "system",
          text: `Continuing conversation across ${availableProviders.length} provider(s)...`,
          ok: true,
          partial: false
        });

        // Start a new round for continuation prompt
        const roundId = sessionManager.beginRound(sessionId, String(prompt || ""));
        // Execute continuation fanout - non-blocking
        const result = await self.faultTolerantOrchestrator.executeContinuationFanout(
          prompt,
          availableProviders,
          sessionId,
          mergedContexts,
          {
            onPartial: (providerId, chunk) => {
              if (chunk && chunk.partial) {
                const delta = makeDelta(sessionId, providerId, chunk.text || "");
                if (delta) {
                  port.postMessage({
                    type: "result",
                    providerId,
                    text: delta,
                    partial: true,
                    ok: true
                  });
                }
              }
            },
            onProviderComplete: (providerId, result) => {
              console.log(`[HTOS] Continuation provider ${providerId} completed`);
              
              // Update session context with result
              if (result && sessionId) {
                sessionManager.updateProviderContext(sessionId, providerId, result, true, { skipSave: true });
                try { sessionManager.updateRoundProvider(sessionId, roundId, providerId, result, { skipSave: true }); } catch {}
              }
              
              port.postMessage({
                type: "result",
                providerId,
                text: result?.text || "",
                ok: result?.ok !== false,
                partial: false,
                meta: result?.meta || {},
                sessionId,
              });
            },
            onError: (providerId, error) => {
              console.log(`[HTOS] Continuation provider ${providerId} failed:`, error.message);
              port.postMessage({
                type: "result",
                providerId,
                text: error.message || "Provider continuation error occurred",
                ok: false,
                partial: false,
                error,
                sessionId,
              });
            },
            onAllComplete: (resultMap, errorMap) => {
              try {
                console.log(`[HTOS] Continuation onAllComplete fired for session`, sessionId);
                try { sessionManager.completeRound(sessionId, roundId, { skipSave: true }); } catch {}
                // Lightweight beacon to guarantee UI event
                port.postMessage({ type: "WORKFLOW_COMPLETE", sessionId, results: [] });
              } catch(e) {
                console.warn('[HTOS] Failed to emit continuation WORKFLOW_COMPLETE beacon', e);
              }

              const stepResults = availableProviders.map(pid => {
                const res = resultMap.get(pid);
                const err = errorMap.get(pid);
                return {
                  provider: pid,
                  status: res ? 'completed' : 'failed',
                  result: res ? { response: res.text || '' } : undefined,
                  error: res ? undefined : err?.message || 'provider_failed'
                };
              });

              const responses = availableProviders.map(pid => ({
                providerId: pid,
                text: (resultMap.get(pid)?.text) || (errorMap.get(pid)?.message) || ''
              }));

              try {
                port.postMessage({
                  type: 'WORKFLOW_COMPLETE',
                  sessionId,
                  stepResults,
                  results: responses,
                  payload: { stepResults, responses }
                });
                // Finalize persistence for continuation turn
                try {
                  sessionManager.saveSession(sessionId).catch(err => {
                    console.error('[HTOS] Final save failed (continue):', err);
                  });
                } catch (_) {}
              } catch(err) {
                console.error('[HTOS] Failed to emit continuation WORKFLOW_COMPLETE payload', err);
              }
            }
          }
        );

        console.log(`[HTOS] Continuation fanout initiated for session: ${sessionId}`);
      }

      if (message.type === 'abort') {
        try {
          const { sessionId } = message;
          if (sessionId && self.faultTolerantOrchestrator) {
            self.faultTolerantOrchestrator._abortRequest(sessionId);
            port.postMessage({ type: 'workflow.end', sessionId });
          }
        } catch (e) {
          console.warn('[HTOS] abort handler failed', e);
        }
        return;
      }

      if (message.type === "synthesize") {
        try {
          let sessionId = message.sessionId || `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const isHidden = message.hidden === true;

          // Normalize providers: support single provider (legacy) or array (batch)
          const singleProvider = (message.provider ? String(message.provider) : (message.synthesisProvider ? String(message.synthesisProvider) : "")).toLowerCase();
          const providersArray = Array.isArray(message.providers)
            ? message.providers.map((p) => String(p).toLowerCase())
            : null;

          const targetProviders = providersArray && providersArray.length > 0 ? providersArray : (singleProvider ? [singleProvider] : []);

          if (!targetProviders.length) {
            port.postMessage({
              type: "WORKFLOW_ERROR",
              sessionId,
              payload: { phase: "synthesis", error: "No synthesis provider(s) specified" },
            });
            return;
          }

          // Validate at least one available provider
          const availableProviders = targetProviders.filter((p) => providerRegistry.isAvailable(p));
          if (!availableProviders.length) {
            port.postMessage({
              type: "WORKFLOW_ERROR",
              sessionId,
              payload: { phase: "synthesis", providers: targetProviders, error: "Provider(s) unavailable" },
            });
            return;
          }

          if (!self.orchestrator) {
            port.postMessage({
              type: "WORKFLOW_ERROR",
              sessionId,
              payload: { phase: "synthesis", providers: availableProviders, error: "Orchestrator not initialized" },
            });
            return;
          }

          // Ensure session exists and gather contexts
          const session = (__HTOS_SESSIONS[sessionId] = __HTOS_SESSIONS[sessionId] || { originalPrompt: "", providers: {} });
          const providerContexts = sessionManager.getProviderContexts(sessionId) || {};

          const originalPrompt = String(message.originalPrompt || session.originalPrompt || "");

          // Prepare allBatchResults map once
          const allBatchResults = (message.allBatchResults && typeof message.allBatchResults === 'object') ? message.allBatchResults : null;

          // Fan-out synthesis calls in parallel
          const synthOutcomes = {};
          const synthPromises = availableProviders.map(async (synthesisProvider) => {
            try {
              // Build otherResults per target provider
              let otherResults = [];
              if (allBatchResults) {
                // Merge missing entries from providerContexts so every target receives all other outputs
                const merged = { ...allBatchResults };
                try {
                  Object.entries(providerContexts).forEach(([pid, ctx]) => {
                    if (merged[pid] == null && ctx && typeof ctx.text === 'string' && ctx.text.length > 0) {
                      merged[pid] = ctx.text;
                    }
                  });
                } catch {}
                otherResults = Object.entries(merged)
                  .filter(([pid]) => pid !== synthesisProvider)
                  .map(([pid, text]) => ({ providerId: pid, text: text || "" }));
                try { console.log('[HTOS] Using allBatchResults for synthesis', { synthesisProvider, count: otherResults.length }); } catch {}
              } else {
                otherResults = Object.entries(providerContexts)
                  .filter(([pid]) => pid !== synthesisProvider)
                  .map(([pid, ctx]) => ({ providerId: pid, text: ctx?.text || "" }));
                try { console.log('[HTOS] Using provider contexts for synthesis (fallback)', { synthesisProvider, count: otherResults.length }); } catch {}
              }

              // Provider-specific meta (preserve continuation)
              const meta = {};
              const synthMeta = providerContexts[synthesisProvider]?.meta || {};
              if (synthesisProvider === "claude" && (synthMeta.chatId || synthMeta.threadUrl)) {
                meta.chatId = synthMeta.chatId || synthMeta.threadUrl;
              } else if (synthesisProvider === "gemini" && synthMeta.cursor) {
                meta.cursor = synthMeta.cursor;
              } else if (synthesisProvider === "chatgpt" && (synthMeta.conversationId || synthMeta.parentMessageId || synthMeta.messageId)) {
                meta.conversationId = synthMeta.conversationId;
                meta.parentMessageId = synthMeta.parentMessageId;
                meta.messageId = synthMeta.messageId;
              }

              // Execute synthesis for this provider
              const res = await self.orchestrator.batchPrompt(originalPrompt, {
                synthesis: {
                  only: true,
                  providerId: synthesisProvider,
                  otherResults,
                  meta,
                },
                onPartial: (_pid, chunk) => {
                  try {
                    if (chunk && chunk.partial) {
                      if (!isHidden) {
                        const delta = makeDelta(sessionId, synthesisProvider, chunk.text || "");
                        if (delta) {
                          port.postMessage({
                            type: "SYNTHESIS_PARTIAL",
                            sessionId,
                            provider: synthesisProvider,
                            text: delta,
                            payload: { provider: synthesisProvider, text: delta },
                          });
                        }
                      } else {
                        // Suppress partials or emit hidden partials if needed later
                      }
                    }
                  } catch (e) {
                    console.warn("[HTOS] Failed to stream synthesis partial over port", e);
                  }
                },
              });

              const s = res?.synthesis || null;
              try { console.log('[HTOS] Synthesis result meta', { sessionId, synthesisProvider, meta: s?.meta }); } catch {}

              // Persist provider context for potential continuation or subsequent synthesis
              try { sessionManager.updateProviderContext(sessionId, synthesisProvider, { text: s?.text || "", meta: s?.meta || {} }, true, { skipSave: true }); } catch {}

              // Completion over the port (per provider)
              if (!isHidden) {
                port.postMessage({
                  type: "SYNTHESIS_COMPLETE",
                  sessionId,
                  provider: synthesisProvider,
                  text: s?.text || "",
                  payload: [{ provider: synthesisProvider, response: s?.text || "" }],
                });
              } else {
                port.postMessage({
                  type: "HIDDEN_SYNTHESIS_COMPLETE",
                  sessionId,
                  provider: synthesisProvider,
                  text: s?.text || "",
                  payload: [{ provider: synthesisProvider, response: s?.text || "" }],
                });
              }
              // Track outcome
              synthOutcomes[synthesisProvider] = s?.ok !== false;
            } catch (err) {
              console.error("[HTOS] Synthesis error for provider", synthesisProvider, err);
              if (!isHidden) {
                port.postMessage({
                  type: "WORKFLOW_ERROR",
                  sessionId,
                  payload: { phase: "synthesis", provider: synthesisProvider, error: err?.message || "Synthesis failed" },
                });
              } else {
                port.postMessage({
                  type: "HIDDEN_SYNTHESIS_COMPLETE",
                  sessionId,
                  provider: synthesisProvider,
                  text: "",
                  error: err?.message || "Synthesis failed",
                });
              }
              // Track failure outcome
              synthOutcomes[synthesisProvider] = false;
            }
          });

          // Wait for all syntheses to settle (non-blocking for streaming, but we keep the try/catch scope)
          await Promise.allSettled(synthPromises);

          // Emit aggregator for hidden flows so UI can advance to Round 3
          if (isHidden) {
            try {
              const values = Object.values(synthOutcomes);
              const successCount = values.filter((v) => v).length;
              const failCount = values.length - successCount;
              port.postMessage({ type: 'HIDDEN_SYNTHESIS_ALL_COMPLETE', sessionId, payload: { successCount, failCount } });
            } catch {}
          }

        } catch (error) {
          console.error("[HTOS] Port synthesis error:", error);
          const sessionId = message.sessionId || "unknown";
          const synthesisProvider = String(message.provider || "").toLowerCase();
          port.postMessage({
            type: "WORKFLOW_ERROR",
            sessionId,
            payload: { phase: "synthesis", provider: synthesisProvider, error: error?.message || "Synthesis failed" },
          });
        }
      }

      // FINAL ENSEMBLING (Round 3) — stream a single visible answer from chosen provider
      if (message.type === 'ensemble_finalize') {
        try {
          const { sessionId, userPrompt, modelOutputs, ensemblerProvider, ensemblerPrompt } = message;
          const providerId = String(ensemblerProvider || 'claude').toLowerCase();
          const adapter = providerRegistry.getAdapter(providerId);
          if (!adapter) {
            port.postMessage({ type: 'WORKFLOW_ERROR', sessionId, payload: { phase: 'ensemble_finalize', error: 'Ensembler provider unavailable' } });
            return;
          }

          const request = {
            originalPrompt: ensemblerPrompt,
            sessionId,
            meta: {
              // carry forward minimal context if exists
              ...(sessionManager.getProviderContexts(sessionId)?.[providerId]?.meta || {}),
              ensemble: true,
              userPrompt,
              modelOutputs,
            },
          };

          const startedAt = Date.now();
          const controller = new AbortController();
          const result = await adapter.sendPrompt(
            request,
            (chunk) => {
              if (chunk && chunk.partial) {
                const delta = makeDelta(sessionId, providerId, chunk.text || "");
                if (delta) {
                  port.postMessage({ type: 'result', providerId: providerId, text: delta, partial: true, ok: true, sessionId });
                }
              }
            },
            controller.signal
          );

          // completion
          port.postMessage({ type: 'result', providerId: providerId, text: result?.text || '', partial: false, ok: result?.ok !== false, sessionId, meta: result?.meta || {} });
          const duration = Date.now() - startedAt;
          try { console.log('[HTOS] ensemble_finalize complete', { sessionId, providerId, duration }); } catch {}
          // Persist final ensemble result at end-of-turn
          try {
            sessionManager.updateProviderContext(sessionId, providerId, { text: result?.text || '', meta: result?.meta || {} }, true, { skipSave: true });
            sessionManager.saveSession(sessionId).catch(err => {
              console.error('[HTOS] Final save failed (ensemble_finalize):', err);
            });
          } catch (_) {}
        } catch (e) {
          console.error('[HTOS] ensemble_finalize failed', e);
          try { port.postMessage({ type: 'WORKFLOW_ERROR', sessionId: message.sessionId, payload: { phase: 'ensemble_finalize', error: e?.message || String(e) } }); } catch {}
        }
      }

    });

    port.onDisconnect.addListener(() => {
      console.log("[HTOS] Port disconnected:", port.name);
      eventRouter.unregisterConnection(connectionId);
    });
  }
});