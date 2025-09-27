/**
 * HTOS Lifecycle Manager
 * - Prevents background inactivity
 * - Provides heartbeat/keepalive for long-running tasks
 *
 * Build-phase safe: emitted to dist/core/*
 */

// Build-phase safe: emitted to dist/core/*
export class LifecycleManager {
  constructor(ping) {
    this.ping = ping;
    this.keepAlive = false;
    this.heartbeatTimer = null;
    this.heartbeatIntervalMs = 25000; // MV3 service worker idle timeout ~30s; ping before that
    this.isActive = false;
    this.IDLE_INTERVAL = 5 * 60 * 1000; // 5 minutes when idle
    this.ACTIVE_INTERVAL = 30 * 1000; // 30 seconds when active
    this.ALARM_NAME = 'htos-adaptive-heartbeat';
    // Listen for workflow events to adjust heartbeat
    this.setupWorkflowListeners();
  }

  setupWorkflowListeners() {
    // Listen for workflow start/end events to adjust heartbeat mode
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'workflow.start') {
          this.setActiveMode(true);
        } else if (message.type === 'workflow.end') {
          this.setActiveMode(false);
        }
      });
    }
  }

  setActiveMode(active) {
    if (this.isActive !== active) {
      this.isActive = active;
      const newInterval = active ? this.ACTIVE_INTERVAL : this.IDLE_INTERVAL;
      console.debug(`HTOS heartbeat mode: ${active ? 'ACTIVE' : 'IDLE'} (${newInterval}ms)`);
      // Restart heartbeat with new interval
      if (this.heartbeatTimer) {
        this.stopHeartbeat();
        this.startHeartbeat(newInterval);
      }
    }
  }

  // Build-phase safe: emitted to dist/core/*
  _preventBgInactive() {
    try {
      // Toggle keepAlive flag to signal observers that background should stay active
      this.keepAlive = true;
      // Start heartbeat if not running
      if (!this.heartbeatTimer) this.startHeartbeat();
    } catch {}
  }

  // Build-phase safe: emitted to dist/core/*
  startHeartbeat(intervalMs) {
    if (intervalMs && intervalMs > 0) this.heartbeatIntervalMs = intervalMs;
    if (this.heartbeatTimer) return; // idempotent
    // Use chrome.alarms for MV3 compatibility when available
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      this.startAlarmBasedHeartbeat();
    } else {
      this.startTimerBasedHeartbeat();
    }
  }

  startAlarmBasedHeartbeat() {
    // Clear any existing alarm
    chrome.alarms.clear(this.ALARM_NAME);
    // Set up alarm listener
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === this.ALARM_NAME) {
        this.executePing();
      }
    });
    // Create periodic alarm
    chrome.alarms.create(this.ALARM_NAME, {
      delayInMinutes: this.heartbeatIntervalMs / (1000 * 60),
      periodInMinutes: this.heartbeatIntervalMs / (1000 * 60)
    });
    this.heartbeatTimer = 1; // Mark as active
    // Execute immediately
    this.executePing();
  }

  startTimerBasedHeartbeat() {
    const tick = async () => {
      await this.executePing();
      // schedule next
      this.heartbeatTimer = setTimeout(tick, this.heartbeatIntervalMs);
    };
    // kick off immediately
    this.heartbeatTimer = setTimeout(tick, 0);
  }

  async executePing() {
    try {
      if (this.ping) {
        await this.ping();
      } else if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
        // Fallback: lightweight no-op message to ourselves to keep the SW alive
        chrome.runtime.sendMessage({ type: 'htos.keepalive' });
      }
    } catch (e) {
      console.warn('LifecycleManager ping failed', e);
    }
  }

  stopHeartbeat() {
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.clear(this.ALARM_NAME);
    } else if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
    }
    this.heartbeatTimer = null;
  }

  // Build-phase safe: emitted to dist/core/*
  keepalive(enable) {
    this.keepAlive = !!enable;
    if (enable) {
      if (!this.heartbeatTimer) this.startHeartbeat();
    } else {
      this.stopHeartbeat();
    }
  }
}
