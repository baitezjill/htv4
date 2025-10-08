// src/core/workflow-engine.js

// =============================================================================
// HELPER FUNCTIONS FOR PROMPT BUILDING
// =============================================================================

function buildSynthesisPrompt(originalPrompt, sourceResults, synthesisProvider) {
  const otherResults = sourceResults
    .map(res => `**${(res.providerId || 'UNKNOWN').toUpperCase()}:**\n${res.text}`)
    .join('\n\n');

  return `You are tasked with synthesizing multiple AI responses into a single, comprehensive answer.

**Original User Query:**
${originalPrompt}

**Responses from other AI models:**
${otherResults}

**Instructions:**
- Synthesize the above responses into a single, well-structured answer
- Identify common themes and reconcile any contradictions
- Provide the most accurate and helpful response possible
- Do not simply concatenate the responses - create a cohesive synthesis
- If the responses disagree, explain the different perspectives and provide your best judgment
- Maintain a natural, conversational tone

Please provide your synthesized response:`;
}

function buildEnsemblerPrompt(userPrompt, modelOutputsMap) {
  const entries = Object.entries(modelOutputsMap || {}).filter(([_, t]) => (t || '').trim().length > 0);
  const modelOutputsBlock = entries
    .map(([providerId, text]) => `=== ${String(providerId).toUpperCase()} ===\n${String(text)}`)
    .join('\n\n');

  return `You are not a synthesizer. You are a mirror that reveals what others cannot see.

Task: Present ALL insights from the models below in their most useful form for decision-making on "${userPrompt}".

Critical instruction: Do NOT synthesize into a single answer. Instead, reason internally via this structure—then output ONLY as seamless, narrative prose that implicitly embeds it all:

**Map the landscape** — Group similar ideas, preserving tensions and contradictions.
**Surface the invisible** — Highlight consensus (2+ models), unique sightings (one model) as natural flow.
**Frame the choices** — present alternatives as "If you prioritize X, this path fits because Y."
**Flag the unknowns** — Note disagreements/uncertainties as subtle cautions.

**Internal format for reasoning (NEVER output directly):**
- What Everyone Sees (consensus)
- The Tensions (disagreements)
- The Unique Insights
- The Choice Framework
- Confidence Check

Finally output your response as a narrative explaining everything implicitly to the user, like a natural response to the user's prompt—fluid, insightful, redacting model names/extraneous details. Build feedback as emergent wisdom—evoke clarity, agency, and subtle awe. Weave your final narrative as representation of a cohesive response of the collective thought to the user's prompt:

User Prompt: ${String(userPrompt || '')}

Model outputs to analyze:
${modelOutputsBlock}`;
}

// Track last seen text per provider/session for delta streaming
const lastStreamState = new Map();

function makeDelta(sessionId, providerId, fullText = "") {
  if (!sessionId) return fullText || "";
  const key = `${sessionId}:${providerId}`;
  const prev = lastStreamState.get(key) || "";
  let delta = "";

  if (fullText && fullText.length > prev.length) {
    delta = fullText.slice(prev.length);
  } else if (fullText && fullText !== prev) {
    delta = fullText;
  }

  lastStreamState.set(key, fullText || "");
  return delta;
}

// =============================================================================
// WORKFLOW ENGINE
// =============================================================================

export class WorkflowEngine {
  constructor(orchestrator, sessionManager, port) {
    this.orchestrator = orchestrator;
    this.sessionManager = sessionManager; // For historical data resolution
    this.port = port;
  }

  async execute(request) {
    const { context, steps } = request;
    const stepResults = new Map();

    // Ensure session exists and notify UI
    if (!context.sessionId || context.sessionId === 'new-session') {
      context.sessionId = `sid-${Date.now()}`;
      this.port.postMessage({ type: 'SESSION_STARTED', sessionId: context.sessionId });
    }

    for (const step of steps) {
      try {
        let result;
        switch (step.type) {
          case 'prompt':
            result = await this.executePromptStep(step, context);
            break;
          case 'synthesis':
            result = await this.executeSynthesisStep(step, context, stepResults);
            break;
          case 'ensemble':
            result = await this.executeEnsembleStep(step, context, stepResults);
            break;
        }
        stepResults.set(step.stepId, { status: 'completed', result });
        this.port.postMessage({ type: 'WORKFLOW_STEP_UPDATE', sessionId: context.sessionId, stepId: step.stepId, status: 'completed', result });
      } catch (error) {
        console.error(`[WorkflowEngine] Step ${step.stepId} failed:`, error);
        stepResults.set(step.stepId, { status: 'failed', error: error.message });
        this.port.postMessage({ type: 'WORKFLOW_STEP_UPDATE', sessionId: context.sessionId, stepId: step.stepId, status: 'failed', error: error.message });
        break; // Stop workflow on failure
      }
    }
    
    this.port.postMessage({ type: 'WORKFLOW_COMPLETE', sessionId: context.sessionId, workflowId: request.workflowId, finalResults: Object.fromEntries(stepResults) });
    return stepResults;
  }

  // --- Step Executors ---

