// ui/services/workflow-builder.ts
import { 
  WorkflowRequest, 
  WorkflowStep, 
  PromptStepPayload,
  SynthesisStepPayload,
  EnsembleStepPayload,
  ProviderKey,
  WorkflowContext,
  HistoricalStepReference
} from '../../shared/contract'; // Assumes shared/contract.ts is created from Step 5

export class WorkflowBuilder {
  private steps: WorkflowStep[] = [];
  private workflowId: string;
  private context: Omit<WorkflowContext, 'sessionId'> & { sessionId: string | null };

  constructor(context: Omit<WorkflowContext, 'sessionId'> & { sessionId: string | null }) {
    this.context = context;
    this.workflowId = `workflow-${Date.now()}`;
  }

  addBatchPrompt(
    prompt: string,
    providers: ProviderKey[],
    options?: {
      stepId?: string;
      hidden?: boolean;
      useThinking?: boolean;
      providerContexts?: Record<string, any>;
    }
  ): string {
    const stepId = options?.stepId || `batch-${this.steps.length}`;
    this.steps.push({
      stepId,
      type: 'prompt',
      payload: { prompt, providers, ...options } as PromptStepPayload
    });
    return stepId;
  }

  addSynthesis(
    synthesisProvider: ProviderKey,
    sourceStepIds: string[],
    originalPrompt: string,
    options?: { stepId?: string; useThinking?: boolean }
  ): string {
    const stepId = options?.stepId || `synthesis-${synthesisProvider}-${this.steps.length}`;
    this.steps.push({
      stepId,
      type: 'synthesis',
      payload: { synthesisProvider, sourceStepIds, originalPrompt, ...options } as SynthesisStepPayload
    });
    return stepId;
  }

  addSynthesisRerun(
    synthesisProvider: ProviderKey,
    historicalTurnId: string,
    originalPrompt: string,
    options?: { stepId?: string; useThinking?: boolean }
  ): string {
    const stepId = options?.stepId || `synthesis-rerun-${synthesisProvider}-${this.steps.length}`;
    this.steps.push({
      stepId,
      type: 'synthesis',
      payload: {
        synthesisProvider,
        sourceHistorical: { turnId: historicalTurnId, responseType: 'batch' },
        originalPrompt,
        ...options
      } as SynthesisStepPayload
    });
    return stepId;
  }
  
  addEnsembleRerun(
    ensembleProvider: ProviderKey,
    historicalTurnId: string,
    originalPrompt: string,
    options?: { stepId?: string; useThinking?: boolean }
  ): string {
    const stepId = options?.stepId || `ensemble-rerun-${ensembleProvider}-${this.steps.length}`;
    this.steps.push({
      stepId,
      type: 'ensemble',
      payload: {
        ensembleProvider,
        sourceHistorical: { turnId: historicalTurnId, responseType: 'batch' },
        originalPrompt,
        ...options
      } as EnsembleStepPayload
    });
    return stepId;
  }

  build(): WorkflowRequest {
    if (this.steps.length === 0) {
      throw new Error('Workflow must contain at least one step');
    }
    return {
      workflowId: this.workflowId,
      context: {
        sessionId: this.context.sessionId || 'new-session',
        targetUserTurnId: this.context.targetUserTurnId,
        uiTabId: this.context.uiTabId
      },
      steps: this.steps
    };
  }
}