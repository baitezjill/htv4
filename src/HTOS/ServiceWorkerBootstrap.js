/**
 * HTOS Service Worker Bootstrap (extracted)
 * Initializes Bus, Net Rules, and Offscreen controllers with DNR-first ordering.
 * This file is intended to be used as the MV3 service worker entry.
 */

// Build-phase safe: emitted to dist/core/*

import { BusController } from './BusController.js';
import { NetRulesManager, CSPController, UserAgentController, ArkoseController } from './NetRulesManager.js';

const SWBootstrap = {
  _readyPromise: null,

  async init() {
    this._setupReadyPromise();

    // DNR-sync: Register Declarative Net Request rules before any other async work
    // 1) Init NetRulesManager (drops session rules + schedules cleanup)
    await NetRulesManager.init();

    // 2) Register CSP, UA/Lang, and Arkose iframe allowances
    //    Keep these at the top to ensure network-layer logic is applied immediately
    CSPController.init();
    await UserAgentController.init();
    await ArkoseController.init();

    // Note: Offscreen document lifecycle is managed separately via chrome.offscreen API
    // OffscreenBootstrap.init() is called directly in the offscreen document context

    // Now set up the Bus for background context
    await BusController.init();

    // Minimal keep-alive hint (MV3 SW will wake on events; we just log on startup)
    if (chrome?.runtime?.onStartup) {
      chrome.runtime.onStartup.addListener(() => {
        // No-op; presence keeps logic grouped for clarity
      });
    }

    this._resolveReadyPromise();
  },

  get onReady() {
    return this._readyPromise;
  },

  _setupReadyPromise() {
    let resolve;
    const p = new Promise((r) => (resolve = r));
    p.resolve = resolve;
    this._readyPromise = p;
  },

  _resolveReadyPromise() {
    this._readyPromise?.resolve?.();
  },
};

export { SWBootstrap };