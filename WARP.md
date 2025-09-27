# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project summary
- MV3 Chrome extension (HTOS) with a service worker, a persistent offscreen document, and a content script. The extension orchestrates parallel provider calls (ChatGPT, Claude, Gemini), manages Declarative Net Request (DNR) rules up-front, and exposes a small React UI compiled into dist/ui.

Common commands
- Install dependencies (Windows PowerShell):
  ```bash path=null start=null
  npm ci   # prefer in CI
  # or
  npm install
  ```
- Build the extension (bundles SW, content script, offscreen, OI host, and UI into dist/):
  ```bash path=null start=null
  npm run build
  ```
- Continuous rebuild during development:
  ```bash path=null start=null
  npm run watch
  ```
- Clean build outputs:
  ```bash path=null start=null
  npm run clean
  ```
- Type-check the repo (no linter configured; use TS type-checking):
  ```bash path=null start=null
  npx tsc -p tsconfig.json --noEmit
  ```
- Tests (Jest scaffold present; no tests found yet). Run, watch, and coverage:
  ```bash path=null start=null
  npm test
  npm run test:watch
  npm run test:coverage
  ```
- Run a single test file or test name pattern:
  ```bash path=null start=null
  npx jest path/to/file.test.ts
  npx jest -t "partial test name"
  ```

Load the extension in Chrome (dev)
- After build, load the dist/ folder as an unpacked extension:
  - Open chrome://extensions
  - Enable Developer mode
  - Load unpacked → select the dist directory
- The service worker (dist/bg.js) will create a persistent offscreen document (dist/offscreen.html). The content script (dist/cs-openai.js) runs on openai.com domains.
- The UI is built to dist/ui/index.html (not wired as a default_popup). You can open it directly via the extension’s “Details” → “View in Chrome Web Store” link replacement or by navigating to chrome-extension://<EXT_ID>/ui/index.html.

High-level architecture (big picture)
1) Build and outputs (esbuild)
- One esbuild command per entry:
  - src/sw-entry.js → dist/bg.js (IIFE)
  - src/cs-openai.js → dist/cs-openai.js (IIFE)
  - src/offscreen-entry.js → dist/offscreen.js (ESM)
  - src/oi.js → dist/oi.js (IIFE)
  - ui/index.tsx (+ React code) → dist/ui/index.js (ESM)
- postbuild copies manifest.json, HTML/CSS, and icons into dist/ and patches ui/index.html to load index.js.

2) Execution contexts and message bus
- BusController (src/HTOS/BusController.js) abstracts messaging across contexts:
  - bg (service worker), cs (content scripts), os (offscreen), oi (offscreen iframe), pp (popup), fg/nj (injected/page variants).
  - Uses chrome.runtime messaging and a BroadcastChannel (htos-bus-channel) for blob marshalling between bg and offscreen.
  - Provides on/off/once/send/call/poll with proxying for content-script handlers per tab. The service worker cleans up tab-bound proxies on tab removal.

3) Service worker responsibilities (src/sw-entry.js)
- Initializes BusController and ensures a single persistent offscreen document (chrome.offscreen.createDocument) via the OffscreenController.
- Hosts a ParallelEventRouter that multiplexes messages to active UI ports and coordinates parallel provider execution.
- Maintains a SessionManager that persists per-session provider contexts (conversation IDs, cursors, etc.) in chrome.storage.local for reliable continuation/synthesis workflows.
- Registers providers (controllers + adapters) and executes fan-out via a FaultTolerantOrchestrator with streaming partials, per-provider and global timeouts, and graceful abort/cleanup.
- The preferred DNR-first bootstrap is encapsulated in HTOS/ServiceWorkerBootstrap.js (NetRulesManager.init → CSP/UserAgent/Arkose controllers). Keep this at the top of SW startup when wiring boot.

4) Offscreen document (src/offscreen-entry.js, src/HTOS/OffscreenBootstrap.js)
- OffscreenBootstrap initializes:
  - IframeController: manages a hidden oi.html iframe, polls startup.oiReady, and restarts it on non-responsiveness (self-healing).
  - UtilsController: exposes chrome.storage-backed localStorage-like helpers to the SW over the bus (get/set/has/remove).
