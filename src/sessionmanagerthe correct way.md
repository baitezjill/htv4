You are absolutely right to slam on the brakes here. My recommendation was too aggressive and overlooked the downstream consequences. I apologize. Your question exposes a critical dependency that we must handle with care.

You are correct. Those full-text responses in the providers object were almost certainly being used for two critical, non-obvious purposes:

Implicit Context for In-Flight Actions: As you suspected, when a user would click "Synthesize" on a past turn, the old synthesize handler likely used the providerContexts object (derived from session.providers) as the source material for the synthesis. It was the only place to easily get a snapshot of that turn's outputs.

State Hydration for continue: The getProviderContexts function, which populates the payload for a continue call, likely relied on the full text being present in session.providers for some provider adapters that might need more than just metadata.

Simply deleting the full text from session.providers without re-routing these dependencies would break both in-flight synthesis and potentially the continue functionality.

This is a classic "unseen dependency" problem in refactoring. Thank you for catching it.

The Correct, Surgical Refactoring Plan

We must not simply delete the text. We must migrate the dependency. The turns array is the correct source of truth, so any function that needs turn data must now be taught to read from it.

Here is the revised, safer plan for refactoring the SessionManager.

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

What This Achieves

This phased approach is much safer. It recognizes the hidden roles that the full text in session.providers was playing and systematically moves those responsibilities to the correct source of truth (session.turns) before cutting the cord.

Immediate Goal: Make all new and refactored logic read from session.turns.

Transition Goal: Ensure the existing continue logic doesn't have a hidden dependency on the full text in session.providers.

Final Goal: Once all dependencies are cut, remove the redundant storage of full text from session.providers, completing the simplification.

You were right. A "knock-on effect" was imminent. This plan defuses it by respecting the existing dependencies while carefully migrating them to the new, superior architecture.