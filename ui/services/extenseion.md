1. Delete the Entire ContextTracker Class.
Action: Remove the ContextTracker class and all the API methods that just wrap it (setSessionId, updateProviderContext, getSessionContexts, etc.).
Reasoning: State management belongs in your React components (App.tsx), not in your API service layer. App.tsx should be the single source of truth for all client-side state. When it needs to send context to the backend, it will pass it directly into the WorkflowRequest payload. This eliminates the "silo" and the risk of desynchronization.
2. Delete All Old Workflow Orchestration Methods.
Action: Delete executeBatchPrompt, executeBatchPromptWithSynthesis, executeSynthesis, executeEnsembler, and executeContinuationPrompt.
Reasoning: Their responsibility is now fully owned by the WorkflowBuilder (which constructs the recipe) and the new, single executeWorkflow method (which sends it). These old methods are the primary source of the file's complexity and are 100% obsolete in the new architecture.
3. Rename and Simplify dispatchWorkflow to executeWorkflow.
Action: You already have a dispatchWorkflow function that uses chrome.runtime.sendMessage. This is interesting. The new WorkflowEngine is designed to stream results back over a Port. Therefore, executeWorkflow should post its message over the Port, not use a fire-and-forget sendMessage.
The new executeWorkflow should look like this:
code
TypeScript
executeWorkflow(request: WorkflowRequest): void {
  // It uses the persistent Port for streaming communication
  const port = this.ensurePort();
  port.postMessage({
    type: 'EXECUTE_WORKFLOW',
    payload: request
  });
}
4. Keep the Data Fetching and Connection Management.
Action: The simple query methods (getHistoryList, getHistorySession, etc.) are still necessary and are correctly implemented using queryBackend. They should stay.
Action: The low-level port management functions (ensurePort, etc.) are also still necessary for establishing the communication channel. They should stay.
The Final, Refactored ExtensionApi Interface
After this refactor, your ExtensionApi interface will be dramatically smaller and cleaner. It will look like this:
code
TypeScript
export interface ExtensionApi {
  // --- Core Workflow Method ---
  executeWorkflow(request: WorkflowRequest): void;

  // --- Connection Management ---
  ensurePort(options?: ...): Promise<any>;
  setPortMessageHandler(handler: ((message: any) => void) | null): void; // A new, cleaner way to manage listeners

  // --- Simple Data Queries ---
  getHistoryList(): Promise<HistoryApiResponse>;
  getHistorySession(sessionId: string): Promise<HistorySessionSummary>;
  deleteBackgroundSession(sessionId: string): Promise<{ removed: boolean }>;

  // ... other simple query methods like chatgpt helpers ...
}