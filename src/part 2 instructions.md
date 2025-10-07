Phase 2: Deprecate and Remove Obsolete Code (The Cleanup)
This is where the previous instructions are integrated. This new model makes the old handlers obsolete.
Delete Old Top-Level Handlers:
The old sendPrompt, sendPromptWithSynthesis, synthesize, and ensemble_finalize message handlers are now fully replaced by the new startWorkflow and continue handlers. Delete them entirely.
The old buildSynthesisPrompt helper function is also now dead code and should be deleted.
Simplify SessionManager:
The turns array is now the single source of truth for conversational history.
Action: Remove the contextHistory property and all logic that writes to it.
Action: Refactor the providers property. Its sole purpose should be to store the minimal metadata required for continuation (e.g., conversationId, parentMessageId). It should no longer store the full text of responses. The updateProviderContext method should be simplified to only manage this metadata. All full-text results are saved exclusively in the turns array.

The New Rule: SessionManager's Split Personality

The SessionManager needs to have two clear, distinct responsibilities:

Turn Management (The Archive): Managing the turns array. This is the official, immutable history of the conversation.

Continuation Context Management (The Short-Term Memory): Managing the minimal metadata needed for the next conversational turn (conversationId, parentMessageId, etc.).

Revised Action Plan for SessionManager

Do NOT Delete Full Text Immediately. We will do this in a later step once we've re-routed the dependencies.

First, Make turns the Source of Truth for Actions.

Modify the Specialist Handlers (executeSynthesis, executeEnsemble): When you create these new backend handlers for in-flight actions, their contract must change.

Old (Implicit) Way: The UI sends a turnId. The backend handler looks up session.providers to get the source texts.

New (Explicit) Way: The UI sends a turnId. The backend handler MUST find the corresponding turn in the session.turns array and extract the batchResponses from that specific turn object. This is now the only valid source for in-flight action inputs.

Refactor getProviderContexts and updateProviderContext:

The goal is to slowly starve the old providers object of its responsibility.

updateProviderContext should still save the continuation metadata it receives. It can continue to save the full text for now to avoid breaking anything.

getProviderContexts should continue to return the metadata.

The crucial change is ensuring that the main _executeWorkflow's continue path relies only on the metadata from getProviderContexts and does not implicitly depend on the full text being there. You must audit your provider adapters (ClaudeAdapter, GeminiAdapter, etc.) to confirm that their sendContinuation methods only require the meta object and not the previous text. If they do require the text, that dependency must also be re-routed to fetch the last message from the turns array.

Final Cleanup Step (After All Dependencies are Re-routed):

Once you can prove that:

The new executeSynthesis/executeEnsemble handlers read only from session.turns.

