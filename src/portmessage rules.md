This is a master-level question. You have pinpointed one of the most confusing and error-prone aspects of Chrome extension architecture. The distinction between chrome.runtime.onConnect (Ports) and chrome.runtime.onMessage (Runtime Messages) is subtle, and misunderstanding it is the direct cause of the "missed or mismatched" calls you've experienced.

Let's clarify the strict roles of each, why your system is using both, and how to architect it correctly to eliminate these issues.

The Fundamental Difference: A Phone Call vs. a Text Message

This is the most effective mental model:

chrome.runtime.onMessage (Runtime Messages): This is like sending a Text Message (SMS).

Stateless & Transactional: You send a single message and (optionally) get a single response back. The connection is opened for that one transaction and then immediately closed.

No Persistent Channel: There is no concept of an "open line." Every message is a new, independent event.

Good For: One-off commands, simple requests for data, or firing events where you don't need a persistent conversation. Examples: "get me the user's settings," "what is your current status?," "log this event."

chrome.runtime.onConnect (Ports): This is like making a Phone Call.

Stateful & Conversational: You open a persistent, two-way channel between two parts of your extension. This channel stays open until one side explicitly hangs up (port.disconnect()) or the context is destroyed (e.g., the popup closes).

Named & Identifiable: You can give ports names, allowing the service worker to know who is calling (e.g., "htos-popup").

Reliable Disconnect Event: The port.onDisconnect event is a reliable way to know when the other side has gone away. This is crucial for cleanup.

Good For: Streaming data, long-running tasks, or any situation where you need a continuous, back-and-forth conversation. This is the perfect tool for your AI responses.

Why Your System Has (and Needs) Both

Your application has two distinct communication needs, which map perfectly to these two APIs.

The Need for Streaming (Requires a Port):

Your AI providers generate text in chunks. To create the "live typing" effect in the UI, you need to stream these chunks from the service worker to the UI as they arrive.

A runtime message is terrible for this. You would have to send hundreds of separate "text messages," which is inefficient and has no guarantee of order.

A Port is the only correct tool for this job. It's the "open phone line" over which the service worker can continuously whisper new words to the UI until the response is complete.

Strict Rule: All streaming data must be sent over a Port.

The Need for One-Off Commands from Other Contexts (Requires Runtime Messages):

Your extension has other parts besides the main UI. You might have a content script, an options page, or even other extensions that need to send a simple command to your service worker.

These contexts don't need a persistent "phone call." They just want to fire a single "text message" and get a quick reply.

This is where chrome.runtime.onMessage is perfect. Your GET_FULL_HISTORY and GET_SYSTEM_STATUS handlers are excellent examples. The UI sends a single request, the service worker looks up the data, sends a single response, and the transaction is over.

The Source of Your Past Problems: Mismatched Channels

The "missed or mismatched calls" you experienced happen when this separation of concerns is violated.

Common Mistake 1 (The "Shouting into the Void"): The UI tries to send a streaming update over a chrome.runtime.sendMessage call. The service worker receives it, but has no persistent channel to talk back to. It might try to send its own sendMessage back, but the UI might not be listening at that exact moment. The message is lost.

Common Mistake 2 (The "Crossed Wires"): The service worker receives a command over a Port from the main UI. It then tries to respond by sending a generic chrome.runtime.sendMessage instead of using the specific port.postMessage() for that connection. The message goes out to all listeners, or to none, but not specifically to the UI that made the original request.

The Correct, Refactored Architecture

Here is the strict set of rules to give your agent to eliminate these issues forever.

Rule 1: The UI Popup Establishes the "Main Line."

When the main UI (App.tsx) mounts, its very first job is to establish a long-lived Port connection to the service worker: chrome.runtime.connect({ name: 'htos-popup' }).

This port object is the primary and preferred channel for all communication related to the active user session.

Rule 2: All Workflow and Streaming Communication MUST Use the Port.

All your new primary message types (startWorkflow, continue, executeSynthesis, executeEnsemble) should be sent from the UI to the service worker over the Port: port.postMessage({ type: 'startWorkflow', ... }).

The service worker's port.onMessage listener will handle these requests.

Critically, all responses from the backend related to these workflows—partial streaming chunks, completion events, error messages—must be sent back to the UI using that specific port instance: port.postMessage({ type: 'SYNTHESIS_PARTIAL', ... }).

This creates a clean, encapsulated "phone call" for the entire duration of the UI's lifecycle.

Rule 3: chrome.runtime.onMessage is for External, One-Off Requests ONLY.

The service worker's chrome.runtime.onMessage listener should only contain handlers for simple, transactional requests that could come from any part of the extension, not just the main UI.

The handlers you already have (GET_FULL_HISTORY, GET_HISTORY_SESSION, GET_SYSTEM_STATUS) are perfect examples. They should remain exactly where they are.

This listener should never be used to handle complex, streaming workflows.

Does gemini doesnt stream matter?
No. From an architectural perspective, it doesn't matter if a provider streams or returns its full response at once. For consistency, all provider responses should be sent over the Port. For Gemini, you'll simply get one port.postMessage with the full text and partial: false, whereas for Claude, you'll get many messages with partial: true followed by one final message. The communication channel remains the same, which simplifies your UI logic immensely.

By enforcing this strict separation of concerns, you create a system that is predictable, robust, and free from the race conditions and "crossed wires" that plagued your previous implementation.