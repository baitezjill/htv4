// ui/services/persistence.ts
// Lightweight persistence service for HTOS UI state

// Storage key prefixes
const STORAGE_KEYS = {
  SCROLL_POSITION: 'htos_scroll_position',
  APP_STATE: 'htos_app_state'
} as const;

// Interface for scroll position state
interface ScrollState {
  position: number;
  sessionId: string | null;
  timestamp: number;
}

// Interface for app state persistence
interface AppState {
  currentSessionId: string | null;
  selectedModels: Record<string, boolean>;
  isHistoryPanelOpen: boolean;
  timestamp: number;
}

/**
 * Lightweight persistence service for HTOS UI state
 * Handles scroll position and app state persistence
 */
class PersistenceService {
  private static instance: PersistenceService;
  private isExtensionContext: boolean;
  private pendingSaves: Array<Promise<void>> = [];

  /**
   * Wait for all pending saves to complete
   */
  public async flush(): Promise<void> {
    await Promise.allSettled(this.pendingSaves);
    this.pendingSaves = [];
  }

  private constructor() {
    this.isExtensionContext = Boolean(
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local
    );
  }

  private async storageSet(obj: Record<string, any>): Promise<void> {
    if (this.isExtensionContext) {
      await chrome.storage.local.set(obj);
      return;
    }
    try {
      Object.entries(obj).forEach(([k, v]) => {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
      });
    } catch {}
  }

  private async storageGet(keys: null | string | string[]): Promise<Record<string, any>> {
    if (this.isExtensionContext) {
      // @ts-ignore chrome exists at runtime in extension
      return await chrome.storage.local.get(keys as any);
    }
    const out: Record<string, any> = {};
    try {
      if (keys === null) {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)!;
          try { out[k] = JSON.parse(localStorage.getItem(k) || 'null'); } 
          catch { out[k] = localStorage.getItem(k); }
        }
      } else if (typeof keys === 'string') {
        try { out[keys] = JSON.parse(localStorage.getItem(keys) || 'null'); } 
        catch { out[keys] = localStorage.getItem(keys); }
      } else if (Array.isArray(keys)) {
        keys.forEach(k => {
          try { out[k] = JSON.parse(localStorage.getItem(k) || 'null'); } 
          catch { out[k] = localStorage.getItem(k); }
        });
      }
    } catch {}
    return out;
  }

  private async storageRemove(keys: string | string[]): Promise<void> {
    if (this.isExtensionContext) {
      // @ts-ignore chrome exists at runtime in extension
      await chrome.storage.local.remove(keys as any);
      return;
    }
    const arr = Array.isArray(keys) ? keys : [keys];
    try { 
      arr.forEach(k => { 
        try { localStorage.removeItem(k); } catch {} 
      }); 
    } catch {}
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): PersistenceService {
    if (!PersistenceService.instance) {
      PersistenceService.instance = new PersistenceService();
    }
    return PersistenceService.instance;
  }

  /**
   * Save scroll position for a session
   */
  async saveScrollPosition(position: number, sessionId: string | null): Promise<void> {
    const scrollState: ScrollState = {
      position,
      sessionId,
      timestamp: Date.now()
    };
    await this.storageSet({ [STORAGE_KEYS.SCROLL_POSITION]: scrollState });
  }

  /**
   * Load saved scroll position
   */
  async loadScrollPosition(): Promise<ScrollState | null> {
    const result = await this.storageGet(STORAGE_KEYS.SCROLL_POSITION);
    return result[STORAGE_KEYS.SCROLL_POSITION] || null;
  }

  /**
   * Save app state
   */
  async saveAppState(state: Partial<AppState>): Promise<void> {
    const currentState = await this.loadAppState();
    const newState = {
      ...currentState,
      ...state,
      timestamp: Date.now()
    };
    await this.storageSet({ [STORAGE_KEYS.APP_STATE]: newState });
  }

  /**
   * Load app state
   */
  async loadAppState(): Promise<AppState> {
    const result = await this.storageGet(STORAGE_KEYS.APP_STATE);
    return result[STORAGE_KEYS.APP_STATE] || {
      currentSessionId: null,
      selectedModels: {},
      isHistoryPanelOpen: false,
      timestamp: 0
    };
  }

  /**
   * Clear all persisted data
   */
  async clearAllData(): Promise<void> {
    await this.storageRemove([
      STORAGE_KEYS.APP_STATE,
      STORAGE_KEYS.SCROLL_POSITION
    ]);
  }

  /**
   * Clear legacy data (for cleanup)
   */
  async clearLegacyHistory(): Promise<void> {
    try {
      // Clean up any legacy storage keys
      const allData = await this.storageGet(null);
      const legacyKeys = Object.keys(allData).filter(key => 
        key.startsWith('htos_turn_') || 
        key.startsWith('htos_session_') ||
        key === 'htos_chat_list'
      );
      
      if (legacyKeys.length > 0) {
        await this.storageRemove(legacyKeys);
      }
    } catch (error) {
      console.error('Error clearing legacy history:', error);
    }
  }
}

// Export singleton instance
export const persistenceService = PersistenceService.getInstance();
export default persistenceService;
