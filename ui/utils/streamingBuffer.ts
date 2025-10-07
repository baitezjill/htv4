/**
 * StreamingBuffer: Batches streaming text updates using requestAnimationFrame
 * to eliminate jank and ensure smooth 60fps rendering during AI text streaming.
 * 
 * Instead of updating UI state on every delta, we collect all deltas in a buffer
 * and apply them once per frame, right before the browser paints.
 */

type ResponseType = 'batch' | 'synthesis' | 'ensemble';
type UpdateCallback = (providerId: string, text: string, status: string, responseType: ResponseType) => void;

interface BufferedUpdate {
  providerId: string;
  delta: string;
  status: string;
  responseType: ResponseType;
}

export class StreamingBuffer {
  private buffer: Map<string, BufferedUpdate> = new Map();
  private rafId: number | null = null;
  private updateCallback: UpdateCallback;

  constructor(updateCallback: UpdateCallback) {
    this.updateCallback = updateCallback;
  }

  /**
   * Add a text delta to the buffer for a specific provider.
   * Multiple deltas for the same provider are concatenated.
   */
  addDelta(providerId: string, delta: string, status: string = 'streaming', responseType: ResponseType): void {
    const existing = this.buffer.get(providerId);
    
    if (existing) {
      // Concatenate new delta with existing buffered text
      existing.delta += delta;
      existing.status = status;
      existing.responseType = responseType;
    } else {
      this.buffer.set(providerId, { providerId, delta, status, responseType });
    }

    // Schedule a flush if not already scheduled
    if (this.rafId === null) {
      this.scheduleFlush();
    }
  }

  /**
   * Set complete text for a provider (non-incremental update)
   */
  setComplete(providerId: string, text: string, status: string = 'completed', responseType: ResponseType): void {
    this.buffer.set(providerId, { providerId, delta: text, status, responseType });
    
    if (this.rafId === null) {
      this.scheduleFlush();
    }
  }

  /**
   * Schedule a flush on the next animation frame
   */
  private scheduleFlush(): void {
    this.rafId = requestAnimationFrame(() => {
      this.flush();
    });
  }

  /**
   * Apply all buffered updates in a single batch
   */
  private flush(): void {
    if (this.buffer.size === 0) {
      this.rafId = null;
      return;
    }

    // Apply all updates in one go
    this.buffer.forEach((update) => {
      this.updateCallback(update.providerId, update.delta, update.status, update.responseType);
    });

    // Clear buffer and reset RAF ID
    this.buffer.clear();
    this.rafId = null;
  }

  /**
   * Force an immediate flush (useful for completion/error states)
   */
  flushImmediate(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.flush();
  }

  /**
   * Clean up (cancel any pending RAF)
   */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.buffer.clear();
  }
}
