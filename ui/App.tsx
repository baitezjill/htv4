import { useState, useEffect, useCallback, useRef } from 'react';
import { VariableSizeList as List, ListChildComponentProps } from 'react-window';
import React from 'react';
import { TurnMessage, UserTurn, AiTurn, ProviderResponse, AppStep, ChatSession, BackendMessage, LLMProvider, isUserTurn, isAiTurn, UiPhase, BackendFullSession } from './types';
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
  
  // Update refs when state changes
  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);


  // ============================================================================
  // Graceful shutdown handler
  // ============================================================================
  
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Force flush any pending saves
      try {
        persistenceService.flush?.();
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

      // Check if all providers are complete
      const allComplete = Object.values(updatedAiTurn.providerResponses || {}).every(r => 
        r.status === 'completed' || r.status === 'error'
      );
      
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

      const allComplete = Object.values(updatedAiTurn.providerResponses || {}).every(r => 
        r.status === 'completed' || r.status === 'error'
      );

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

  const findExistingSynthesisTurnForRound = useCallback((userTurnId: string): { index: number; turn: AiTurn } | null => {
    const round = findRoundForUserTurn(userTurnId);
    if (!round) return null;
    const { userIndex } = round;
    for (let i = userIndex + 1; i < messages.length; i++) {
      const t = messages[i];
      if (t.type === 'user') break;
      if (t.type === 'ai') {
        const ai = t as AiTurn;
        if (!ai.isSynthesisAnswer && !ai.isEnsembleAnswer) break;
        if (ai.isSynthesisAnswer && (ai.meta as any)?.synthForUserTurnId === userTurnId) {
          return { index: i, turn: ai };
        }
      }
    }
    return null;
  }, [messages, findRoundForUserTurn]);

  const findExistingEnsembleTurnForRound = useCallback((userTurnId: string): { index: number; turn: AiTurn } | null => {
    const round = findRoundForUserTurn(userTurnId);
    if (!round) return null;
    const { userIndex } = round;
    for (let i = userIndex + 1; i < messages.length; i++) {
      const t = messages[i];
      if (t.type === 'user') break;
      if (t.type === 'ai') {
        const ai = t as AiTurn;
        if (!ai.isSynthesisAnswer && !ai.isEnsembleAnswer) break;
        if (ai.isEnsembleAnswer && (ai.meta as any)?.synthForUserTurnId === userTurnId) {
          return { index: i, turn: ai };
        }
      }
    }
    return null;
  }, [messages, findRoundForUserTurn]);

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

    const existingSynth = findExistingSynthesisTurnForRound(userTurnId);
    const alreadySynthPids = existingSynth ? Object.keys(existingSynth.turn.providerResponses || {}) : [];

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
    const existingEnsemble = findExistingEnsembleTurnForRound(userTurnId);
    const alreadyEnsemblePids = existingEnsemble ? Object.keys(existingEnsemble.turn.providerResponses || {}) : [];
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
  }, [findRoundForUserTurn, findExistingSynthesisTurnForRound, findExistingEnsembleTurnForRound, providerHasActivityAfter]);

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

    const round = findRoundForUserTurn(userTurnId);
    if (!round || !round.user || !round.ai) return;

    const results: Record<string, string> = {};
    Object.entries(round.ai.providerResponses || {}).forEach(([pid, resp]) => {
      if (resp.status === 'completed' && resp.text?.trim()) results[pid] = resp.text!;
    });
    if (Object.keys(results).length < 2) return;

    const selected = Object.entries(synthSelectionsByRound[userTurnId] || {})
      .filter(([_, on]) => on)
      .map(([pid]) => pid);
    const normalized = selected.filter(pid => ['claude', 'gemini', 'chatgpt'].includes(pid)) as Array<'claude'|'gemini'|'chatgpt'>;
    if (normalized.length === 0) return;

    const existing = findExistingSynthesisTurnForRound(userTurnId);
    let synthTurnId = existing?.turn.id || `ai-synth-${userTurnId}`;
    const insertAt = findFirstInsertIndexBeforeAi(userTurnId);

    if (!existing) {
      const initResp = normalized.reduce((acc, pid) => {
        acc[pid] = { providerId: pid, text: '', status: 'pending', createdAt: Date.now() } as ProviderResponse;
        return acc;
      }, {} as Record<string, ProviderResponse>);
      const newTurn: AiTurn = {
        type: 'ai',
        id: synthTurnId,
        createdAt: Date.now(),
        sessionId: currentSessionId,
        isSynthesisAnswer: true,
        meta: { synthForUserTurnId: userTurnId },
        providerResponses: initResp
      };
      setMessages(prev => {
        const updated = [...prev];
        updated.splice(insertAt, 0, newTurn);
        return updated;
      });
    } else {
      setMessages(prev => {
        const updated = [...prev];
        const idx = updated.findIndex(t => t.id === existing.turn.id);
        if (idx >= 0) {
          const ai = updated[idx] as AiTurn;
          const merged = { ...(ai.providerResponses || {}) } as Record<string, ProviderResponse>;
          normalized.forEach(pid => {
            if (!merged[pid]) {
              merged[pid] = { providerId: pid, text: '', status: 'pending', createdAt: Date.now() } as ProviderResponse;
            }
          });
          updated[idx] = { ...ai, providerResponses: merged } as AiTurn;
        }
        return updated;
      });
    }

    // Stream into this synthesis turn
    activeAiTurnIdRef.current = synthTurnId;
    setIsLoading(true);
    setUiPhase('streaming');
    setCurrentAppStep('synthesis');
    isSynthRunningRef.current = true;

    const originalPrompt = round.user.text || '';
    const idempotencyToken = `${currentSessionId}:${userTurnId}:synth:${normalized.sort().join('+')}`;

    try {
      if (typeof api.ensurePort === 'function') {
        const port = await api.ensurePort({ sessionId: currentSessionId });
        if (port && handlePortMessageRef.current && lastAttachedPortRef.current !== port) {
          port.onMessage.addListener(handlePortMessageRef.current);
          lastAttachedPortRef.current = port;
        }
      }
      if (normalized.length === 1) {
        setLastSynthesisModel(normalized[0]);
      }
      // fan-out supported by backend API; pass array when >1
      await api.executeSynthesis(
        currentSessionId,
        originalPrompt,
        results,
        normalized.length === 1 ? normalized[0] : normalized,
        uiTabId,
        { idempotencyToken, useThinking: !!thinkSynthByRound[userTurnId] && normalized.includes('chatgpt') }
      );
    } catch (err) {
      console.error('Synthesis run failed:', err);
      setIsLoading(false);
      setUiPhase('awaiting_action');
      activeAiTurnIdRef.current = null;
    } finally {
      isSynthRunningRef.current = false;
    }
  }, [currentSessionId, synthSelectionsByRound, uiTabId, findRoundForUserTurn, findExistingSynthesisTurnForRound, findFirstInsertIndexBeforeAi, thinkSynthByRound]);

  // Build the Ensembler prompt using provided fixed template from spec
  const buildEnsemblerPrompt = useCallback((userPrompt: string, modelOutputs: Record<string, string>): string => {
    // Format each model's output with its provider ID as a header
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
  }, []);

  const handleRunEnsembleForRound = useCallback(async (userTurnId: string) => {
    if (!currentSessionId) return;

    const round = findRoundForUserTurn(userTurnId);
    if (!round || !round.user || !round.ai) return;

    const modelOutputs: Record<string, string> = {};
    Object.entries(round.ai.providerResponses || {}).forEach(([pid, resp]) => {
      if (resp.status === 'completed' && resp.text?.trim()) modelOutputs[pid] = resp.text!;
    });
    if (Object.keys(modelOutputs).length < 2) return;

    const ensemblerProvider = ensembleSelectionByRound[userTurnId];
    if (!ensemblerProvider) return;

    const ensemblerPrompt = buildEnsemblerPrompt(round.user.text || '', modelOutputs);

    setIsLoading(true);
    setUiPhase('streaming');
    setCurrentAppStep('synthesis');

    const existing = findExistingEnsembleTurnForRound(userTurnId);
    const aiTurnId = existing?.turn.id || `ai-ensemble-${userTurnId}`;
    const insertAt = findFirstInsertIndexBeforeAi(userTurnId);

    if (!existing) {
      const aiTurn: AiTurn = {
        type: 'ai',
        id: aiTurnId,
        createdAt: Date.now(),
        sessionId: currentSessionId,
        isEnsembleAnswer: true,
        meta: { synthForUserTurnId: userTurnId },
        providerResponses: {
          [ensemblerProvider]: {
            providerId: ensemblerProvider,
            text: '',
            status: 'pending',
            createdAt: Date.now()
          }
        }
      };
      setMessages(prev => {
        const updated = [...prev];
        updated.splice(insertAt, 0, aiTurn);
        return updated;
      });
    }

    activeAiTurnIdRef.current = aiTurnId;

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
  }, [currentSessionId, ensembleSelectionByRound, uiTabId, isVisibleMode, buildEnsemblerPrompt, findRoundForUserTurn, findExistingEnsembleTurnForRound, findFirstInsertIndexBeforeAi, createPortMessageHandler]);

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
    
    // Special handling for ensemble and synthesis answers
    if (aiTurn.isEnsembleAnswer || aiTurn.isSynthesisAnswer) {
      const baseHeight = 150; // Increased base height for special answers
      const content = Object.values(aiTurn.providerResponses || {})[0]?.text || '';
      const lineHeight = 21;
      const charsPerLine = 100;
      
      const lines = content.split('\n').reduce((acc, line) => {
        return acc + Math.max(1, Math.ceil(line.length / charsPerLine));
      }, 0);
      
      const textHeight = lines * lineHeight;
      // Add extra height for the action bar and padding
      return Math.max(200, baseHeight + textHeight + 60);
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

  // Port message handler - streams directly into messages array (hoisted-friendly declaration)
  function createPortMessageHandler() {
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

      // Helper to update provider in active AI turn
      const updateProvider = (providerId: string, text: string | undefined, isPartial?: boolean, status?: string) => {
        const activeId = activeAiTurnIdRef.current;
        if (!providerId || !activeId) return;
        updateAiTurnById(activeId, aiTurn => {
          if (aiTurn.id !== activeId) return aiTurn;
          const existing = aiTurn.providerResponses?.[providerId] || { 
            providerId, text: '', status: 'pending', createdAt: Date.now() 
          } as ProviderResponse;
          const newText = isPartial ? (existing.text + (text || '')) : (text ?? existing.text);
          const newStatus = (status as ProviderResponse['status']) || (isPartial ? 'streaming' : (text ? 'completed' : existing.status));
          const updatedResponse = { 
            ...existing, 
            text: newText, 
            status: newStatus, 
            updatedAt: Date.now() 
          };
          const updatedResponses = { 
            ...(aiTurn.providerResponses || {}), 
            [providerId]: updatedResponse 
          };
          return { ...aiTurn, providerResponses: updatedResponses };
        });
      };

      const rawType = (message.type || message.event || '').toString();
      const typeLower = rawType.toLowerCase();

      // Handle bulk results (array and object variants)
      if (Array.isArray(message.results) && message.results.length > 0) {
        message.results.forEach((r: any) => {
          const providerId = r.provider || r.providerId || r.providerKey;
          const text = r.result || r.response || r.resultText;
          updateProvider(providerId, text, false, 'completed');
        });
        return;
      } else if (message.results && typeof message.results === 'object') {
        try {
          Object.entries(message.results).forEach(([pid, obj]: any) => {
            const text = obj?.text || obj?.response || obj?.result || '';
            updateProvider(pid, text, false, 'completed');
          });
          return;
        } catch {}
      }

      // Handle data envelope
      if (message.data) {
        const prov = message.data.provider || message.data.providerId;
        const txt = message.data.result || message.data.text || message.data.response;
        const partial = !!message.data.isPartial || !!message.data.partial;
        if (prov) {
          updateProvider(prov, txt, partial, message.data.status);
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
        
        updateProvider(providerId, text, isPartial, status);
        
        // Capture provider context
        if (message.meta && providerId) {
          setProviderContexts(prev => ({
            ...prev,
            [providerId]: { ...(prev[providerId] || {}), ...message.meta }
          }));
        }
        return;
      }

      // Synthesis messages
      if (typeLower.includes('synthesis')) {
        const providerId = message.providerId || message.provider || lastSynthesisModel;
        let synthText = message.text || message.chunk || message.partialText || message.result || '';
        
        if (!synthText && Array.isArray(message.payload)) {
          synthText = message.payload.map((p: any) => p.response || p.text || '').join('');
        }

        const isPartial = !!message.isPartial || !!message.partial || typeLower.includes('partial');
        const status = message.status || (typeLower.includes('complete') ? 'completed' : undefined);

        updateProvider(providerId, synthText, isPartial, status);
        return;
      }

      // Error handling
      if (typeLower.includes('error') || message.error) {
        console.error('Workflow error:', message.error || message);
        setIsLoading(false);
        const providerId = message.providerId || message.provider;
        if (providerId) {
          updateProvider(providerId, `Error: ${message.error || 'Unknown'}`, false, 'error');
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
    const aiTurnId = `ai-${Date.now()}`;
    setPendingUserTurns(prev => new Map(prev).set(aiTurnId, userTurn));
    setMessages(prev => [...prev, userTurn]);
    
    // 2. Push empty AI turn with pending providers
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
      providerResponses: pendingProviderResponses
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
  }, [selectedModels, showWelcome, currentSessionId, isVisibleMode, uiTabId, createPortMessageHandler, thinkOnChatGPT]);

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
      providerResponses: pendingProviderResponses
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
        loadedMessages.push({
          type: 'ai',
          id: `ai-${baseTs + 1}`,
          createdAt: Number(r?.completedAt || baseTs + 1),
          sessionId,
          providerResponses
        } as AiTurn);
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
              synthSelected={synthSelectionsByRound[turn.id] || {}}
              onToggleSynth={handleToggleSynthForRound}
              onRunSynthesis={handleRunSynthesisForRound}
              ensembleSelected={ensembleSelectionByRound[turn.id] || null}
              onSelectEnsemble={handleSelectEnsembleForRound}
              onRunEnsemble={handleRunEnsembleForRound}
              eligibleMap={synthMap}
              ensembleEligibleMap={ensembleMap}
              disableSynthesisRun={disableSynthesisRun}
            disableEnsembleRun={disableEnsembleRun}
            thinkSynthForChatGPT={!!thinkSynthByRound[turn.id]}
            onToggleThinkSynthForChatGPT={(rid) => setThinkSynthByRound(prev => ({ ...prev, [rid]: !prev[rid] }))}
            thinkEnsembleForChatGPT={!!thinkEnsembleByRound[turn.id]}
            onToggleThinkEnsembleForChatGPT={(rid) => setThinkEnsembleByRound(prev => ({ ...prev, [rid]: !prev[rid] }))}
            />
          </div>
        </div>
      );
    }

    return (
      <div style={style}>
        <div ref={containerRef} style={{ padding: '8px 0' }}>
          {turn && isAiTurn(turn) ? (
            <AiTurnBlock
              aiTurn={turn as AiTurn}
              isLive={turn.id === activeAiTurnIdRef.current}
              isReducedMotion={isReducedMotion}
              currentAppStep={currentAppStep}
            />
          ) : null}
        </div>
      </div>
    );
  };

  // Helpers used in JSX
  const handleToggleModel = (providerId: string) => {
    setSelectedModels(prev => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const mainContentMarginLeft = isHistoryPanelOpen ? '260px' : '0px';
  const activeProviderCount = LLM_PROVIDERS_CONFIG.filter((p: LLMProvider) => selectedModels[p.id]).length;

  return (
    <div className="sidecar-app-container" style={{ display: 'flex', height: '100vh', overflow: 'hidden', gap: '16px', padding: '0 16px 16px 16px' }}>
      <HistoryPanel
        isOpen={isHistoryPanelOpen}
        sessions={historySessions}
        isLoading={isHistoryLoading}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
      />
      <div
        className="main-content-wrapper"
        style={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          marginLeft: mainContentMarginLeft,
          transition: 'margin-left 0.3s ease',
          width: isHistoryPanelOpen ? `calc(100% - 260px)` : '100%',
          padding: '0 20px 16px 20px'
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
          </div>
        </header>

        <main className="chat-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'hidden', padding: '16px 0' }}>
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
              <div ref={outerScrollRef} style={{ height: Math.max(300, window.innerHeight - 220), overflowY: 'hidden', overflowX: 'hidden', padding: '0 4px' }}>
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
        </main>

        <ModelTray
          selectedModels={selectedModels}
          onToggleModel={handleToggleModel}
          isLoading={isLoading}
          thinkOnChatGPT={thinkOnChatGPT}
          onToggleThinkChatGPT={() => setThinkOnChatGPT(prev => !prev)}
        />

        <ChatInput
          onSendPrompt={handleSendPrompt}
          onContinuation={handleContinuation}
          isLoading={isLoading}
          isReducedMotion={isReducedMotion}
          activeProviderCount={activeProviderCount}
          isVisibleMode={isVisibleMode}
          isContinuationMode={isContinuationMode}
        />
      </div>

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