  async executePromptStep(step, context) {
    const { prompt, providers, useThinking, providerContexts } = step.payload;
    return new Promise((resolve) => {
      this.orchestrator.executeParallelFanout(prompt, providers, {
        sessionId: context.sessionId,
        useThinking,
        providerContexts,
        onPartial: (providerId, chunk) => {
          const delta = makeDelta(context.sessionId, providerId, chunk);
          this.port.postMessage({ type: 'PARTIAL_RESULT', sessionId: context.sessionId, stepId: step.stepId, providerId, chunk: delta });
        },
        onAllComplete: (results, errors) => {
          results.forEach((res, pid) => this.sessionManager.updateProviderContext(context.sessionId, pid, res, true, { skipSave: true }));
          this.sessionManager.saveSession(context.sessionId); // Save once at the end of the step
          resolve({ results, errors });
        }
      });
    });
  }

  // In src/core/workflow-engine.js

async resolveSourceData(payload, context, previousResults) {
    if (payload.sourceHistorical) {
        const { turnId: userTurnId, responseType } = payload.sourceHistorical;
        console.log(`[WorkflowEngine] Resolving historical data from turn associated with userTurnId: ${userTurnId}`);
        
        const session = this.sessionManager.sessions[context.sessionId];
        if (!session) throw new Error(`Session ${context.sessionId} not found.`);

        // Find the AI turn that FOLLOWS the user turn
        const userTurnIndex = session.turns.findIndex(t => t.id === userTurnId && t.type === 'user');
        if (userTurnIndex === -1) throw new Error(`Historical user turn ${userTurnId} not found.`);
        
        const aiTurn = session.turns[userTurnIndex + 1];
        if (!aiTurn || aiTurn.type !== 'ai') throw new Error(`Could not find corresponding AI turn for ${userTurnId}`);
        
        let sourceContainer;
        switch(responseType) {
            case 'synthesis': sourceContainer = aiTurn.synthesisResponses || {}; break;
            case 'ensemble': sourceContainer = aiTurn.ensembleResponses || {}; break;
            default: sourceContainer = aiTurn.batchResponses || {}; break;
        }
      
        // Return an array of { providerId, text } objects, filtering out incomplete ones
        return Object.values(sourceContainer).flat().filter(res => res.status === 'completed' && res.text);

    } else if (payload.sourceStepIds) {
        // ... existing logic is fine ...
        return payload.sourceStepIds.flatMap(id => 
            Array.from(previousResults.get(id)?.result?.results?.values() || [])
        // This part also needs a fix to check status, not 'ok'
        ).filter(res => res.status === 'completed' && res.text);
    }
    throw new Error('No valid source specified for step.');
}

  async executeSynthesisStep(step, context, previousResults) {
    const payload = step.payload;
    const sourceData = await this.resolveSourceData(payload, context, previousResults);
    if (sourceData.length === 0) throw new Error("No valid sources for synthesis.");

    // NOTE: `buildSynthesisPrompt` now lives on the backend.
    const synthPrompt = buildSynthesisPrompt(payload.originalPrompt, sourceData, payload.synthesisProvider);

    return new Promise((resolve) => {
      this.orchestrator.executeParallelFanout(synthPrompt, [payload.synthesisProvider], {
        sessionId: context.sessionId,
        useThinking: payload.useThinking,
        onPartial: (providerId, chunk) => {
          const delta = makeDelta(context.sessionId, providerId, chunk);
          this.port.postMessage({ type: 'PARTIAL_RESULT', sessionId: context.sessionId, stepId: step.stepId, providerId, chunk: delta });
        },
        onAllComplete: (results) => {
          const finalResult = results.get(payload.synthesisProvider);
          this.sessionManager.updateProviderContext(context.sessionId, payload.synthesisProvider, finalResult, true, { skipSave: true });
          this.sessionManager.saveSession(context.sessionId);
          resolve(finalResult);
        }
      });
    });
  }

  async executeEnsembleStep(step, context, previousResults) {
    // This logic is nearly identical to synthesis, just using a different prompt builder
    const payload = step.payload;
    const sourceData = await this.resolveSourceData(payload, context, previousResults);
    if (sourceData.length === 0) throw new Error("No valid sources for ensemble.");

    const ensemblePrompt = buildEnsemblerPrompt(payload.originalPrompt, sourceData);

    return new Promise((resolve) => {
      this.orchestrator.executeParallelFanout(ensemblePrompt, [payload.ensembleProvider], {
        sessionId: context.sessionId,
        useThinking: payload.useThinking,
        onPartial: (providerId, chunk) => {
          if (chunk && chunk.partial) {
            const delta = makeDelta(context.sessionId, providerId, chunk.text || "");
            if (delta) {
              this.port.postMessage({ 
                type: 'PARTIAL_RESULT', 
                sessionId: context.sessionId, 
                stepId: step.stepId, 
                providerId, 
                text: delta,
                partial: true 
              });
            }
          }
        },
        onAllComplete: (results) => {
            const finalResult = results.get(payload.ensembleProvider);
            this.sessionManager.updateProviderContext(context.sessionId, payload.ensembleProvider, finalResult, true, { skipSave: true });
            this.sessionManager.saveSession(context.sessionId);
            resolve(finalResult);
        }
      });
    });
  }
}