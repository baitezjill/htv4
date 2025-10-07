import { useState, useEffect, useCallback, useRef } from 'react';
import { VariableSizeList as List, ListChildComponentProps } from 'react-window';
import React from 'react';
import { TurnMessage, UserTurn, AiTurn, ProviderResponse, AppStep, ChatSession, BackendMessage, LLMProvider, isUserTurn, isAiTurn, UiPhase, BackendFullSession, ViewMode } from './types';
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
import Banner from './components/Banner';
import { StreamingBuffer } from './utils/streamingBuffer';
import ComposerMode from './components/composer/ComposerMode';

// Hoisted helper: Build the Ensembler prompt using provided fixed template from spec
function buildEnsemblerPrompt(userPrompt: string, modelOutputs: Record<string, string>): string {
  const modelOutputsBlock = Object.entries(modelOutputs)
    .filter(([_, text]) => text && text.trim())
    .map(([providerId, text]) => `=== ${providerId.toUpperCase()} ===\n${text}`)
    .join('\n\n');

  const tpl = `You are not a synthesizer. You are a mirror that reveals what others cannot see.
Task: Present ALL insights from the models below in their most useful form for decision-making on "(user's Prompt)".
Critical instruction: Do NOT synthesize into a single answer. Instead, reason internally via this structure—then output ONLY as seamless, narrative prose that implicitly embeds it all:
Map the landscape — Group similar ideas, preserving tensions and contradictions.
Surface the invisible — Highlight consensus (2+ models), unique sightings (one model) as natural flow.
Frame the choices — present alternatives as "If you prioritize X, this path fits because Y."
Flag the unknowns — Note disagreements/uncertainties as subtle cautions.
Internal format for reasoning (NEVER output directly):
What Everyone Sees (consensus)
Point 1
Point 2
The Tensions (disagreements)
Option A: [suggestion X] implies...
Option B: [suggestion Y] posits...
The Unique Insights
[suggestion]: Overlooked angle...
The Choice Framework
If priority [goal 1]: lean toward [option]
If priority [goal 2]: lean toward [option]
Confidence Check
- High confidence: [what's solid]
- Check this: [what needs verification]
- Unknown: [what's missing]


finally output your response as a narrative explaining everything implicitly to the user, like a natural response to the users prompt fluid, insightful, redacting model names/extraneous details. Build feedback as emergent wisdom—evoke clarity, agency, and subtle awe. Weave your final narrative as representation of a cohesive response of the collective thought  to the users prompt:

User Prompt: ${userPrompt}

Model outputs to analyze:
${modelOutputsBlock}`;
  return tpl;
}

