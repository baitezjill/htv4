interface Provider {
  id: string;
  capabilities?: { synthesis: boolean };
  sendPrompt: (request: { reqId: string; originalPrompt: string; meta: Record<string, any> }, onPartial: (partial: { text?: string }) => void, signal: AbortSignal) => Promise<{ ok: boolean; id?: string; text?: string; tokensUsed?: number; errorCode?: string; meta?: Record<string, any> }>;
}

interface BatchOptions {
  includeProviderIds?: string[];
  globalTimeoutMs?: number;
  onPartial?: (providerId: string, partial: { text?: string }) => void;
  synthesis?: {
    only?: boolean;
    providerId: string;
    otherResults?: any[];
    promptTemplate?: (orig: string, outs: any[], selfId: string) => string;
    meta?: Record<string, any>;
  };
}

interface BatchResult {
  raw: Array<{ providerId: string; ok: boolean; id: string | null; text: string | null; partial: boolean; tokensUsed: number | null; latencyMs: number | null; errorCode: string | null; meta: Record<string, any> }>;
  synthesis: { providerId: string; ok: boolean; text: string | null; id: string | null; meta: Record<string, any>; errorCode: string | null } | null;
  timedOut: boolean;
}

declare class Orchestrator {
  constructor(providers?: Provider[], opts?: { perProviderTimeoutMs?: number; globalTimeoutMs?: number; maxProviders?: number; pickSynthesisProvider?: (results: any[]) => string | null }, lifecycle?: any, requestController?: { createAbortController: (id: string) => AbortController; abort: (id: string) => void; cleanup: (id: string) => void });
  providers: Map<string, Provider>;
  opts: { perProviderTimeoutMs: number; globalTimeoutMs: number; maxProviders: number; pickSynthesisProvider: (results: any[]) => string | null };
  lifecycle: any;
  requestController: any;
  registerProvider(adapter: Provider): void;
  unregisterProvider(providerId: string): void;
  listProviders(): Provider[];
  buildSynthesisPrompt(originalPrompt: string, otherResults: any[], selfProviderId: string, templateFn?: (orig: string, outs: any[], selfId: string) => string): string;
  withTimeout<T>(p: Promise<T>, ms: number, reqId?: string, controller?: AbortController): Promise<T>;
  batchPrompt(originalPrompt: string, opts?: BatchOptions): Promise<BatchResult>;
  onPartial?: (providerId: string, partial: { text?: string }) => void;
  onProviderComplete?: (providerId: string, result: any) => void;
  onSynthesisStart?: (providerId: string) => void;
  onSynthesisComplete?: (result: any) => void;
}

export { Orchestrator };