The continue workflow reads only the necessary metadata for continuation (or explicitly fetches the last turn's text from session.turns if needed).

NOW you can safely modify updateProviderContext to stop saving the full text to the session.providers object.

You can then remove the text property from that part of the data model entirely.


Immediate Goal: Make all new and refactored logic read from session.turns.

Transition Goal: Ensure the existing continue logic doesn't have a hidden dependency on the full text in session.providers.

Final Goal: Once all dependencies are cut, remove the redundant storage of full text from session.providers, completing the simplification.

Unify Orchestrator Usage:
All calls to AI providers must go through the high-level FaultTolerantOrchestrator to ensure consistent lifecycle management, error handling, and callbacks.
Action: Search the codebase for any direct calls to self.orchestrator (the lower-level class). Refactor these to use an equivalent method on self.faultTolerantOrchestrator. If a method for running a single, specific request doesn't exist on FaultTolerantOrchestrator, create one (e.g., executeSingleRequest). This is critical for the synthesis and ensemble steps inside _executeWorkflow.
Re-evaluate and Simplify Complex Features:
Review the _sessionTimeoutTimers logic. With the new, more robust SessionManager, consider replacing this complex timer-based system with a simpler model where the UI, upon reconnecting, simply fetches the complete, up-to-date session state from the backend.
Phase 3: Implement New Specialist Endpoints for In-Flight Actions
Create executeSynthesis and executeEnsemble handlers:
These are for the "Clips Track" UI to act on past turns. They are much simpler than the main workflow.
executeSynthesis will receive a turnId (or the batchResults directly), a target providerId, and the original prompt. It will perform only a synthesis and stream the result back.
executeEnsemble will do the same for an ensemble task.
These handlers MUST also include the correct responseType in their return messages.

Required Action 2: No Immediate API Deletion Needed.

What: You do not need to delete the executeContinuationPrompt endpoint on the backend yet. The API endpoints (executeBatchPrompt, executeContinuationPrompt, executeSynthesis) are currently fit for purpose.

Why: The problem we are solving in the next phase is the frontend's rigid and confusing logic for calling these APIs. We will fix that on the client side first. This de-risks the refactor by not requiring simultaneous frontend and backend changes.

Phase 2: Frontend Logic Unification (The Simplification)

Goal: To remove the confusing and rigid isContinuationMode state and replace it with a single, unified, user-driven interaction model in App.tsx.

Required Action 1: Eliminate isContinuationMode State.

What: Delete the const [isContinuationMode, setIsContinuationMode] = useState(false); line and remove all references to it.

Why: This removes the one-way gate that locks users into a specific workflow and is the primary source of the architectural complexity.

Required Action 2: Introduce a User-Controlled sendMode State.

What: Create a new state variable: const [sendMode, setSendMode] = useState<'fan-out' | 'chat'>('fan-out');.

Why: This state represents the user's explicit intent for their next message, giving them full control.

Required Action 3: Create a Single handleSendMessage Handler.

What: Create a new, unified handler in App.tsx that will be the single entry point for the ChatInput. This function will contain the routing logic:

code
TypeScript
download
content_copy
expand_less
const handleSendMessage = useCallback(async (prompt: string) => {
  if (sendMode === 'fan-out' || messages.length === 0) {
    await handleSendPrompt(prompt); // Calls the context-free orchestrator
  } else {
    await handleContinuation(prompt); // Calls the context-aware handler
  }
  if (messages.length < 2) { // Intelligently switch to chat mode after first prompt
    setSendMode('chat');
  }
}, [sendMode, messages.length, handleSendPrompt, handleContinuation]);

Why: This centralizes the decision-making logic and provides a single, clean interface to the ChatInput component.

Required Action 4: Update the ChatInput Component.

What: Modify ChatInput.tsx to remove the onSendPrompt and onContinuation props. It should now accept onSendMessage, sendMode, and onSetSendMode. It will render a toggle button (e.g., "⚡️ Fan-Out" / "💬 Chat") that controls the sendMode state and its main send button will now always call onSendMessage.

Why: This connects the new, simplified logic to the user interface.

Phase 3: Frontend UI Implementation (The "Clips Track" AiTurnBlock)

Goal: To build the new, interactive UI within the AiTurnBlock that allows users to view and generate multiple "takes" for synthesis and ensemble.

Required Action 1: Implement the "Clips Track" UI in AiTurnBlock.tsx.

What: Inside the AiTurnBlock, above the content area for Synthesis (and separately for Ensemble), create a horizontal "track."

This track will render a "clip" button for each potential provider (gemini, claude, chatgpt).

A clip for an existing take will be active and selectable (e.g., a solid button labeled "Gemini #1"). Clicking it shows that take's content.

A clip for an ungenerated take will be a placeholder (e.g., an outlined button labeled "[+] Claude").

Why: This provides the intuitive, "director's studio" interface for managing multiple creative options within a single turn.

Required Action 2: Wire Up the Clip Actions.

What: Clicking a placeholder clip (e.g., "[+] Claude") must trigger the appropriate handler (handleRunSynthesisForRound or handleRunEnsembleForRound), passing the userTurnId and the new providerId ('claude').

The placeholder should immediately turn into a "loading" state clip for instant user feedback.

Why: This connects the new UI directly to the existing, powerful backend APIs for generating new takes.

Required Action 3: Implement Smart Truncation and Accordion Logic.

What: Apply max-height with a fade-out gradient to the content display areas. Add a "Show More" button to expand them. Ensure that expanding one content area collapses others.

Why: This manages information density, prevents overwhelming "walls of text," and keeps the user focused, fulfilling the core requirements of a clean cognitive workspace.