Excellent. You have perfectly synthesized our entire discussion into a clear, actionable plan. Your summary is exactly right.

Let's formalize this into a precise roadmap. You are correct that the work splits cleanly into three phases:

Backend Enhancement: Providing the necessary signals.

Frontend Logic Unification: Simplifying the core application state and flow.

Frontend UI Implementation: Building the new, powerful AiTurnBlock.

Here is the detailed breakdown of that plan.

Phase 1: Backend Update (The Foundation)

Goal: To make the backend's communication with the UI explicit and unambiguous, which is the prerequisite for a reliable frontend.

Required Action 1: Add Explicit responseType to All Streaming Messages.

What: Every single message packet sent from the backend to the UI (via the port/websocket) that contains a piece of an AI response must include a responseType field.

Where: This needs to be implemented in the backend services that generate the batch, synthesis, and ensemble responses.

Values: The value must be one of 'batch', 'synthesis', or 'ensemble'.

Why: This is the most critical change. It eliminates all guesswork on the frontend, prevents data from being put in the wrong container, and makes the system immune to race conditions where messages arrive out of order.

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