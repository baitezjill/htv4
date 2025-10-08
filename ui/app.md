


import { useState, useEffect, useCallback, useRef } from 'react';
import { VariableSizeList as List, ListChildComponentProps } from 'react-window';
import React from 'react';
import { TurnMessage, UserTurn, AiTurn, ProviderResponse, AppStep, HistorySessionSummary, LLMProvider, isUserTurn, isAiTurn, UiPhase, ViewMode, ProviderResponseStatus } from './types';
import { LLM_PROVIDERS_CONFIG, EXAMPLE_PROMPT } from './constants';
import { computeThinkFlag } from '../src/think/lib/think/computeThinkFlag.js';
import UserTurnBlock from './components/UserTurnBlock';
import AiTurnBlock from './components/AiTurnBlock';
import ChatInput from './components/ChatInput';
import HistoryPanel from './components/HistoryPanel';
import ModelTray from './components/ModelTray';
import { MenuIcon } from './components/Icons';
import api from './services/extension-api';
import persistenceService from './services/persistence';
import { useDelegatedScroll } from './hooks/useDelegatedScroll';
import { StreamingBuffer } from './utils/streamingBuffer';
import ComposerMode from './components/composer/ComposerMode';
import { WorkflowBuilder } from './services/workflow-builder'; // NEW
import { ProviderKey } from '../shared/contract'; // NEW

