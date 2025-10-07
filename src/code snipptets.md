// Message from UI to Backend
{
type: 'executeWorkflow',
payload: {
prompt: string;
providers: string[]; // e.g., ['gemini', 'claude', 'chatgpt']
sessionId?: string;
useThinking?: boolean;
code
Code
// The new 'services' configuration object
services: {
  batch: boolean; // Always true for a new prompt
  synthesis?: {
    provider: string; // The model to use for synthesis
  };
  ensemble?: {
    provider: string; // The model to use for ensemble
  };
}
}
}
// In your service-worker.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
// ...
if (request.type === 'executeWorkflow') {
const { prompt, providers, services, sessionId, useThinking } = request.payload;
code
Code
// Call a new, unified orchestrator function
handleNewWorkflow(prompt, providers, services, sessionId, useThinking);
return true; // Indicate async response
}
if (request.type === 'continue') {
// ... your existing continue logic ...
return true;
}
// ... your new specialist handlers for executeSynthesis/executeEnsemble ...
});
async function handleNewWorkflow(prompt, providers, services, sessionId, useThinking) {
// 1. Always run the hidden batch first.
const batchResults = await self.faultTolerantOrchestrator.executeParallelFanout(...);
// Create a list of subsequent tasks to run
const tasks = [];
if (services.synthesis) {
tasks.push(
runSynthesisStep(prompt, batchResults, services.synthesis.provider, sessionId)
);
}
if (services.ensemble) {
tasks.push(
runEnsembleStep(prompt, batchResults, services.ensemble.provider, sessionId)
);
}
// 2. Run the subsequent tasks (synthesis and ensemble) in parallel.
// This is an improvement! They don't need to be sequential if they both depend only on the batch results.
await Promise.all(tasks);
// 3. Send WORKFLOW_COMPLETE message.
port.postMessage({ type: 'WORKFLOW_COMPLETE', ... });
}
async function runSynthesisStep(...) { /* ... / }
async function runEnsembleStep(...) { / ... */ }
{
type: 'continue',
payload: {
prompt: string;
sessionId: string; // Mandatory for continue
providers: string[];
useThinking?: boolean;
code
Code
// The same composable services object
services: {
  batch: boolean; // Run the prompt against these providers with context
  synthesis?: {
    provider: string;
  };
  ensemble?: {
    provider: string;
  };
}
}
}
{
type: 'startWorkflow',
payload: {
prompt: string;
providers: string[];
// Optional sessionId if the user is starting a fan-out in an existing chat
sessionId?: string;
useThinking?: boolean;
services: { /* ... same composable object ... */ }
}
}
async function _executeWorkflow(prompt, providers, services, sessionId, withContext) {
  // 1. Run the batch step (no change here)
  const batchResults = await self.faultTolerantOrchestrator.executeFanout(...);
  
  // 2. Prepare subsequent tasks
  const tasks = [];

  // THIS LOGIC IS NOW MORE POWERFUL
  if (services.synthesis && services.synthesis.providers.length > 0) {
    // For each provider in the synthesis request, create a separate task
    for (const synthProvider of services.synthesis.providers) {
      tasks.push(
        runSynthesisStep(prompt, batchResults, synthProvider, sessionId)
      );
    }
  }
  
  if (services.ensemble) {
    tasks.push(
      runEnsembleStep(prompt, batchResults, services.ensemble.provider, sessionId)
    );
  }

  // 3. Run all tasks in parallel (no change here)
  // This will now naturally run multiple synthesis jobs concurrently if they were added to the tasks array.
  await Promise.all(tasks);

  // 4. Finalize
}

// Evolved message payload for `startWorkflow` and `continue`
{
  // ... prompt, providers, sessionId ...
  services: {
    batch: boolean;
    synthesis?: {
      // THIS IS THE CHANGE: from `provider: string` to `providers: string[]`
      providers: string[]; // e.g., ['gemini', 'claude']
    };
    ensemble?: {
      provider: string;
    };
  }
}