- Bus discovery allows alternative global bus shims but defaults to BusController; the offscreen window assigns window.bus.

5) OI host and Arkose pipeline
- The offscreen document embeds oi.html (manifest web_accessible_resources) to host Arkose/PoW work and JS patches. The bus is used for readiness polling and for token/proof requests from providers.

6) Declarative Net Request (DNR) and network control (src/core and src/HTOS)
- NetRulesManager (src/HTOS/NetRulesManager.js): thin layer over chrome.declarativeNetRequest with:
  - Session rule reset on init, periodic cleanup of tab-scoped rules, and helpers to register/unregister batches by key.
  - CSPController: removes CSP headers where configured (example rule in code), with replaceable policy.
  - UserAgentController: header rules for UA and Accept-Language via URL hints (e.g., _vua=desktop, _vlang=en-US).
- DNRUtils (src/core/dnr-utils.js): higher-level utilities for:
  - Tab-scoped and temporary header rules, auto-expiration, storage-backed persistence, and rule match debugging via onRuleMatchedDebug.
  - ProviderDNRGate: per-provider prerequisite rules (e.g., allow iframes/CSP relaxations for claude/gemini) that are activated before requests and cleaned up after.

7) Providers and orchestration
- Provider controllers (e.g., src/providers/chatgpt.js) handle provider-specific flows (Arkose/PoW configuration, continuation IDs, access tokens via bus-accessible sources) and expose a thin API.
- Provider adapters (e.g., src/providers/chatgpt-adapter.js) implement a uniform sendPrompt/sendContinuation contract used by the orchestrator and support streaming partials and a “Thinking” mode backed by the think/ pipeline.
- Orchestrator (src/orchestrator/orchestrator.js) fans out prompts concurrently, aggregates partials, normalizes results, and optionally performs synthesis using a selected provider. Timeouts are enforced per-provider and globally; aborts are wired through a HTOSRequestLifecycleManager (src/core/request-lifecycle-manager.js).

8) UI (dist/ui)
- React SPA compiled to dist/ui/index.html + index.js; it connects to the background via a persistent Port (name: htos-popup) using ui/services/extension-api.ts.
- The UI can stream provider partials, trigger synthesis/ensemble phases, and persists UI state to chrome.storage.local (via ui/services/persistence.ts). It sets the extension ID at runtime (api.setExtensionId(chrome.runtime.id)).

Operating guardrails (HTOS mandate)
- DNR First: Register declarativeNetRequest rules synchronously at SW startup before any await or offscreen/iframe creation.
- No tokens in content scripts: do not store or shuttle sensitive tokens in content-scripts; use indirect references and background/offscreen bridges.
- Singleton offscreen: exactly one offscreen document per session; recreate only on ping failure.
- Manifest V3 only: avoid webRequest/background.html patterns.
- Naming: no harpa/HARPA; use htos- prefixes where global or DOM IDs require it.

Where to make common changes
- Add/modify providers: pair a provider controller (src/providers/<name>.js) with a provider adapter (src/providers/<name>-adapter.js) and register them in the SW registry. Use ProviderDNRGate if the provider needs DNR preconditions.
- Network behavior: Prefer DNRUtils/NetRulesManager for header edits, CSP relaxations, and per-tab scoping. Use session rules for temporary/ephemeral changes.
- Offscreen/OI fixes: adjust OffscreenBootstrap or the oi.html flow. Keep the ping/restart loop intact for reliability and avoid multiple offscreen documents.
- UI work: edit files under ui/, rebuild, and reload the unpacked extension. The UI communicates exclusively via the persistent Port; ensure api.ensurePort/createPort paths remain stable.

Notes and caveats
- The repo includes Jest and ts-jest dependencies but no test files were found in the tree. Add tests under any standard pattern (e.g., **/*.test.ts) to activate the test scripts.
- The UI imports some types/helpers from a shared/ namespace in ui/tsconfig paths; ensure those references exist or remove the imports if you trim that dependency.
