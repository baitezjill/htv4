export class Orchestrator {
  constructor(providers = [], opts, lifecycle, requestController) {
    this.providers = new Map();
    providers.forEach((p) => this.providers.set(p.id, p));
    this.opts = {
      perProviderTimeoutMs: opts?.perProviderTimeoutMs ?? 30000,
      globalTimeoutMs: opts?.globalTimeoutMs ?? 45000,
      maxProviders: opts?.maxProviders ?? 8,
      pickSynthesisProvider:
        opts?.pickSynthesisProvider ??
        ((results) => {
          // default: pick first provider flagged synthesis, else first ok provider
          const byFlag = results.find(
            (r) =>
              r.providerId &&
              this.providers.get(r.providerId)?.capabilities.synthesis
          );
          if (byFlag) return byFlag.providerId;
          const firstOk = results.find((r) => r.ok);
          return firstOk?.providerId ?? null;
        }),
    };
    this.lifecycle = lifecycle;
    this.requestController = requestController;
  }
  registerProvider(adapter) {
    this.providers.set(adapter.id, adapter);
  }
  unregisterProvider(providerId) {
    this.providers.delete(providerId);
  }
  listProviders() {
    return Array.from(this.providers.values());
  }
  // Forms the synthesis prompt using provided template or default
  buildSynthesisPrompt(
    originalPrompt,
    otherResults,
    selfProviderId,
    templateFn
  ) {
    const safeTemplate =
      templateFn ??
      ((orig, outs, selfId) => {
        const other = (outs || []).filter((r) => r.providerId !== selfId);
        const block = other
          .map((r) => `Response from ${r.providerId}:\n${r.text || ""}`)
          .join("\n\n---\n\n");
        return `you along with other models are responding to the user's  last prompt,  (see your last output) your task is to create the best possible response to the user's original prompt (the prompt before this) leveraging all available outputs, resources and insights.

Process:
1. Silently review all batch outputs below, including any response you may have contributed to this batch
2. Extract the strongest ideas, insights, solutions, and approaches from across all responses
3. Create a comprehensive, enhanced answer that represents the best collective intelligence available

Output Requirements:
- Respond directly to the user's original question with the synthesized answer
- Integrate the most valuable elements from all sources seamlessly
- Present as a unified, coherent response rather than comparative analysis
- Aim for higher quality and completeness than any individual response
- Do not analyze or compare the source outputs in your response

user original prompt:
"${orig}"

--- Other Model Outputs for Synthesis ---
${block}
--- End of Other Model Outputs ---

Begin Synthesis:`;
      });
    return safeTemplate(originalPrompt, otherResults, selfProviderId);
  }
  // Build-phase safe: emitted to dist/core/*
  async withTimeout(p, ms, reqId, controller) {
    if (ms <= 0) return p;
    let timer;
    const to = new Promise((_, rej) => {
      timer = setTimeout(() => {
        try {
          if (reqId && this.requestController) {
            // Previously aborted the controller here. Change to cleanup so the underlying
            // request is NOT aborted when a timeout occurs. This allows background
            // provider requests to continue and deliver late results.
            this.requestController.cleanup(reqId);
            console.warn(`[Orchestrator] withTimeout: request ${reqId} timed out (controller cleaned up, not aborted)`);
          } else {
            // Fallback: if no requestController provided, abort the direct controller.
            controller?.abort?.();
            console.warn('[Orchestrator] withTimeout: direct controller aborted due to timeout');
          }
        } catch (err) {
          console.warn('[Orchestrator] withTimeout cleanup failed', err);
        }
        rej(new Error("timeout"));
      }, ms);
    });
    try {
      return await Promise.race([p, to]);
    } finally {
      clearTimeout(timer);
    }
  }
  /**
   * batchPrompt: fan-out to configured providers in parallel and optionally synthesize
   */
  async batchPrompt(originalPrompt, opts) {
    // start keepalive for long-running batch
    this.lifecycle?._preventBgInactive?.();
    this.lifecycle?.startHeartbeat?.();
    // Notify lifecycle listeners that workflow started (adaptive heartbeat)
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        chrome.runtime.sendMessage({ type: 'workflow.start' });
      }
    } catch {}
    const included =
      opts?.includeProviderIds && opts.includeProviderIds.length > 0
        ? opts.includeProviderIds
        : Array.from(this.providers.keys()).slice(0, this.opts.maxProviders);
    const reqId = `htos-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const request = { reqId, originalPrompt, meta: {} };
    const perProviderPromises = opts?.synthesis?.only
      ? []
      : included.map(async (pid) => {
          const adapter = this.providers.get(pid);
          const providerReqId = `${reqId}-${pid}`;
          // Use requestController for abort controller creation
          const controller = this.requestController
            ? this.requestController.createAbortController(providerReqId)
            : new AbortController();
          const startedAt = Date.now();
          // collect aggregated chunks
          let aggregated = "";
          try {
            const meta = {
            ...(opts?.providerMeta && opts.providerMeta[pid] ? opts.providerMeta[pid] : {}),
            originalPrompt: originalPrompt // Include the original prompt in meta
          };
          
          const resultPromise = adapter.sendPrompt(
              { ...request, reqId: providerReqId, meta },
              (partial) => {
                // emit partial to UI
                opts?.onPartial?.(pid, partial);
                this.onPartial?.(pid, partial);
                // aggregate partial text if present
                if (partial.text) aggregated = aggregated + partial.text;
              },
              controller.signal
            );
            const res = await this.withTimeout(
              resultPromise,
              this.opts.perProviderTimeoutMs,
              providerReqId,
              controller
            );
            const latency = Date.now() - startedAt;
            const normalized = {
              providerId: pid,
              ok: res.ok,
              id: res.id ?? null,
              text: res.text ?? aggregated ?? null,
              partial: false,
              tokensUsed: res.tokensUsed ?? null,
              latencyMs: latency,
              errorCode: res.errorCode ?? null,
              meta: res.meta ?? {},
            };
            this.onProviderComplete?.(pid, normalized);
            // Cleanup request controller for completed request
            if (this.requestController) {
              this.requestController.cleanup(providerReqId);
            }
            return normalized;
          } catch (err) {
            const latency = Date.now() - startedAt;
            const normalized = {
              providerId: pid,
              ok: false,
              id: null,
              text: null,
              partial: false,
              latencyMs: latency,
              errorCode:
                err?.message === "timeout" ? "timeout" : err?.code ?? "unknown",
              meta: { _rawError: err?.toString?.() ?? String(err) },
            };
            this.onProviderComplete?.(pid, normalized);
            // Cleanup request controller for failed request
            if (this.requestController) {
              this.requestController.cleanup(providerReqId);
            }
            return normalized;
          }
        });
    // Wait for all providers but bounded by global timeout
    let settled = [];
    let timedOut = false;
    try {
      const globalMs = opts?.globalTimeoutMs ?? this.opts.globalTimeoutMs;
      if (perProviderPromises.length > 0) {
        const all = Promise.all(perProviderPromises);
        settled = await this.withTimeout(all, globalMs, undefined);
      }
    } catch (e) {
      // if global timeout happened, try to collect whatever finished
      timedOut = true;
      if (perProviderPromises.length > 0) {
        const results = await Promise.allSettled(perProviderPromises);
        settled = results.map((s, idx) => {
          if (s.status === "fulfilled") return s.value;
          // not fulfilled -> build timeout/failure result
          const pid = included[idx];
          return {
            providerId: pid,
            ok: false,
            id: null,
            text: null,
            partial: false,
            latencyMs: null,
            errorCode: "global_timeout",
            meta: { _rejection: String(s.reason) },
          };
        });
      } else {
        settled = [];
      }
    }
    // build synthesis prompt and call synthesis provider if requested
    let synthesisResult = null;
    if (opts?.synthesis) {
      const synthProviderId = opts.synthesis.providerId;
      const synthAdapter = this.providers.get(synthProviderId);
      if (!synthAdapter) {
        synthesisResult = {
          providerId: synthProviderId,
          ok: false,
          text: null,
          errorCode: "synthesis_provider_missing",
        };
      } else {
        this.onSynthesisStart?.(synthProviderId);
        const otherResults =
          opts.synthesis.otherResults &&
          Array.isArray(opts.synthesis.otherResults)
            ? opts.synthesis.otherResults
            : settled.filter((r) => r.providerId !== synthProviderId);
        const synthPrompt = this.buildSynthesisPrompt(
          originalPrompt,
          otherResults,
          synthProviderId,
          opts.synthesis.promptTemplate
        );
        // Use requestController for synthesis abort controller creation
        let synthReqId = `${reqId}-synth`;
        try {
          const synthController = this.requestController
            ? this.requestController.createAbortController(synthReqId)
            : new AbortController();
          const onChunk = (partial) => {
            try {
              opts?.onPartial?.(synthProviderId, partial);
              this.onPartial?.(synthProviderId, partial);
            } catch {}
          };
          const synthReq = {
            reqId: synthReqId,
            originalPrompt: synthPrompt,
            meta: opts?.synthesis?.meta ?? {},
          };
          const synthRes = await this.withTimeout(
            synthAdapter.sendPrompt(synthReq, onChunk, synthController.signal),
            this.opts.perProviderTimeoutMs * 1.5, // allow more time for synthesis
            synthReqId,
            synthController
          );
          synthesisResult = {
            providerId: synthProviderId,
            ok: synthRes.ok,
            text: synthRes.text ?? null,
            id: synthRes.id ?? null,
            meta: synthRes.meta ?? {},
            errorCode: synthRes.errorCode ?? null,
          };
          // Cleanup synthesis request controller
          if (this.requestController) {
            this.requestController.cleanup(synthReqId);
          }
        } catch (err) {
          synthesisResult = {
            providerId: synthProviderId,
            ok: false,
            text: null,
            errorCode:
              err?.message === "timeout"
                ? "timeout"
                : err?.code ?? "synthesis_failed",
            meta: { _rawError: String(err) },
          };
          // Cleanup synthesis request controller on error
          if (this.requestController) {
            this.requestController.cleanup(synthReqId);
          }
        }
        this.onSynthesisComplete?.(synthesisResult);
      }
    }
    // stop keepalive if you want
    // Note: LifecycleManager.keepalive(false) is available
    try {
      this.lifecycle?.keepalive?.(false);
    } catch {}
    // Notify lifecycle listeners that workflow ended
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        chrome.runtime.sendMessage({ type: 'workflow.end' });
      }
    } catch {}
    return { raw: settled, synthesis: synthesisResult, timedOut };
  }
}