const App = () => {
  // State remains largely the same
  const [messages, setMessages] = useState<TurnMessage[]>([]);
  const [pendingUserTurns, setPendingUserTurns] = useState<Map<string, UserTurn>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<HistorySessionSummary[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [currentAppStep, setCurrentAppStep] = useState<AppStep>('initial');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [uiTabId, setUiTabId] = useState<number | undefined>();
  const [uiPhase, setUiPhase] = useState<UiPhase>('idle');
  const [isContinuationMode, setIsContinuationMode] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Record<string, boolean>>(
    LLM_PROVIDERS_CONFIG.reduce<Record<string, boolean>>((acc, provider) => {
      acc[provider.id] = ['claude', 'gemini', 'chatgpt'].includes(provider.id);
      return acc;
    }, {})
  );
  const [synthesisProvider, setSynthesisProvider] = useState<string | null>('gemini');
  const [showSourceOutputs, setShowSourceOutputs] = useState<boolean>(false);
  const [providerContexts, setProviderContexts] = useState<Record<string, any>>({});
  const [synthSelectionsByRound, setSynthSelectionsByRound] = useState<Record<string, Record<string, boolean>>>({});
  const [ensembleSelectionByRound, setEnsembleSelectionByRound] = useState<Record<string, string | null>>({});
  const [thinkOnChatGPT, setThinkOnChatGPT] = useState<boolean>(false);
  const [thinkSynthByRound, setThinkSynthByRound] = useState<Record<string, boolean>>({});
  const [thinkEnsembleByRound, setThinkEnsembleByRound] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.CHAT);
  const [activeComposerTurn, setActiveComposerTurn] = useState<AiTurn | null>(null);

  // Refs remain the same
  const activeAiTurnIdRef = useRef<string | null>(null);
  const listRef = useRef<List | null>(null);
  const outerScrollRef = useRef<HTMLDivElement | null>(null);
  const streamingBufferRef = useRef<StreamingBuffer | null>(null);
  
  // ============================================================================
  // NEW: State Update Helper
  // Crucial for immutable updates and completion detection.
  // ============================================================================
  const updateAiTurnById = useCallback((aiTurnId: string, updater: (aiTurn: AiTurn) => AiTurn) => {
    setMessages(prev => {
      const idx = prev.findIndex(t => t.id === aiTurnId);
      if (idx === -1) return prev;
      
      const updated = [...prev];
      const updatedAiTurn = updater(updated[idx] as AiTurn);
      updated[idx] = updatedAiTurn;

      // Completion check now looks at all possible response arrays
      const allBatch = Object.values(updatedAiTurn.batchResponses || {});
      const allSynth = Object.values(updatedAiTurn.synthesisResponses || {}).flat();
      const allEnsemble = Object.values(updatedAiTurn.ensembleResponses || {}).flat();
      const allResponses = [...allBatch, ...allSynth, ...allEnsemble];

      const allComplete = allResponses.length > 0 && allResponses.every(r => r.status === 'completed' || r.status === 'error');

      if (allComplete && activeAiTurnIdRef.current === aiTurnId) {
        setIsLoading(false);
        setUiPhase('awaiting_action');
        setIsContinuationMode(true);
        activeAiTurnIdRef.current = null;
      }
      return updated;
    });
  }, []);


  // ============================================================================
  // NEW: Unified Port Message Handler
  // This replaces the entire old `createPortMessageHandler`.
  // ============================================================================
  const createPortMessageHandler = useCallback(() => {
    if (!streamingBufferRef.current) {
      streamingBufferRef.current = new StreamingBuffer(
        (providerId, textUpdate, status, responseType: 'batch' | 'synthesis' | 'ensemble') => {
          const activeId = activeAiTurnIdRef.current;
          if (!providerId || !activeId) return;

          updateAiTurnById(activeId, aiTurn => {
            if (aiTurn.id !== activeId) return aiTurn;

            const isCompletion = status === 'completed' || status === 'error';
            
            const getUpdatedTake = (existingTake: ProviderResponse | undefined): ProviderResponse => {
                const base = (existingTake && existingTake.status !== 'completed' && existingTake.status !== 'error')
                    ? existingTake
                    : { providerId, text: '', status: 'pending', createdAt: Date.now() } as ProviderResponse;
                
                return {
                    ...base,
                    text: isCompletion ? textUpdate : (base.text + textUpdate),
                    status: status as ProviderResponseStatus,
                    updatedAt: Date.now()
                };
            };

            if (responseType === 'synthesis') {
                const map = { ...(aiTurn.synthesisResponses || {}) };
                const takes = map[providerId] || [];
                const updatedTake = getUpdatedTake(takes[takes.length - 1]);
                map[providerId] = [...takes.slice(0, -1), updatedTake];
                return { ...aiTurn, synthesisResponses: map };
            } else if (responseType === 'ensemble') {
                const map = { ...(aiTurn.ensembleResponses || {}) };
                const takes = map[providerId] || [];
                const updatedTake = getUpdatedTake(takes[takes.length - 1]);
                map[providerId] = [...takes.slice(0, -1), updatedTake];
                return { ...aiTurn, ensembleResponses: map };
            } else { // 'batch'
                const map = { ...(aiTurn.batchResponses || {}) };
                const existing = map[providerId] || { providerId, text: '', status: 'pending', createdAt: Date.now() } as ProviderResponse;
                map[providerId] = {
                    ...existing,
                    text: isCompletion ? textUpdate : (existing.text + textUpdate),
                    status: status as ProviderResponseStatus,
                    updatedAt: Date.now()
                };
                return { ...aiTurn, batchResponses: map };
            }
          });
        }
      );
    }

    return (message: any) => {
      if (!message || !message.type) return;

      switch (message.type) {
        case 'SESSION_STARTED': {
          setCurrentSessionId(message.sessionId);
          setMessages(prev => prev.map(m => ({ ...m, sessionId: message.sessionId })));
          setPendingUserTurns(prevMap => {
            const newMap = new Map(prevMap);
            newMap.forEach((userTurn, aiId) => {
              if (!userTurn.sessionId) newMap.set(aiId, { ...userTurn, sessionId: message.sessionId });
            });
            return newMap;
          });
          break;
        }

        case 'PARTIAL_RESULT': {
          const { stepId, providerId, chunk } = message;
          if (!providerId || !chunk?.text) return;

          let responseType: 'batch' | 'synthesis' | 'ensemble' = 'batch';
          if (stepId.startsWith('synthesis')) responseType = 'synthesis';
          else if (stepId.startsWith('ensemble')) responseType = 'ensemble';

          streamingBufferRef.current?.addDelta(providerId, chunk.text, 'streaming', responseType);
          
          if (chunk.meta) {
            setProviderContexts(prev => ({ ...prev, [providerId]: { ...(prev[providerId] || {}), ...chunk.meta } }));
          }
          break;
        }

        case 'WORKFLOW_STEP_UPDATE': {
          const { stepId, status, result, error } = message;
          if (status === 'completed' && result) {
            // A step can complete with a single result or a map of results for each provider
            const resultsMap = result.results || (result.providerId ? { [result.providerId]: result } : {});
            
            Object.entries(resultsMap).forEach(([providerId, data]: [string, any]) => {
                let responseType: 'batch' | 'synthesis' | 'ensemble' = 'batch';
                if (stepId.startsWith('synthesis')) responseType = 'synthesis';
                else if (stepId.startsWith('ensemble')) responseType = 'ensemble';

                streamingBufferRef.current?.setComplete(providerId, data.text || '', 'completed', responseType);
            });
          } else if (status === 'failed') {
            console.error(`[Port Handler] Step failed: ${stepId}`, error);
            // Future: Mark step as failed in UI
          }
          break;
        }

        case 'WORKFLOW_COMPLETE': {
          setIsLoading(false);
          setUiPhase('awaiting_action');
          setIsContinuationMode(true);
          activeAiTurnIdRef.current = null;
          streamingBufferRef.current?.flushImmediate(); // Ensure all buffered text is rendered
          
          if (activeAiTurnIdRef.current) {
            setPendingUserTurns(prevMap => {
              const newMap = new Map(prevMap);
              newMap.delete(activeAiTurnIdRef.current!);
              return newMap;
            });
          }
          break;
        }
      }
    };
  }, [updateAiTurnById]);
  
  // Effect to manage port connection
  useEffect(() => {
    const handler = createPortMessageHandler();
    api.setPortMessageHandler(handler);
    return () => api.setPortMessageHandler(null);
  }, [createPortMessageHandler]);


  // ============================================================================
  // REFACTORED ACTION HANDLERS
  // ============================================================================

  const handleSendPrompt = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;

    setIsLoading(true);
    setUiPhase('streaming');
    if (showWelcome) setShowWelcome(false);

    const activeProviders = LLM_PROVIDERS_CONFIG
      .filter(p => selectedModels[p.id])
      .map(p => p.id as ProviderKey);
    if (activeProviders.length === 0) {
      setIsLoading(false);
      return;
    }

    // 1. Create and persist UserTurn
    const userTurn: UserTurn = { type: 'user', id: `user-${Date.now()}`, text: prompt, createdAt: Date.now(), sessionId: currentSessionId };
    const aiTurnId = `ai-${Date.now()}`;
    setPendingUserTurns(prev => new Map(prev).set(aiTurnId, userTurn));
    setMessages(prev => [...prev, userTurn]);
    
    // 2. Build workflow
    try {
      const builder = new WorkflowBuilder({ sessionId: currentSessionId, targetUserTurnId: userTurn.id, uiTabId });
      const shouldUseSynthesis = synthesisProvider && activeProviders.length > 1;

      if (shouldUseSynthesis) {
        // Synthesis-first workflow: hidden batch + synthesis
        const batchStepId = builder.addBatchPrompt(prompt, activeProviders, {
            hidden: true,
            useThinking: computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: prompt })
        });
        builder.addSynthesis(synthesisProvider as ProviderKey, [batchStepId], prompt,
            { useThinking: thinkOnChatGPT && synthesisProvider === 'chatgpt' }
        );

        // Optimistically create unified AI turn
        const unifiedAiTurn: AiTurn = {
          type: 'ai', id: aiTurnId, createdAt: Date.now(), sessionId: currentSessionId,
          meta: { synthForUserTurnId: userTurn.id },
          batchResponses: {},
          synthesisResponses: { [synthesisProvider]: [{ providerId: synthesisProvider as ProviderKey, text: '', status: 'pending', createdAt: Date.now() }] }
        };
        setMessages(prev => [...prev, unifiedAiTurn]);

      } else {
        // Standard batch workflow
        builder.addBatchPrompt(prompt, activeProviders, {
            useThinking: computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: prompt })
        });

        // Optimistically create AI turn with pending batch responses
        const pendingBatch: Record<string, ProviderResponse> = {};
        activeProviders.forEach(pid => {
          pendingBatch[pid] = { providerId: pid, text: '', status: 'pending', createdAt: Date.now() };
        });
        const aiTurn: AiTurn = { type: 'ai', id: aiTurnId, createdAt: Date.now(), sessionId: currentSessionId, batchResponses: pendingBatch };
        setMessages(prev => [...prev, aiTurn]);
      }

      activeAiTurnIdRef.current = aiTurnId;
      await api.executeWorkflow(builder.build());

    } catch (error) {
        console.error('Failed to execute workflow:', error);
        // Error handling logic
    }
  }, [selectedModels, showWelcome, currentSessionId, uiTabId, thinkOnChatGPT, synthesisProvider]);

  const handleContinuation = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || !currentSessionId) return;
    
    setIsLoading(true);
    setUiPhase('streaming');

    const activeProviders = LLM_PROVIDERS_CONFIG.filter(p => selectedModels[p.id]).map(p => p.id as ProviderKey);
    if (activeProviders.length === 0) return;

    const userTurn: UserTurn = { type: 'user', id: `user-${Date.now()}`, text: trimmed, createdAt: Date.now(), sessionId: currentSessionId };
    const aiTurnId = `ai-${Date.now()}`;
    setPendingUserTurns(prev => new Map(prev).set(aiTurnId, userTurn));
    setMessages(prev => [...prev, userTurn]);
    
    try {
        const builder = new WorkflowBuilder({ sessionId: currentSessionId, targetUserTurnId: userTurn.id, uiTabId });
        builder.addBatchPrompt(trimmed, activeProviders, {
            providerContexts,
            useThinking: computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: trimmed })
        });

        const pendingBatch: Record<string, ProviderResponse> = {};
        activeProviders.forEach(pid => {
            pendingBatch[pid] = { providerId: pid, text: '', status: 'pending', createdAt: Date.now() };
        });
        const aiTurn: AiTurn = { type: 'ai', id: aiTurnId, createdAt: Date.now(), sessionId: currentSessionId, batchResponses: pendingBatch };
        setMessages(prev => [...prev, aiTurn]);
        
        activeAiTurnIdRef.current = aiTurnId;
        await api.executeWorkflow(builder.build());

    } catch (error) {
        console.error('Continuation workflow failed:', error);
        // Error handling
    }
  }, [currentSessionId, selectedModels, providerContexts, uiTabId, thinkOnChatGPT]);

  const findRoundForUserTurn = useCallback((userTurnId: string) => {
    const userIndex = messages.findIndex(m => m.id === userTurnId);
    if (userIndex === -1) return null;
    let aiIndex = -1;
    for (let i = userIndex + 1; i < messages.length; i++) {
        if (messages[i].type === 'ai') {
            aiIndex = i;
            break;
        }
    }
    const ai = aiIndex !== -1 ? (messages[aiIndex] as AiTurn) : undefined;
    return { user: messages[userIndex] as UserTurn, ai };
  }, [messages]);

  const handleRunSynthesisForRound = useCallback(async (userTurnId: string) => {
    if (!currentSessionId) return;

    const roundInfo = findRoundForUserTurn(userTurnId);
    if (!roundInfo?.user || !roundInfo?.ai) return;

    const selectedProviders = Object.entries(synthSelectionsByRound[userTurnId] || {})
        .filter(([, on]) => on)
        .map(([pid]) => pid as ProviderKey);
    if (selectedProviders.length === 0) return;
    
    setIsLoading(true);
    setUiPhase('streaming');

    try {
        const builder = new WorkflowBuilder({ sessionId: currentSessionId, targetUserTurnId: userTurnId, uiTabId });
        
        selectedProviders.forEach(providerId => {
            builder.addSynthesisRerun(
                providerId,
                roundInfo.ai!.id, // Historical turn ID
                roundInfo.user.text || '',
                { useThinking: thinkSynthByRound[userTurnId] && providerId === 'chatgpt' }
            );
        });

        // Optimistically add pending "takes" to the synthesisResponses array
        updateAiTurnById(roundInfo.ai.id, prevAiTurn => {
            const nextResponses = { ...(prevAiTurn.synthesisResponses || {}) };
            selectedProviders.forEach(pid => {
                const takes = nextResponses[pid] || [];
                takes.push({ providerId: pid, text: '', status: 'pending', createdAt: Date.now() });
                nextResponses[pid] = takes;
            });
            return { ...prevAiTurn, synthesisResponses: nextResponses };
        });

        activeAiTurnIdRef.current = roundInfo.ai.id;
        await api.executeWorkflow(builder.build());

    } catch (error) {
        console.error('Synthesis re-run workflow failed:', error);
        // Error handling
    }
  }, [currentSessionId, synthSelectionsByRound, uiTabId, findRoundForUserTurn, thinkSynthByRound, updateAiTurnById]);

  const handleRunEnsembleForRound = useCallback(async (userTurnId: string) => {
    if (!currentSessionId) return;

    const roundInfo = findRoundForUserTurn(userTurnId);
    if (!roundInfo?.user || !roundInfo?.ai) return;

    const ensemblerProvider = ensembleSelectionByRound[userTurnId] as ProviderKey | undefined;
    if (!ensemblerProvider) return;
    
    setIsLoading(true);
    setUiPhase('streaming');

    try {
        const builder = new WorkflowBuilder({ sessionId: currentSessionId, targetUserTurnId: userTurnId, uiTabId });
        builder.addEnsembleRerun(
            ensemblerProvider,
            roundInfo.ai.id, // Historical turn ID
            roundInfo.user.text || '',
            { useThinking: thinkEnsembleByRound[userTurnId] && ensemblerProvider === 'chatgpt' }
        );

        // Optimistically add a pending "take" to the ensembleResponses array
        updateAiTurnById(roundInfo.ai.id, prevAiTurn => {
            const nextResponses = { ...(prevAiTurn.ensembleResponses || {}) };
            const takes = nextResponses[ensemblerProvider] || [];
            takes.push({ providerId: ensemblerProvider, text: '', status: 'pending', createdAt: Date.now() });
            nextResponses[ensemblerProvider] = takes;
            return { ...prevAiTurn, ensembleResponses: nextResponses };
        });

        activeAiTurnIdRef.current = roundInfo.ai.id;
        await api.executeWorkflow(builder.build());
    } catch (error) {
        console.error('Ensemble re-run workflow failed:', error);
        // Error handling
    }
  }, [currentSessionId, ensembleSelectionByRound, uiTabId, findRoundForUserTurn, thinkEnsembleByRound, updateAiTurnById]);


  // ============================================================================
  // Most other functions (UI handlers, history, scrolling, etc.) remain the same.
  // The Row component, lifecycle effects, and JSX structure are largely unchanged.
  // ... (Keep the existing unchanged code from the original App.tsx here) ...
  // ============================================================================
  
  // NOTE: The remainder of the App.tsx component (history panel logic, new chat, select chat, Row component, JSX structure, etc.) can be copied from your original `App.tsx` file as its logic is not directly tied to the workflow execution refactor, other than what has been shown above. Ensure any references to old data structures (`providerResponses`) in the rendering logic are updated to prefer `batchResponses`, `synthesisResponses`, and `ensembleResponses`.
  
  // Placeholder for the rest of the component
  return <div>Component UI...</div>;
};

export default App;