const App = () => {
  // Single source of truth: all messages in one array
  const [messages, setMessages] = useState<TurnMessage[]>([]);
  
  // Round-based saving state
  const [pendingUserTurns, setPendingUserTurns] = useState<Map<string, UserTurn>>(new Map());
  
  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<ChatSession[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [currentAppStep, setCurrentAppStep] = useState<AppStep>('initial');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [uiTabId, setUiTabId] = useState<number | undefined>();
  const [uiPhase, setUiPhase] = useState<UiPhase>('idle');
  const [isContinuationMode, setIsContinuationMode] = useState(false);
  const [modelsTouched, setModelsTouched] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Record<string, boolean>>(
    LLM_PROVIDERS_CONFIG.reduce<Record<string, boolean>>((acc, provider) => {
      acc[provider.id] = ['claude', 'gemini', 'chatgpt'].includes(provider.id);
      return acc;
    }, {} as Record<string, boolean>)
  );
  const [isVisibleMode, setIsVisibleMode] = useState(true);
  const [lastSynthesisModel, setLastSynthesisModel] = useState<string>('gemini');
  const [synthesisProvider, setSynthesisProvider] = useState<string | null>('gemini');
  // Controls visibility of hidden source outputs for synthesis-first prompts
  const [showSourceOutputs, setShowSourceOutputs] = useState<boolean>(false);
  const [providerContexts, setProviderContexts] = useState<Record<string, any>>({});
  const [isInitializing, setIsInitializing] = useState(true);
  const [expandedUserTurns, setExpandedUserTurns] = useState<Record<string, boolean>>({});
  const [isReducedMotion, setIsReducedMotion] = useState(false);
  // Round-level action bar selections
  const [synthSelectionsByRound, setSynthSelectionsByRound] = useState<Record<string, Record<string, boolean>>>({});
  const [ensembleSelectionByRound, setEnsembleSelectionByRound] = useState<Record<string, string | null>>({});
  // Think toggles
  const [thinkOnChatGPT, setThinkOnChatGPT] = useState<boolean>(false);
  const [thinkSynthByRound, setThinkSynthByRound] = useState<Record<string, boolean>>({});
  const [thinkEnsembleByRound, setThinkEnsembleByRound] = useState<Record<string, boolean>>({});
  
  // Composer Mode state
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.CHAT);
  const [activeComposerTurn, setActiveComposerTurn] = useState<AiTurn | null>(null);

  // Refs
  const activeAiTurnIdRef = useRef<string | null>(null);
  const lastAttachedPortRef = useRef<chrome.runtime.Port | null>(null);
  const handlePortMessageRef = useRef<((message: any) => void) | null>(null);
  const scrollSaveTimeoutRef = useRef<number | undefined>(undefined);
  const didLoadTurnsRef = useRef(false);
  const appStartTimeRef = useRef<number>(Date.now());
  const listRef = useRef<List | null>(null);
  const outerScrollRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const scrollBottomRef = useRef(true);
  const sessionIdRef = useRef<string | null>(null);
  const isSynthRunningRef = useRef(false);
  const sizeMapRef = useRef<Record<string, number>>({});
  const historyOverlayRef = useRef<HTMLDivElement | null>(null);
  const streamingBufferRef = useRef<StreamingBuffer | null>(null);
  // Valid provider ids for synthesis
  type ValidProvider = 'claude' | 'gemini' | 'chatgpt';
  
  // Update refs when state changes
  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // Removed ambiguous helper getAllProviderResponses to prevent synthesis/ensemble from shadowing batch.

  // Helper: get pristine batch provider responses only (for re-runs)
  const getBatchProviderResponses = (aiTurn: AiTurn): Record<string, ProviderResponse> => {
    return { ...(aiTurn.batchResponses || {}) };
  };

  // ============================================================================
  // Graceful shutdown handler
  // ============================================================================
  
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Force flush any pending saves
      try {
        persistenceService.flush?.();
        streamingBufferRef.current?.flushImmediate();
      } catch (e) {
        console.error('Shutdown save failed:', e);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handleBeforeUnload();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      streamingBufferRef.current?.destroy();
    };
  }, []);

  // First turn handling
  const isFirstTurn = !messages.some(m => m.type === 'user');

  const handleToggleUserTurn = useCallback((turnId: string) => {
    setExpandedUserTurns(prev => ({
      ...prev,
      [turnId]: !(prev[turnId] ?? true)
    }));
    // Use a timeout to allow state to update before re-measuring
    setTimeout(() => listRef.current?.resetAfterIndex(0), 0);
  }, []);

  // Remove frequent full re-measures; per-row ResizeObserver handles dynamic size
  // A full remeasure still occurs when messages length changes (see below)

  // Utility: Update last AI turn in messages array atomically
  const updateLastAiTurn = useCallback((updater: (aiTurn: AiTurn) => AiTurn) => {
    setMessages(prev => {
      const lastAiIndex = [...prev].reverse().findIndex(t => t.type === 'ai');
      if (lastAiIndex === -1) return prev;
      
      const actualIndex = prev.length - 1 - lastAiIndex;
      const updated = [...prev];
      const updatedAiTurn = updater(updated[actualIndex] as AiTurn);
      updated[actualIndex] = updatedAiTurn;

      // Explicitly check completion across known containers without merging helpers
      const latestFromArrayMap = (container?: Record<string, ProviderResponse[] | ProviderResponse>): Record<string, ProviderResponse> => {
        const out: Record<string, ProviderResponse> = {};
        if (!container) return out;
        Object.entries(container as Record<string, any>).forEach(([pid, resp]) => {
          if (Array.isArray(resp)) {
            const last = resp[resp.length - 1];
            if (last) out[pid] = last;
          } else if (resp && typeof resp === 'object') {
            out[pid] = resp as ProviderResponse;
          }
        });
        return out;
      };

      const allResponses: Record<string, ProviderResponse> = {
        ...(updatedAiTurn.batchResponses || {}),
        ...latestFromArrayMap(updatedAiTurn.synthesisResponses),
        ...latestFromArrayMap(updatedAiTurn.ensembleResponses),
        ...(updatedAiTurn.providerResponses || {}) // legacy
      };
      const allComplete = Object.values(allResponses).every(r => r.status === 'completed' || r.status === 'error');
      
      if (allComplete) {
        setIsLoading(false);
        setUiPhase('awaiting_action');
        const isEnsemble = updatedAiTurn.isEnsembleAnswer;
        const isSynthesis = updatedAiTurn.isSynthesisAnswer;
        setCurrentAppStep(isEnsemble || isSynthesis ? 'synthesisDone' : 'awaitingSynthesis');
        setIsContinuationMode(true);
        activeAiTurnIdRef.current = null;
        
        // Clean up pending user turn if it exists
        if (pendingUserTurns.has(updatedAiTurn.id)) {
          setPendingUserTurns(prevMap => {
            const newMap = new Map(prevMap);
            newMap.delete(updatedAiTurn.id);
            return newMap;
          });
        }
        
        // Proactively refresh history if the panel is open
        if (isHistoryPanelOpen) {
          // History is now managed by backend API
          api.getHistoryList()
            .then((response) => {
              const formattedSessions: ChatSession[] = response.sessions.map((session: ChatSession) => ({
                id: session.sessionId,
                sessionId: session.sessionId,
                title: session.title || 'Untitled',
                startTime: session.startTime || Date.now(),
                lastActivity: session.lastActivity || Date.now(),
                messageCount: session.messageCount || 0,
                firstMessage: session.firstMessage || '',
                messages: [],
              }));
              setHistorySessions(formattedSessions);
            })
            .catch(console.error);
        }
      }
      
      return updated;
    });
  }, [pendingUserTurns, isHistoryPanelOpen]);

  // Targeted update by AI turn id (supports mid-list synthesis streaming)
  const updateAiTurnById = useCallback((aiTurnId: string, updater: (aiTurn: AiTurn) => AiTurn) => {
    setMessages(prev => {
      const idx = prev.findIndex(t => t.type === 'ai' && (t as AiTurn).id === aiTurnId);
      if (idx === -1) return prev;

      const updated = [...prev];
      const updatedAiTurn = updater(updated[idx] as AiTurn);
      updated[idx] = updatedAiTurn;

      // Explicitly check completion across known containers without merging helpers
      const latestFromArrayMap = (container?: Record<string, ProviderResponse[] | ProviderResponse>): Record<string, ProviderResponse> => {
        const out: Record<string, ProviderResponse> = {};
        if (!container) return out;
        Object.entries(container as Record<string, any>).forEach(([pid, resp]) => {
          if (Array.isArray(resp)) {
            const last = resp[resp.length - 1];
            if (last) out[pid] = last;
          } else if (resp && typeof resp === 'object') {
            out[pid] = resp as ProviderResponse;
          }
        });
        return out;
      };

      const allResponses: Record<string, ProviderResponse> = {
        ...(updatedAiTurn.batchResponses || {}),
        ...latestFromArrayMap(updatedAiTurn.synthesisResponses),
        ...latestFromArrayMap(updatedAiTurn.ensembleResponses),
        ...(updatedAiTurn.providerResponses || {}) // legacy
      };
      const allComplete = Object.values(allResponses).every(r => r.status === 'completed' || r.status === 'error');

      if (allComplete) {
        setIsLoading(false);
        setUiPhase('awaiting_action');
        const isEnsemble = updatedAiTurn.isEnsembleAnswer;
        const isSynthesis = updatedAiTurn.isSynthesisAnswer;
        setCurrentAppStep(isEnsemble || isSynthesis ? 'synthesisDone' : 'awaitingSynthesis');
        setIsContinuationMode(true);
        activeAiTurnIdRef.current = null;
      }

      return updated;
    });
  }, []);

  // Handler for Composer Mode to update AiTurn
  const handleUpdateAiTurnForComposer = useCallback((aiTurnId: string, updates: Partial<AiTurn>) => {
    setMessages(prev => {
      const idx = prev.findIndex(t => t.type === 'ai' && (t as AiTurn).id === aiTurnId);
      if (idx === -1) return prev;
      
      const updated = [...prev];
      updated[idx] = { ...(updated[idx] as AiTurn), ...updates };
      return updated;
    });
  }, []);

  // Handler to enter Composer Mode with an AiTurn
  const handleEnterComposerMode = useCallback((aiTurn: AiTurn) => {
    setActiveComposerTurn(aiTurn);
    setViewMode(ViewMode.COMPOSER);
  }, []);

  // Handler to exit Composer Mode
  const handleExitComposerMode = useCallback(() => {
    setViewMode(ViewMode.CHAT);
    setActiveComposerTurn(null);
  }, []);

  // ===== Round helpers: locate round, existing synth/ensemble blocks, and insertion point =====
  const findRoundForUserTurn = useCallback((userTurnId: string) => {
    const userIndex = messages.findIndex(m => m.id === userTurnId);
    if (userIndex === -1) return null;
    // Find first non-synthesis/non-ensemble AI turn after this user (provider outputs of this round)
    let aiIndex = -1;
    for (let i = userIndex + 1; i < messages.length; i++) {
      const t = messages[i];
      if (t.type === 'user') break; // next round begins
      if (t.type === 'ai') {
        const ai = t as AiTurn;
        if (!ai.isSynthesisAnswer && !ai.isEnsembleAnswer) {
          aiIndex = i;
          break;
        }
      }
    }
    const ai = aiIndex !== -1 ? (messages[aiIndex] as AiTurn) : undefined;
    return { userIndex, user: messages[userIndex] as UserTurn, aiIndex, ai };
  }, [messages]);

  // Helper to find the first insertion index before an AI turn
  const findFirstInsertIndexBeforeAi = useCallback((userTurnId: string) => {
    const round = findRoundForUserTurn(userTurnId);
    if (!round) return -1;
    const { userIndex, aiIndex } = round;
    // We want to insert after any existing synthesis/ensemble blocks for this round, but before main AI outputs
    let insertAt = userIndex + 1;
    for (let i = userIndex + 1; i < messages.length; i++) {
      const t = messages[i];
      if (t.type === 'user') break;
      if (t.type === 'ai') {
        const ai = t as AiTurn;
        if ((ai.isSynthesisAnswer || ai.isEnsembleAnswer) && (ai.meta as any)?.synthForUserTurnId === userTurnId) {
          insertAt = i + 1; // insert after the last synthesis/ensemble block of this round
          continue;
        }
        // First non-synth/ensemble AI encountered: we must insert before it
        break;
      }
    }
    // If there is a provider AI index and our insertAt is after it (edge), clamp to aiIndex
    if (aiIndex !== -1 && insertAt > aiIndex) return aiIndex;
    return insertAt;
  }, [messages, findRoundForUserTurn]);

  const providerHasActivityAfter = useCallback((providerId: string, roundAiIndex: number): boolean => {
    if (roundAiIndex === -1) return false;
    for (let i = roundAiIndex + 1; i < messages.length; i++) {
      const t = messages[i];
      if (t.type !== 'ai') continue;
      const ai = t as AiTurn;
      if (ai.providerResponses && ai.providerResponses[providerId]) return true;
    }
    return false;
  }, [messages]);

  const buildEligibleMapForRound = useCallback((userTurnId: string): {
    synthMap: Record<string, { disabled: boolean; reason?: string }>;
    ensembleMap: Record<string, { disabled: boolean; reason?: string }>;
    disableSynthesisRun: boolean;
    disableEnsembleRun: boolean;
  } => {
    const round = findRoundForUserTurn(userTurnId);
    if (!round) return { synthMap: {}, ensembleMap: {}, disableSynthesisRun: true, disableEnsembleRun: true };

    const { aiIndex, ai } = round;
    const outputs = Object.values(ai?.providerResponses || {}).filter(r => r.status === 'completed' && r.text?.trim());
    const enoughOutputs = outputs.length >= 2;

    // Check existing synthesis and ensemble responses in the unified AiTurn
    const alreadySynthPids = ai?.synthesisResponses ? Object.keys(ai.synthesisResponses) : [];
    const alreadyEnsemblePids = ai?.ensembleResponses ? Object.keys(ai.ensembleResponses) : [];

    // Build eligibility map for Synthesis (multi-select)
    const synthMap: Record<string, { disabled: boolean; reason?: string }> = {};
    LLM_PROVIDERS_CONFIG.forEach(p => {
      const contAfter = providerHasActivityAfter(p.id, aiIndex);
      const alreadySynth = alreadySynthPids.includes(p.id);
      if (!enoughOutputs) {
        synthMap[p.id] = { disabled: true, reason: 'Need ≥ 2 model outputs in this round' };
      } else if (contAfter) {
        synthMap[p.id] = { disabled: true, reason: 'Provider continued after this round' };
      } else if (alreadySynth) {
        synthMap[p.id] = { disabled: true, reason: 'Already synthesized for this round' };
      } else {
        synthMap[p.id] = { disabled: false };
      }
    });

    // Build eligibility map for Ensemble (single-select)
    const ensembleMap: Record<string, { disabled: boolean; reason?: string }> = {};
    LLM_PROVIDERS_CONFIG.forEach(p => {
      const contAfter = providerHasActivityAfter(p.id, aiIndex);
      const alreadyEnsembled = alreadyEnsemblePids.includes(p.id);
      if (!enoughOutputs) {
        ensembleMap[p.id] = { disabled: true, reason: 'Need ≥ 2 model outputs in this round' };
      } else if (contAfter) {
        ensembleMap[p.id] = { disabled: true, reason: 'Provider continued after this round' };
      } else if (alreadyEnsembled) {
        ensembleMap[p.id] = { disabled: true, reason: 'Already ensembled for this round' };
      } else {
        ensembleMap[p.id] = { disabled: false };
      }
    });

    return {
      synthMap,
      ensembleMap,
      disableSynthesisRun: !enoughOutputs,
      disableEnsembleRun: !enoughOutputs,
    };
  }, [findRoundForUserTurn, providerHasActivityAfter]);

  // ===== Round bar handlers =====
  const handleToggleSynthForRound = useCallback((userTurnId: string, providerId: string) => {
    setSynthSelectionsByRound(prev => {
      const current = prev[userTurnId] || {};
      return { ...prev, [userTurnId]: { ...current, [providerId]: !current[providerId] } };
    });
  }, []);

  const handleSelectEnsembleForRound = useCallback((userTurnId: string, providerId: string) => {
    setEnsembleSelectionByRound(prev => {
      const current = prev[userTurnId] || null;
      return { ...prev, [userTurnId]: current === providerId ? null : providerId };
    });
  }, []);

  const handleRunSynthesisForRound = useCallback(async (userTurnId: string) => {
    if (!currentSessionId || isSynthRunningRef.current) return;

    const roundInfo = findRoundForUserTurn(userTurnId);
    if (!roundInfo || !roundInfo.user || !roundInfo.ai) return;
    
    const { ai } = roundInfo; // The AiTurn to update

    const results: Record<string, string> = {};
    // Use only pristine batch outputs for synthesis inputs
    Object.entries(getBatchProviderResponses(ai)).forEach(([pid, resp]) => {
      if (resp.status === 'completed' && resp.text?.trim()) results[pid] = resp.text!;
    });
    if (Object.keys(results).length < 2) return;

    const selected = Object.entries(synthSelectionsByRound[userTurnId] || {})
      .filter(([_, on]) => on)
      .map(([pid]) => pid);
    if (selected.length === 0) return;

    // Initialize a new take per selected provider (append to arrays)
    updateAiTurnById(ai.id, (prevAiTurn) => {
      const prev = prevAiTurn.synthesisResponses || {};
      const next: Record<string, ProviderResponse[]> = { ...prev } as Record<string, ProviderResponse[]>;
      selected.forEach((pid) => {
        const arr = Array.isArray(next[pid]) ? next[pid]! : (next[pid] ? [next[pid] as unknown as ProviderResponse] : []);
        arr.push({ providerId: pid, text: '', status: 'pending', createdAt: Date.now() });
        next[pid] = arr;
      });
      return { ...prevAiTurn, synthesisResponses: next };
    });

    activeAiTurnIdRef.current = ai.id; // Stream into the correct, existing turn
    setIsLoading(true);
    setUiPhase('streaming');
    setCurrentAppStep('synthesis');
    isSynthRunningRef.current = true;

    const originalPrompt = roundInfo.user.text || '';
    const idempotencyToken = `${currentSessionId}:${userTurnId}:synth:${selected.sort().join('+')}`;

    try {
      if (typeof api.ensurePort === 'function') {
        const port = await api.ensurePort({ sessionId: currentSessionId });
        if (port && handlePortMessageRef.current && lastAttachedPortRef.current !== port) {
          port.onMessage.addListener(handlePortMessageRef.current);
          lastAttachedPortRef.current = port;
        }
      }
      if (selected.length === 1) {
        setLastSynthesisModel(selected[0]);
      }
      await api.executeSynthesis(
        currentSessionId,
        originalPrompt,
        results,
        (selected.length === 1 ? (selected[0] as ValidProvider) : (selected as ValidProvider[])),
        uiTabId,
        { idempotencyToken, useThinking: !!thinkSynthByRound[userTurnId] && selected.includes('chatgpt') }
      );
    } catch (err) {
      console.error('Synthesis run failed:', err);
      setIsLoading(false);
      setUiPhase('awaiting_action');
      activeAiTurnIdRef.current = null;
    } finally {
      isSynthRunningRef.current = false;
    }
  }, [currentSessionId, synthSelectionsByRound, uiTabId, findRoundForUserTurn, thinkSynthByRound, updateAiTurnById]);

  // Build the Ensembler prompt using provided fixed template from spec
  

  const handleRunEnsembleForRound = useCallback(async (userTurnId: string) => {
    if (!currentSessionId) return;

    const roundInfo = findRoundForUserTurn(userTurnId);
    if (!roundInfo || !roundInfo.user || !roundInfo.ai) return;

    const { user: roundUser, ai: roundAi } = roundInfo;

    const modelOutputs: Record<string, string> = {};
    // Use only pristine batch outputs for ensemble inputs
    Object.entries(getBatchProviderResponses(roundAi)).forEach(([pid, resp]) => {
      if (resp.status === 'completed' && resp.text?.trim()) modelOutputs[pid] = resp.text!;
    });
    if (Object.keys(modelOutputs).length < 2) return;

    const ensemblerProvider = ensembleSelectionByRound[userTurnId];
    if (!ensemblerProvider) return;

    const ensemblerPrompt = buildEnsemblerPrompt(roundUser.text || '', modelOutputs);

    setIsLoading(true);
    setUiPhase('streaming');
    setCurrentAppStep('synthesis');

    // Initialize a new ensemble take (append to array for the selected provider)
    updateAiTurnById(roundAi.id, (prevAiTurn) => {
      const prev = prevAiTurn.ensembleResponses || {};
      const next: Record<string, ProviderResponse[]> = { ...prev } as Record<string, ProviderResponse[]>;
      const pid = ensemblerProvider;
      const arr = Array.isArray(next[pid]) ? next[pid]! : (next[pid] ? [next[pid] as unknown as ProviderResponse] : []);
      arr.push({ providerId: pid, text: '', status: 'pending', createdAt: Date.now() });
      next[pid] = arr;
      return { ...prevAiTurn, ensembleResponses: next };
    });
    
    activeAiTurnIdRef.current = roundAi.id; // Stream into the correct, existing turn

    try {
      const handlePortMessage = createPortMessageHandler();
      handlePortMessageRef.current = handlePortMessage;

      const providerConfig = LLM_PROVIDERS_CONFIG.find(p => p.id === ensemblerProvider);
      if (!providerConfig) throw new Error("Ensembler provider not found");

      const { port } = api.executeBatchPrompt(
        ensemblerPrompt,
        [providerConfig],
        isVisibleMode,
        uiTabId,
        handlePortMessage,
        currentSessionId,
        (ensemblerProvider === 'chatgpt') ? !!thinkEnsembleByRound[userTurnId] : undefined
      );
      lastAttachedPortRef.current = port;
    } catch (err) {
      console.error('Ensemble run failed:', err);
      setIsLoading(false);
      setUiPhase('awaiting_action');
      activeAiTurnIdRef.current = null;
    }
  }, [currentSessionId, ensembleSelectionByRound, uiTabId, isVisibleMode, findRoundForUserTurn, thinkEnsembleByRound, updateAiTurnById]);

  // Utility: Estimate item size for virtual list (fallback before actual measure)
  const itemSizeEstimator = useCallback((index: number): number => {
    const turn = messages[index];
    if (!turn) return 100;
    
    if (isUserTurn(turn)) {
      const isExpanded = expandedUserTurns[turn.id] ?? true;
      const baseHeight = isExpanded ? 80 : 60; // Reduced base height
      const lineHeight = 21; // 14px font-size * 1.5 line-height
      const charsPerLine = 100; // Adjusted heuristic
      
      if (!isExpanded) {
        return baseHeight; // Return minimal height for collapsed state
      }
      
      const lines = (turn.text || '').split('\n').reduce((acc, line) => {
        return acc + Math.max(1, Math.ceil(line.length / charsPerLine));
      }, 0);
      
      const textHeight = lines * lineHeight;
      return Math.max(80, baseHeight + textHeight); // Ensure minimum height
    }

    const aiTurn = turn as AiTurn;

    // Hide standalone ensemble rows when grouped under synthesis for the same round
    if (aiTurn.isEnsembleAnswer) {
      const roundUserId = (aiTurn.meta as any)?.synthForUserTurnId;
      if (roundUserId) {
        // Check if there's a synthesis turn for this round that contains ensemble responses
        const round = findRoundForUserTurn(roundUserId);
        const synthTurn = round?.ai;
        if (synthTurn?.isSynthesisAnswer && synthTurn.ensembleResponses && Object.keys(synthTurn.ensembleResponses).length > 0) {
          return 1; // effectively hide the ensemble row; content is rendered under synthesis
        }
      }
    }

    // Special handling for synthesis answers (larger height)
    if (aiTurn.isSynthesisAnswer) {
      const baseHeight = 150; // Increased base height for special answers
      const content = aiTurn.synthesisResponse?.text || Object.values(aiTurn.providerResponses || {})[0]?.text || '';
      const lineHeight = 21;
      const charsPerLine = 100;

      const lines = content.split('\n').reduce((acc, line) => {
        return acc + Math.max(1, Math.ceil(line.length / charsPerLine));
      }, 0);

      const textHeight = lines * lineHeight;
      // Add extra height for the action bar and padding
      return Math.max(240, baseHeight + textHeight + 120);
    }
    
    // Regular AI turn
    const providerCount = Object.keys(aiTurn.providerResponses || {}).length;
    const baseHeight = 100;
    const perProviderHeight = 180;

    // heuristic cap to avoid extremely tall rows
    return Math.min(1000, baseHeight + providerCount * perProviderHeight);
  }, [messages, expandedUserTurns]);

  // Item size getter backed by measurement map with estimator as fallback
  const getItemSize = useCallback((index: number): number => {
    const turn = messages[index];
    if (!turn) return 100;
    const measured = sizeMapRef.current[turn.id];
    return typeof measured === 'number' && measured > 0
      ? measured
      : itemSizeEstimator(index);
  }, [messages, itemSizeEstimator]);

  // Keep size map in sync with messages (remove stale ids)
  useEffect(() => {
    const validIds = new Set(messages.map(m => m.id));
    Object.keys(sizeMapRef.current).forEach(id => {
      if (!validIds.has(id)) {
        delete sizeMapRef.current[id];
      }
    });
    // After significant list changes, recompute sizes
    try { listRef.current?.resetAfterIndex(0, true); } catch {}
  }, [messages]);

  // Helper: determine if user is near the bottom of the outer scroller
  const isNearBottom = useCallback(() => {
    const el = outerScrollRef.current;
    if (!el) return true;
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    return distance <= 80; // px threshold
  }, []);

  // Handle scroll on the outer scroller: track last scrollTop, update stickiness, and debounce-save position
  const handleOuterScroll = useCallback(() => {
    const el = outerScrollRef.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;
    scrollBottomRef.current = isNearBottom();

    // Debounce persist
    if (scrollSaveTimeoutRef.current) window.clearTimeout(scrollSaveTimeoutRef.current);
    scrollSaveTimeoutRef.current = window.setTimeout(() => {
      persistenceService.saveScrollPosition(el.scrollTop, currentSessionId).catch(console.error);
    }, 500) as unknown as number;
  }, [currentSessionId, isNearBottom]);

  useDelegatedScroll(outerScrollRef);

  // Utility: Auto-scroll to bottom while streaming
  const useScrollStick = useCallback(() => {
    if (scrollBottomRef.current && listRef.current) {
      listRef.current.scrollToItem(messages.length - 1);
    }
  }, [messages.length]);

  // Auto-scroll effect
  useEffect(() => {
    useScrollStick();
  }, [messages.length, useScrollStick]);

  // When messages change, notify react-window to recompute sizes.
  // Using resetAfterIndex(0, true) to force a full re-measure (safe, occasional).
  useEffect(() => {
    // Minor debounce/guard: only call if listRef exists
    if (listRef.current) {
      try {
        // true -> also recompute the item sizes immediately
        listRef.current.resetAfterIndex(0, true);
      } catch (e) {
        // guard for unexpected internals
        // don't throw in production UI render
        console.warn('[UI] listRef.resetAfterIndex failed', e);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Bootstrap from persistence on startup
  useEffect(() => {
    if (didLoadTurnsRef.current) return;
    didLoadTurnsRef.current = true;

    const bootstrapFromPersistence = async () => {
      setIsInitializing(true);
      try {
        // One-time legacy cleanup: remove old UI chat/turns
        try { await persistenceService.clearLegacyHistory?.(); } catch {}
        const defaultModels: Record<string, boolean> = LLM_PROVIDERS_CONFIG.reduce<Record<string, boolean>>((acc, provider) => {
          acc[provider.id] = ['claude', 'gemini', 'chatgpt'].includes(provider.id);
          return acc;
        }, {} as Record<string, boolean>);
        
        setShowWelcome(true);
        setCurrentAppStep('initial');
        setCurrentSessionId(null);
        setMessages([]);
        setIsHistoryPanelOpen(false);
        setSelectedModels(defaultModels);
      } catch (error) {
        console.error('Failed to bootstrap from persistence:', error);
      } finally {
        setIsInitializing(false);
      }
    };

    bootstrapFromPersistence();
  }, []);

  // Extension API initialization
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      api.setExtensionId(chrome.runtime.id);
      chrome.tabs.getCurrent((tab) => {
        if (tab?.id) {
          setUiTabId(tab.id);
        }
      });
    }
  }, []);

  // Runtime message listener for workflow completion
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      const runtimeListener = (message: any) => {
        if (!message) return;
        console.log('[HTOS] Received message:', message); // Debug log
        const messageType = (message.type || '').toString().toLowerCase();
        
        if (messageType === 'workflow_complete' || 
            (messageType.includes('complete') && messageType.includes('workflow'))) {
          console.log('[HTOS] Handling workflow complete:', message);
          setIsLoading(false);
          setUiPhase('awaiting_action');
          setIsContinuationMode(true);
          setCurrentAppStep('awaitingSynthesis');
        }
      };
      
      chrome.runtime.onMessage.addListener(runtimeListener);
      return () => chrome.runtime.onMessage.removeListener(runtimeListener);
    }
  }, []);

  // History panel loading from backend
  useEffect(() => {
    if (!isHistoryPanelOpen) return;
    setIsHistoryLoading(true);

    const load = async () => {
      try {
        const response = await api.getHistoryList();
        // Ensure we have a valid response with sessions array
        const sessions = response?.sessions || [];
        
        const formattedSessions: ChatSession[] = sessions.map(session => ({
          id: session.sessionId,
          sessionId: session.sessionId,
          title: session.title || 'Untitled',
          startTime: session.startTime || Date.now(),
          lastActivity: session.lastActivity || Date.now(),
          messageCount: session.messageCount || 0,
          firstMessage: session.firstMessage || '',
          messages: [],
        }));
        
        setHistorySessions(formattedSessions);
      } catch (error) {
        console.error('Failed to load history:', error);
      } finally {
        setIsHistoryLoading(false);
      }
    };
    load();
    return () => {};
  }, [isHistoryPanelOpen]);

  // Scroll position persistence (before unload only; routine saves handled in handleOuterScroll)
  useEffect(() => {
    const saveScrollPosition = () => {
      const el = outerScrollRef.current;
      const position = el ? el.scrollTop : 0;
      persistenceService.saveScrollPosition(position, currentSessionId).catch(console.error);
    };

    window.addEventListener('beforeunload', saveScrollPosition);
    return () => {
      window.removeEventListener('beforeunload', saveScrollPosition);
      if (scrollSaveTimeoutRef.current) clearTimeout(scrollSaveTimeoutRef.current);
    };
  }, [currentSessionId]);

  // Attach scroll listener to the actual react-window outer scroller and
  // update the outerScrollRef to point at it for consistent behavior
  useEffect(() => {
    const list = listRef.current as any;
    const el: HTMLDivElement | null = list && (list._outerRef as HTMLDivElement | null);
    if (!el) return;
    outerScrollRef.current = el as HTMLDivElement;
    // Initialize stickiness based on current position
    scrollBottomRef.current = isNearBottom();
    el.addEventListener('scroll', handleOuterScroll, { passive: true });
    return () => {
      try { el.removeEventListener('scroll', handleOuterScroll as any); } catch {}
    };
  }, [handleOuterScroll, isNearBottom, listRef]);

  // Accessible focus trap for History overlay (Esc to close; tab loop contained)
  useEffect(() => {
    if (!isHistoryPanelOpen) return;
    const root = historyOverlayRef.current;
    if (!root) return;

    const selectors = 'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const getFocusables = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(selectors)).filter(el => !el.hasAttribute('disabled'));
    let focusables = getFocusables();
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    const prevFocused = (document.activeElement as HTMLElement) || null;
    // Focus the first focusable element (e.g., New Chat button)
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsHistoryPanelOpen(false);
        return;
      }
      if (e.key === 'Tab') {
        focusables = getFocusables();
        const currentFirst = focusables[0];
        const currentLast = focusables[focusables.length - 1];
        if (focusables.length === 0) return;
        if (e.shiftKey) {
          if (document.activeElement === currentFirst) {
            e.preventDefault();
            currentLast?.focus();
          }
        } else {
          if (document.activeElement === currentLast) {
            e.preventDefault();
            currentFirst?.focus();
          }
        }
      }
    };

    root.addEventListener('keydown', onKeyDown);
    return () => {
      root.removeEventListener('keydown', onKeyDown);
      prevFocused?.focus?.();
    };
  }, [isHistoryPanelOpen]);

  // Port message handler with requestAnimationFrame batching for smooth streaming
  function createPortMessageHandler() {
    // Initialize streaming buffer on first call
    if (!streamingBufferRef.current) {
      streamingBufferRef.current = new StreamingBuffer((providerId, delta, status, responseType: 'batch' | 'synthesis' | 'ensemble') => {
        const activeId = activeAiTurnIdRef.current;
        if (!providerId || !activeId) return;
        if (!responseType) {
          console.warn('StreamingBuffer update missing responseType; ignoring update for provider:', providerId);
          return;
        }
        
        updateAiTurnById(activeId, aiTurn => {
          if (aiTurn.id !== activeId) return aiTurn;

          let updatedAiTurn = { ...aiTurn };
          
          // Route to the correct container based on explicit responseType
          if (responseType === 'synthesis') {
            // Store in synthesisResponses (multi-take arrays per provider)
            const existingMap = aiTurn.synthesisResponses || {};
            const arr = Array.isArray(existingMap[providerId])
              ? (existingMap[providerId] as ProviderResponse[])
              : (existingMap[providerId]
                  ? [existingMap[providerId] as unknown as ProviderResponse]
                  : []);
            const last = arr[arr.length - 1];
            const base = (last && last.status !== 'completed' && last.status !== 'error')
              ? last
              : { providerId, text: '', status: 'pending', createdAt: Date.now() } as ProviderResponse;
            const newText = status === 'completed' ? delta : (base.text + delta);
            const updatedItem: ProviderResponse = {
              ...base,
              text: newText,
              status: status as ProviderResponse['status'],
              updatedAt: Date.now()
            };
            const nextArr = (last && base === last)
              ? [...arr.slice(0, -1), updatedItem]
              : [...arr, updatedItem];
            updatedAiTurn.synthesisResponses = {
              ...existingMap,
              [providerId]: nextArr
            };
            // Legacy field for backward compatibility points to latest item
            updatedAiTurn.synthesisResponse = updatedItem;
            updatedAiTurn.isSynthesisAnswer = true;
          } else if (responseType === 'ensemble') {
            // Store in ensembleResponses (multi-take arrays per provider)
            const existingMap = aiTurn.ensembleResponses || {};
            const arr = Array.isArray(existingMap[providerId])
              ? (existingMap[providerId] as ProviderResponse[])
              : (existingMap[providerId]
                  ? [existingMap[providerId] as unknown as ProviderResponse]
                  : []);
            const last = arr[arr.length - 1];
            const base = (last && last.status !== 'completed' && last.status !== 'error')
              ? last
              : { providerId, text: '', status: 'pending', createdAt: Date.now() } as ProviderResponse;
            const newText = status === 'completed' ? delta : (base.text + delta);
            const updatedItem: ProviderResponse = {
              ...base,
              text: newText,
              status: status as ProviderResponse['status'],
              updatedAt: Date.now()
            };
            const nextArr = (last && base === last)
              ? [...arr.slice(0, -1), updatedItem]
              : [...arr, updatedItem];
            updatedAiTurn.ensembleResponses = {
              ...existingMap,
              [providerId]: nextArr
            };
            // Legacy field for backward compatibility points to latest item
            updatedAiTurn.ensembleResponse = updatedItem;
            updatedAiTurn.isEnsembleAnswer = true;
          } else {
            // Store in batchResponses (GPT, Claude, Gemini)
            const existingResponses = aiTurn.batchResponses || {};
            const existing = existingResponses[providerId] || { 
              providerId, text: '', status: 'pending', createdAt: Date.now() 
            } as ProviderResponse;
            const newText = status === 'completed' ? delta : (existing.text + delta);
            updatedAiTurn.batchResponses = {
              ...existingResponses,
              [providerId]: {
                ...existing,
                text: newText,
                status: status as ProviderResponse['status'],
                updatedAt: Date.now()
              }
            };
            // Keep legacy field for backward compatibility
            updatedAiTurn.providerResponses = updatedAiTurn.batchResponses;
          }
          return updatedAiTurn;
        });
      });
    }

    return (message: any) => {
      if (!message) return;

      // Session ID binding
      if ((message.type === 'session' || message.type?.toLowerCase() === 'session') && message.sessionId) {
        const sid = message.sessionId as string;
        setCurrentSessionId(sid);
        if (typeof (api as any).setSessionId === 'function') {
          (api as any).setSessionId(sid);
        }
        
        // Rebind existing messages to session
        setMessages(prev => prev.map(m => ({ ...m, sessionId: sid })));
        setPendingUserTurns(prevMap => {
          const newMap = new Map(prevMap);
          newMap.forEach((userTurn, aiId) => {
            if (userTurn.sessionId === null) {
              const updatedUser = { ...userTurn, sessionId: sid };
              newMap.set(aiId, updatedUser);
            }
          });
          return newMap;
        });
        return;
      }

      // Helper to buffer streaming updates or apply complete updates immediately
      const updateProvider = (
        providerId: string,
        text: string | undefined,
        responseType: 'batch' | 'synthesis' | 'ensemble' | undefined,
        isPartial?: boolean,
        status?: string
      ) => {
        if (!providerId || !text) return;
        if (!responseType) {
          console.warn('Backend message missing responseType; defaulting to batch for provider:', providerId);
          responseType = 'batch';
        }
        
        const finalStatus = status || (isPartial ? 'streaming' : 'completed');
        
        if (isPartial && finalStatus === 'streaming') {
          // Buffer streaming deltas for batched updates
          streamingBufferRef.current?.addDelta(providerId, text, finalStatus, responseType);
        } else {
          // Immediate update for completion/errors
          streamingBufferRef.current?.setComplete(providerId, text, finalStatus, responseType);
        }
      };

      const rawType = (message.type || message.event || '').toString();
      const typeLower = rawType.toLowerCase();

      // Handle bulk results (array and object variants)
      if (Array.isArray(message.results) && message.results.length > 0) {
        message.results.forEach((r: any) => {
          const providerId = r.provider || r.providerId || r.providerKey;
          const text = r.result || r.response || r.resultText;
          const respType = r.responseType || message.responseType;
          updateProvider(providerId, text, respType, false, 'completed');
        });
        return;
      } else if (message.results && typeof message.results === 'object') {
        try {
          Object.entries(message.results).forEach(([pid, obj]: any) => {
            const text = obj?.text || obj?.response || obj?.result || '';
            const respType = obj?.responseType || message.responseType;
            updateProvider(pid as string, text, respType, false, 'completed');
          });
          return;
        } catch {}
      }

      // Handle data envelope
      if (message.data) {
        const prov = message.data.provider || message.data.providerId;
        const txt = message.data.result || message.data.text || message.data.response;
        const partial = !!message.data.isPartial || !!message.data.partial;
        const respType = message.data.responseType || message.responseType;
        if (prov) {
          updateProvider(prov, txt, respType, partial, message.data.status);
          return;
        }
      }

      // Provider-level messages
      if (typeLower.includes('provider') || typeLower.includes('workflow_step') || message.providerId || message.provider) {
        const providerId = message.providerId || message.provider || message.providerKey;
        
        // Skip system messages
        if (providerId === 'system') {
          console.debug('[System Message]', message);
          return;
        }
        const text = message.text || message.chunk || message.partialText || message.result;
        const isPartial = !!message.isPartial || !!message.partial || typeLower.includes('partial');
        const status = message.status || (typeLower.includes('complete') ? 'completed' : undefined);
        const respType = message.responseType as ('batch' | 'synthesis' | 'ensemble' | undefined);
        
        updateProvider(providerId, text, respType, isPartial, status);
        
        // Capture provider context
        if (message.meta && providerId) {
          setProviderContexts(prev => ({
            ...prev,
            [providerId]: { ...(prev[providerId] || {}), ...message.meta }
          }));
        }
        return;
      }

      
      

      // Legacy synthesis handler removed: explicit responseType routing handled above
      // Legacy ensemble_complete handler removed: unified handling via responseType

      // Hidden batch reveal messages - update the unified AI turn
      if (typeLower.includes('hidden_batch_reveal') || message.type === 'HIDDEN_BATCH_REVEAL') {
        if (!message.batchResults) return;
        
        if (activeAiTurnIdRef.current) {
          updateAiTurnById(activeAiTurnIdRef.current, aiTurn => {
            const batchResponses: Record<string, ProviderResponse> = {};
            Object.entries(message.batchResults).forEach(([providerId, text]: [string, any]) => {
              batchResponses[providerId] = {
                providerId,
                text: typeof text === 'string' ? text : text?.text || '',
                status: 'completed',
                createdAt: Date.now(),
                updatedAt: Date.now()
              };
            });
            
            return {
              ...aiTurn,
              batchResponses: {
                ...aiTurn.batchResponses,
                ...batchResponses
              },
              hiddenBatchOutputs: {
                ...aiTurn.hiddenBatchOutputs,
                ...message.batchResults
              }
            };
          });
        }
        return;
      }

      // Error handling
      if (typeLower.includes('error') || message.error) {
        console.error('Workflow error:', message.error || message);
        setIsLoading(false);
        const providerId = message.providerId || message.provider;
        if (providerId) {
          updateProvider(providerId, `Error: ${message.error || 'Unknown'}`, undefined, false, 'error');
        }
        return;
      }
    };
  }

  // Push user turn -> push empty AI turn -> stream into AI turn
  const handleSendPrompt = useCallback(async (prompt: string) => {
    setIsLoading(true);
    setUiPhase('streaming');
    if (showWelcome) setShowWelcome(false);
    setCurrentAppStep('initial');
    setModelsTouched(true);

    const activeProviders = LLM_PROVIDERS_CONFIG.filter((p: LLMProvider) => selectedModels[p.id]);
    if (activeProviders.length === 0) {
      setIsLoading(false);
      return;
    }

    // 1. Push user turn
    const userTurn: UserTurn = {
      type: 'user',
      id: `user-${Date.now()}`,
      text: prompt,
      createdAt: Date.now(),
      sessionId: currentSessionId,
    };
    const baseTimestamp = Date.now();
    const synthesisTurnId = `ai-synthesis-${baseTimestamp}`;
    const ensembleTurnId = `ai-ensemble-${baseTimestamp + 1}`;
    const hiddenBatchTurnId = `ai-hidden-${baseTimestamp + 2}`;
    
    setPendingUserTurns(prev => new Map(prev).set(synthesisTurnId, userTurn));
    setMessages(prev => [...prev, userTurn]);
    
    // 2. Check if synthesis-first workflow should be used
    const shouldUseSynthesis = synthesisProvider && activeProviders.length > 1;
    
    if (shouldUseSynthesis) {
      // Create a single unified AI turn that will be progressively filled with all response types
      const unifiedAiTurn: AiTurn = {
        type: 'ai',
        id: synthesisTurnId,
        createdAt: baseTimestamp,
        sessionId: currentSessionId,
        meta: { synthForUserTurnId: userTurn.id },
        // Initialize all response containers as empty - they'll be filled as data arrives
        batchResponses: {},
        synthesisResponses: { [synthesisProvider]: [ { 
            providerId: synthesisProvider,
            text: '',
            status: 'pending',
            createdAt: baseTimestamp
          }]
        },
        ensembleResponses: {},
        providerResponses: {
          [synthesisProvider]: {
            providerId: synthesisProvider,
            text: '',
            status: 'pending',
            createdAt: baseTimestamp
          }
        },
        hiddenBatchOutputs: {}
      };

      setMessages(prev => [...prev, unifiedAiTurn]);
      activeAiTurnIdRef.current = synthesisTurnId;

      try {
        const handlePortMessage = createPortMessageHandler();
        handlePortMessageRef.current = handlePortMessage;
        
        const useThinking = (selectedModels['chatgpt'] === true) && Boolean(
          computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: prompt })
        );

        // Execute hidden batch + synthesis workflow
        const { sessionId, port } = api.executeBatchPromptWithSynthesis(
          prompt,
          activeProviders,
          synthesisProvider,
          isVisibleMode,
          uiTabId,
          handlePortMessage,
          currentSessionId || undefined,
          useThinking
        );
        
        setCurrentSessionId(sessionId);
        lastAttachedPortRef.current = port;
        
        // Rebind turns to session
        setMessages(prev => prev.map(t => ({ ...t, sessionId })));
        setPendingUserTurns(prev => {
          const newMap = new Map(prev);
          const pending = newMap.get(synthesisTurnId);
          if (pending) {
            newMap.set(synthesisTurnId, { ...pending, sessionId });
          }
          return newMap;
        });
      } catch (e) {
        console.error('Failed to start synthesis-first batch prompt:', e);
        setIsLoading(false);
        activeAiTurnIdRef.current = null;
        setPendingUserTurns(prev => {
          const newMap = new Map(prev);
          newMap.delete(synthesisTurnId);
          return newMap;
        });
      }
    } else {
      // Original workflow: Push empty AI turn with pending providers
      const aiTurnId = `ai-${Date.now()}`;
      setPendingUserTurns(prev => new Map(prev).set(aiTurnId, userTurn));

      const pendingProviderResponses: Record<string, ProviderResponse> = {};
      activeProviders.forEach(provider => {
        pendingProviderResponses[provider.id] = {
          providerId: provider.id,
          text: '',
          status: 'pending',
          createdAt: Date.now()
        };
      });

      const aiTurn: AiTurn = {
        type: 'ai',
        id: aiTurnId,
        createdAt: Date.now(),
        sessionId: currentSessionId,
        batchResponses: pendingProviderResponses, // Main batch responses container
        synthesisResponses: {},
        ensembleResponses: {},
        providerResponses: pendingProviderResponses // Legacy compatibility
      };
      setMessages(prev => [...prev, aiTurn]);
      activeAiTurnIdRef.current = aiTurnId;

      try {
        const handlePortMessage = createPortMessageHandler();
        handlePortMessageRef.current = handlePortMessage;
        
        const useThinking = (selectedModels['chatgpt'] === true) && Boolean(
          computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: prompt })
        );

        const { sessionId, port } = api.executeBatchPrompt(
          prompt,
          activeProviders,
          isVisibleMode,
          uiTabId,
          handlePortMessage,
          currentSessionId || undefined,
          useThinking
        );
        
        setCurrentSessionId(sessionId);
        lastAttachedPortRef.current = port;
        
        // Rebind turns to session
        setMessages(prev => prev.map(t => ({ ...t, sessionId })));
        setPendingUserTurns(prev => {
          const newMap = new Map(prev);
          const pending = newMap.get(aiTurnId);
          if (pending) {
            newMap.set(aiTurnId, { ...pending, sessionId });
          }
          return newMap;
        });
      } catch (e) {
        console.error('Failed to start batch prompt:', e);
        setIsLoading(false);
        activeAiTurnIdRef.current = null;
        setPendingUserTurns(prev => {
          const newMap = new Map(prev);
          newMap.delete(aiTurnId);
          return newMap;
        });
      }
    }
  }, [selectedModels, showWelcome, currentSessionId, isVisibleMode, uiTabId, createPortMessageHandler, thinkOnChatGPT, synthesisProvider]);

  const handleContinuation = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || !currentSessionId) return;

    const providerIds = LLM_PROVIDERS_CONFIG.filter((p: LLMProvider) => selectedModels[p.id]).map(p => p.id);
    if (providerIds.length === 0) return;

    setCurrentAppStep('initial');
    setIsLoading(true);

    // 1. Push user turn
    const userTurn: UserTurn = {
      type: 'user',
      id: `user-${Date.now()}`,
      text: trimmed,
      createdAt: Date.now(),
      sessionId: currentSessionId
    };
    const aiTurnId = `ai-${Date.now()}`;
    setPendingUserTurns(prev => new Map(prev).set(aiTurnId, userTurn));
    setMessages(prev => [...prev, userTurn]);

    // 2. Push empty AI turn
    const pendingProviderResponses: Record<string, ProviderResponse> = {};
    providerIds.forEach(pid => {
      pendingProviderResponses[pid] = {
        providerId: pid,
        text: '',
        status: 'pending',
        createdAt: Date.now()
      };
    });

    const aiTurn: AiTurn = {
      type: 'ai',
      id: aiTurnId,
      createdAt: Date.now(),
      sessionId: currentSessionId,
      batchResponses: pendingProviderResponses, // Main batch responses container
      synthesisResponses: {},
      ensembleResponses: {},
      providerResponses: pendingProviderResponses // Legacy compatibility
    };
    setMessages(prev => [...prev, aiTurn]);
    activeAiTurnIdRef.current = aiTurnId;

    try {
      // Set up port message handler for continuation responses
      const handlePortMessage = createPortMessageHandler();
      handlePortMessageRef.current = handlePortMessage;
      
      // Get the port that will be used for continuation
      const port = await api.ensurePort({ sessionId: currentSessionId });
      if (port && handlePortMessageRef.current && lastAttachedPortRef.current !== port) {
        port.onMessage.addListener(handlePortMessageRef.current);
        lastAttachedPortRef.current = port;
      }
      
      const useThinking = (selectedModels['chatgpt'] === true) && Boolean(
        computeThinkFlag({ modeThinkButtonOn: thinkOnChatGPT, input: trimmed })
      );

      await api.executeContinuationPrompt({
        prompt: trimmed,
        providers: providerIds,
        sessionId: currentSessionId,
        providerContexts,
        uiTabId,
        options: { useThinking }
      });
    } catch (e) {
      console.error('Continuation failed:', e);
      setIsLoading(false);
      activeAiTurnIdRef.current = null;
      setPendingUserTurns(prev => {
        const newMap = new Map(prev);
        newMap.delete(aiTurnId);
        return newMap;
      });
    }
  }, [currentSessionId, selectedModels, providerContexts, uiTabId, createPortMessageHandler]);

  const handleSynthesize = useCallback(async (providerId: string) => {
    // Legacy global synth no longer used; round-level bar handles synthesis
    return;
  }, [currentSessionId, messages, uiTabId]);

  // =========================================
  // Simplified Ensemble: Single-Turn Action
  // =========================================

  // Deprecated global ensemble (replaced by per-round run)
  const handleEnsembleTurn = useCallback(async () => { return; }, []);

  const getSelectedModelIds = useCallback((): string[] => {
    return LLM_PROVIDERS_CONFIG.filter((p: LLMProvider) => selectedModels[p.id]).map(p => p.id);
  }, [selectedModels]);

  const handleNewChat = useCallback(async () => {
    setMessages([]);
    setCurrentAppStep('initial');
    setIsLoading(false);
    setCurrentSessionId(null);
    setIsHistoryPanelOpen(false);
    setShowWelcome(true);
    setIsContinuationMode(false);
    setModelsTouched(false);
    activeAiTurnIdRef.current = null;
    setPendingUserTurns(new Map());
    
    const defaultModels: Record<string, boolean> = LLM_PROVIDERS_CONFIG.reduce<Record<string, boolean>>((acc, provider) => {
      acc[provider.id] = ['claude', 'gemini', 'chatgpt'].includes(provider.id);
      return acc;
    }, {} as Record<string, boolean>);
    setSelectedModels(defaultModels);
  }, []);

  const handleSelectChat = useCallback(async (session: ChatSession) => {
    const sessionId = session.sessionId;
    setCurrentSessionId(sessionId);
    setIsLoading(true);
    try {
      const s: BackendFullSession = await api.getHistorySession(sessionId) as unknown as BackendFullSession;
      const rounds = s?.turns || [];
      const loadedMessages: TurnMessage[] = [];
      rounds.forEach((r: any) => {
        const baseTs = Number(r?.createdAt || Date.now());
        loadedMessages.push({
          type: 'user',
          id: `user-${baseTs}`,
          text: String(r?.user?.text || ''),
          createdAt: Number(r?.user?.createdAt || baseTs),
          sessionId
        } as UserTurn);
        const providerResponses: Record<string, ProviderResponse> = {} as any;
        Object.entries(r?.providers || {}).forEach(([pid, data]: any) => {
          providerResponses[String(pid)] = {
            providerId: String(pid),
            text: String((data && data.text) || ''),
            status: 'completed',
            meta: (data && data.meta) || {},
            createdAt: Number(r?.completedAt || baseTs + 1),
            updatedAt: Number(r?.completedAt || baseTs + 1)
          } as any;
        });
        const aiTurn: AiTurn = {
          type: 'ai',
          id: `ai-${baseTs + 1}`,
          createdAt: Number(r?.completedAt || baseTs + 1),
          sessionId,
          batchResponses: providerResponses,
          synthesisResponses: {},
          ensembleResponses: {},
          providerResponses // legacy kept as shorthand
        } as AiTurn;
        loadedMessages.push(aiTurn);
      });
      setMessages(loadedMessages);

      // Set continuation contexts from backend snapshot
      const providerContexts = s?.providerContexts || {};
      for (const [pid, ctx] of Object.entries(providerContexts)) {
        api.updateProviderContext(pid, ctx);
      }

      api.setSessionId(sessionId);
      const port = await api.ensurePort({ sessionId });
      if (port) {
        port.postMessage({ type: 'sync_contexts', sessionId, providerContexts });
      }

      setShowWelcome(false);
      // Determine app step
      if (loadedMessages.length === 0) {
        setCurrentAppStep('initial');
        setIsContinuationMode(false);
      } else {
        const lastTurn = loadedMessages[loadedMessages.length - 1];
        if (lastTurn.type === 'ai') {
          setCurrentAppStep('awaitingSynthesis');
          setIsContinuationMode(true);
        } else {
          setCurrentAppStep('initial');
          const hasAiTurn = loadedMessages.some(t => t.type === 'ai');
          setIsContinuationMode(hasAiTurn);
        }
      }
      // Restore scroll if applicable (outer scroller, not window)
      const scrollState = await persistenceService.loadScrollPosition();
      if (scrollState && scrollState.sessionId === sessionId) {
        setTimeout(() => {
          const el = outerScrollRef.current;
          if (el) el.scrollTop = scrollState.position || 0;
          // Update stickiness after restore
          scrollBottomRef.current = isNearBottom();
        }, 100);
      }
    } catch (error) {
      console.error('Error loading session:', error);
      setMessages([]);
      setCurrentAppStep('initial');
      setIsContinuationMode(false);
    } finally {
      setIsLoading(false);
      setIsHistoryPanelOpen(false);
    }
  }, []);

  const handleDeleteChat = useCallback(async (sessionId: string) => {
    try {
      // Delete from backend (source of truth)
      try {
        await api.deleteBackgroundSession(sessionId);
      } catch (e) {
        console.warn('Background session cleanup failed:', e);
      }

      // Clear any UI-local remnants (scroll/app state)
      try {
        // No need to delete session from persistence service as it's now managed by backend
      } catch {}

      try { api.clearSession(sessionId); } catch {}

      // History refresh is handled by the useEffect hook above
      
      if (currentSessionId === sessionId) {
        setMessages([]);
        setCurrentSessionId(null);
        setShowWelcome(true);
        setIsContinuationMode(false);
        setCurrentAppStep('initial');
        activeAiTurnIdRef.current = null;
        setPendingUserTurns(new Map());
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, [isHistoryPanelOpen, currentSessionId]);

  // Row typed as react-window child
  const Row: React.FC<ListChildComponentProps> = ({ index, style }) => {
    // Hooks must be at top level
    const containerRef = useRef<HTMLDivElement | null>(null);
    const turn = messages[index];

    useEffect(() => {
      const el = containerRef.current;
      if (!el || !turn) return;

      let prev = sizeMapRef.current[turn.id] || 0;
      const measure = () => {
        const rect = el.getBoundingClientRect();
        const height = Math.ceil(rect.height);
        if (height && Math.abs(height - prev) > 1) {
          const delta = height - prev;
          sizeMapRef.current[turn.id] = height;
          prev = height;

          // Preserve viewport: if user is mid-scroll, offset outer scrollTop by delta
          const outer = outerScrollRef.current;
          const isMidScroll = outer ? outer.scrollTop > 0 && outer.scrollTop !== lastScrollTopRef.current : false;

          requestAnimationFrame(() => {
            try { listRef.current?.resetAfterIndex(index, true); } catch {}
            if (outer) {
              if (scrollBottomRef.current) {
                outer.scrollTop = outer.scrollHeight - outer.clientHeight;
              } else if (isMidScroll) {
                outer.scrollTop += delta;
              }
            }
          });
        }
      };

      measure();
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      return () => ro.disconnect();
    }, [index, turn && turn.id, expandedUserTurns[turn?.id || ''] , isReducedMotion, currentAppStep]);

    if (turn && isUserTurn(turn)) {
      const { synthMap, ensembleMap, disableSynthesisRun, disableEnsembleRun } = buildEligibleMapForRound(turn.id);
      return (
        <div style={style}>
          <div ref={containerRef} style={{ padding: '8px 0' }}>
            <UserTurnBlock
              userTurn={turn as UserTurn}
              isExpanded={expandedUserTurns[turn.id] ?? true}
              onToggle={handleToggleUserTurn}
            />
          </div>
        </div>
      );
    }

    return (
      <div style={style}>
        <div ref={containerRef} style={{ padding: '8px 0' }}>
          {turn && isAiTurn(turn) ? (() => {
            const ai = turn as AiTurn;


            // Compose ensemble output under the synthesis turn for layered rendering
            let aiForRender: AiTurn = ai;
            if (ai.isSynthesisAnswer) {
              // The synthesis turn already contains ensemble responses in the unified model
              aiForRender = ai; // No need to merge from separate turns
            }

            return (
              <AiTurnBlock
                aiTurn={aiForRender}
                isLive={turn.id === activeAiTurnIdRef.current}
                isReducedMotion={isReducedMotion}
                isLoading={isLoading}
                currentAppStep={currentAppStep}
                showSourceOutputs={showSourceOutputs}
                onToggleSourceOutputs={() => setShowSourceOutputs(prev => !prev)}
                onEnterComposerMode={handleEnterComposerMode}
              />
            );
          })() : null}
        </div>
      </div>
    );
  };

  // Helpers used in JSX
  const handleToggleModel = (providerId: string) => {
    setSelectedModels(prev => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const handleSetSynthesisProvider = (providerId: string | null) => {
    setSynthesisProvider(providerId);
  };

  const activeProviderCount = LLM_PROVIDERS_CONFIG.filter((p: LLMProvider) => selectedModels[p.id]).length;

  const handleSwitchViewMode = (mode: ViewMode) => {
    setViewMode(mode);
  };

  return (
    <div className="sidecar-app-container" style={{ display: 'flex', height: '100vh', overflow: 'hidden', gap: '0px', padding: '0' }}>
      <div
        className="main-content-wrapper"
        style={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '0'
        }}
      >
        <header
          className="header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            background: 'rgba(15, 15, 35, 0.8)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            flexShrink: 0,
          }}
        >
          <div className="logo-area" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => setIsHistoryPanelOpen(!isHistoryPanelOpen)}
              style={{ background: 'none', border: 'none', color: '#e2e8f0', cursor: 'pointer', padding: '4px' }}
              aria-label="Toggle History Panel"
            >
              <MenuIcon style={{ width: '24px', height: '24px' }} />
            </button>
            <div className="logo" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '18px' }}>
              <div
                className="logo-icon"
                style={{
                  width: '24px',
                  height: '24px',
                  background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                }}
              >
                ⚡
              </div>
              Sidecar
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="settings-btn"
              onClick={() => setIsSettingsOpen(true)}
              style={{
                padding: '8px 12px',
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '8px',
                color: '#e2e8f0',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              ⚙️ Models
            </button>
            <button
              className="mode-btn"
              onClick={() => handleSwitchViewMode(viewMode === ViewMode.CHAT ? ViewMode.COMPOSER : ViewMode.CHAT)}
              style={{
                padding: '8px 12px',
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '8px',
                color: '#e2e8f0',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {viewMode === ViewMode.CHAT ? 'Composer' : 'Chat'}
            </button>
          </div>
        </header>

        <main className="chat-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0' }}>
          {viewMode === ViewMode.CHAT ? (
            <div style={{ flex: 1, overflow: 'hidden', padding: '0' }}>
              {showWelcome && (
                <div
                  className="welcome-state"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    textAlign: 'center',
                    padding: '40px 20px',
                  }}
                >
                  <div
                    className="welcome-icon"
                    style={{
                      width: '80px',
                      height: '80px',
                      background: 'linear-gradient(45deg, #6366f1, #8b5cf6)',
                      borderRadius: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '32px',
                      marginBottom: '24px',
                    }}
                  >
                    🧠
                  </div>
                  <h2 className="welcome-title" style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px' }}>
                    Intelligence Augmentation
                  </h2>
                  <p className="welcome-subtitle" style={{ fontSize: '16px', color: '#94a3b8', marginBottom: '32px', maxWidth: '400px' }}>
                    Ask one question, get synthesized insights from multiple AI models in real-time
                  </p>
                  <button
                    onClick={() => handleSendPrompt(EXAMPLE_PROMPT)}
                    disabled={isLoading}
                    style={{
                      fontSize: '14px',
                      color: '#a78bfa',
                      padding: '8px 16px',
                      border: '1px solid #a78bfa',
                      borderRadius: '8px',
                      background: 'rgba(167, 139, 250, 0.1)',
                      cursor: 'pointer',
                      opacity: isLoading ? 0.5 : 1,
                    }}
                  >
                    Try: "{EXAMPLE_PROMPT}"
                  </button>
                </div>
              )}

              {!showWelcome && (
                <div ref={outerScrollRef} style={{ height: Math.max(300, window.innerHeight - 220), overflowY: 'hidden', overflowX: 'hidden', padding: '0' }}>
                <List
                  ref={listRef}
                  height={Math.max(300, window.innerHeight - 220)}
                  width={'100%'}
                  itemCount={messages.length}
                  itemSize={(index: number) => getItemSize(index)}
                  itemKey={(index: number) => messages[index]?.id || String(index)}
                  overscanCount={5}
                  estimatedItemSize={160}
                  style={{ padding: '8px 0' }}
                >
                  {Row}
                </List>
                </div>
              )}
            </div>
          ) : viewMode === ViewMode.COMPOSER && activeComposerTurn ? (
            <ComposerMode
              aiTurn={activeComposerTurn}
              sessionId={currentSessionId}
              onExit={handleExitComposerMode}
              onUpdateAiTurn={handleUpdateAiTurnForComposer}
            />
          ) : null}
        </main>

        <ModelTray
          selectedModels={selectedModels}
          onToggleModel={handleToggleModel}
          isLoading={isLoading}
          thinkOnChatGPT={thinkOnChatGPT}
          onToggleThinkChatGPT={() => setThinkOnChatGPT(prev => !prev)}
          synthesisProvider={synthesisProvider}
          onSetSynthesisProvider={handleSetSynthesisProvider}
        />

        {viewMode === ViewMode.CHAT && (
          <ChatInput
            onSendPrompt={handleSendPrompt}
            onContinuation={handleContinuation}
            isLoading={isLoading}
            isReducedMotion={isReducedMotion}
            activeProviderCount={activeProviderCount}
            isVisibleMode={isVisibleMode}
            isContinuationMode={isContinuationMode}
          />
        )}
      </div>

      {isHistoryPanelOpen && (
        <>
          <div
            className="history-backdrop"
            aria-hidden="true"
            onClick={() => setIsHistoryPanelOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(2px)', zIndex: 1000 }}
          />
          <div
            ref={historyOverlayRef}
            role="dialog"
            aria-modal="true"
            aria-label="Chat history"
            className="history-overlay"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '320px',
              height: '100vh',
              background: 'rgba(10, 10, 25, 0.96)',
              backdropFilter: 'blur(15px)',
              borderRight: '1px solid rgba(255, 255, 255, 0.1)',
              zIndex: 1100,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            <HistoryPanel
              isOpen={isHistoryPanelOpen}
              sessions={historySessions}
              isLoading={isHistoryLoading}
              onNewChat={handleNewChat}
              onSelectChat={handleSelectChat}
              onDeleteChat={handleDeleteChat}
            />
          </div>
        </>
      )}

      <div
        className="settings-panel"
        style={{
          position: 'fixed',
          top: 0,
          right: isSettingsOpen ? '0px' : '-350px',
          width: '350px',
          height: '100vh',
          background: 'rgba(15, 15, 35, 0.95)',
          backdropFilter: 'blur(20px)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
          transition: 'right 0.3s ease',
          zIndex: 1000,
          padding: '20px',
          overflowY: 'auto',
        }}
      >
        <div className="settings-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h2 className="settings-title" style={{ fontSize: '18px', fontWeight: 600 }}>Model Configuration</h2>
          <button
            className="close-settings"
            onClick={() => setIsSettingsOpen(false)}
            style={{
              padding: '8px',
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              borderRadius: '4px',
              transition: 'background 0.2s ease',
              fontSize: '18px',
            }}
          >
            ✕
          </button>
        </div>
        
        <div className="model-config">
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#a78bfa' }}>Active Models</h3>
          {LLM_PROVIDERS_CONFIG.map(provider => (
            <div
              key={provider.id}
              className="model-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                marginBottom: '8px',
              }}
            >
              <div className="model-info" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className={`model-logo ${provider.logoBgClass}`} style={{ width: '16px', height: '16px', borderRadius: '3px' }}></div>
                <span>{provider.name}</span>
              </div>
              <div
                className={`model-toggle ${selectedModels[provider.id] ? 'active' : ''}`}
                onClick={() => handleToggleModel(provider.id)}
                style={{
                  width: '40px',
                  height: '20px',
                  background: selectedModels[provider.id] ? '#6366f1' : 'rgba(255, 255, 255, 0.2)',
                  borderRadius: '10px',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.2s ease',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: selectedModels[provider.id] ? '22px' : '2px',
                    width: '16px',
                    height: '16px',
                    background: 'white',
                    borderRadius: '50%',
                    transition: 'left 0.2s ease',
                  }}
                />
              </div>
            </div>
          ))}
          
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#a78bfa', marginTop: '20px' }}>Execution Mode</h3>
          <div className="mode-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              marginBottom: '8px',
            }}
          >
            <span>Run in Visible Tabs (for debugging)</span>
            <div
              className={`mode-toggle ${isVisibleMode ? 'active' : ''}`}
              onClick={() => setIsVisibleMode(!isVisibleMode)}
              style={{
                width: '40px',
                height: '20px',
                background: isVisibleMode ? '#6366f1' : 'rgba(255, 255, 255, 0.2)',
                borderRadius: '10px',
                position: 'relative',
                cursor: 'pointer',
                transition: 'background 0.2s ease',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: isVisibleMode ? '22px' : '2px',
                  width: '16px',
                  height: '16px',
                  background: 'white',
                  borderRadius: '50%',
                  transition: 'left 0.2s ease',
                }}
              />
            </div>
          </div>

          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#a78bfa', marginTop: '20px' }}>Accessibility</h3>
          <div className="mode-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              marginBottom: '8px',
            }}
          >
            <span>Reduced Motion</span>
            <div
              className={`mode-toggle ${isReducedMotion ? 'active' : ''}`}
              onClick={() => setIsReducedMotion(!isReducedMotion)}
              style={{
                width: '40px',
                height: '20px',
                background: isReducedMotion ? '#6366f1' : 'rgba(255, 255, 255, 0.2)',
                borderRadius: '10px',
                position: 'relative',
                cursor: 'pointer',
                transition: 'background 0.2s ease',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: isReducedMotion ? '22px' : '2px',
                  width: '16px',
                  height: '16px',
                  background: 'white',
                  borderRadius: '50%',
                  transition: 'left 0.2s ease',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;