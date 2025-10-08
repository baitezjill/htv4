types refac.md
The Consolidation Plan: What to Safely Remove
Here is the step-by-step guide to cleaning up this file.
1. Delete the Entire "Message" Era:
Action: Delete the Message interface.
Action: Delete the LLMStreamData interface.
Action: Delete the convertLegacyMessageToTurn utility function. Its purpose is to migrate from the old model to the new one. Once you are fully on the new model, this migration utility becomes technical debt. (Keep it temporarily only if you have old, persisted chat data in chrome.storage that needs to be converted on load).
2. Delete Obsolete UI State Types:
Action: Delete the AppStep type ('initial' | 'awaitingSynthesis' | 'synthesis' | 'synthesisDone'). Your new, more granular UiPhase ('idle' | 'streaming' | 'awaiting_action') and the state of the workflow itself are much better ways to manage UI state. AppStep is a coarse and confusing relic.
Action: Delete the LaneProps, LanePosition, and RailCard types. These are clearly from a previous UI design ("lanes" and "rails") that is no longer in use.
3. Consolidate and Clean Up the AiTurn Interface:
The agent has given you a clean new AiTurn definition. You should use that as the new standard and remove the legacy fields from your old AiTurn definition.
Your current AiTurn has many deprecated fields: providerResponses, synthesisResponse, ensembleResponse, isHidden, isEnsembleAnswer, isSynthesisAnswer, meta.workflowStep.
The Goal: The AiTurn should only contain the new, clean containers: batchResponses, synthesisResponses, and ensembleResponses. The UI should derive everything else from the presence of data in these containers. (e.g., isSynthesisAnswer becomes Object.keys(aiTurn.synthesisResponses || {}).length > 0).
4. Consolidate Session Types:
You have HistorySessionSummary (for the history panel) and TurnBasedHistorySessionSummary (for the live session). These can be unified. A session is a session.
Action: Decide on a single Session type and use it everywhere. The TurnBasedHistorySessionSummary is the more modern and correct definition.
5. Clean Up Backend Types:
The types like BackendRound, FullSessionPayload, and BackendMessage are useful for describing the shape of API responses, but they should be clearly separated or even moved to the shared/contract.ts file if they are part of the formal contract between the UI and the backend. Keeping them in the main UI types.ts can be confusing. For now, just ensure they don't conflict.
The Result: A Lean, Modern types.ts
After this consolidation, your types.ts file will be dramatically shorter and simpler. It will primarily contain:
Core Turn-Based Model: UserTurn, the new clean AiTurn, ProviderResponse, TurnMessage.
Composer Model: All the Composer... and Slate... types.
UI State Primitives: UiPhase, ViewMode.
Provider/Session Definitions: A single Session type, LLMProvider.