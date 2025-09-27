import { useEffect } from 'react';

/**
 * Delegates wheel scrolling from inner scrollable provider panes to the outer list
 * when the inner reaches its top or bottom edge. Keeps the outer list the primary
 * scroll controller while preserving intuitive nested scroll behavior.
 */
export function useDelegatedScroll(outerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const outer = outerRef.current as HTMLElement | null;
    if (!outer) return;

    let rafId: number | null = null;

    const normalizeDelta = (e: WheelEvent) => {
      if (e.deltaMode === 1) return e.deltaY * 40; // lines -> pixels
      if (e.deltaMode === 2) return e.deltaY * 800; // pages -> pixels (approx)
      return e.deltaY; // already pixels
    };

    const handleWheel = (e: WheelEvent) => {
      // Only consider vertical intent
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      // Find the nearest explicitly marked inner scroll container
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const inner = target.closest('[data-provider-chat]') as HTMLElement | null;
      if (!inner) return; // Not inside a provider pane; let outer handle normally

      // If inner isn't actually scrollable, let outer handle
      if (inner.scrollHeight <= inner.clientHeight + 1) return;

      const atTop = inner.scrollTop <= 0;
      const maxScrollTop = inner.scrollHeight - inner.clientHeight;
      const atBottom = inner.scrollTop >= maxScrollTop - 1;

      // If we're not at an edge, do not intervene
      if (!(atTop || atBottom)) return;

      // Intercept and delegate to the outer scroller
      const deltaY = normalizeDelta(e);
      rafId = window.requestAnimationFrame(() => {
        try {
          e.preventDefault();
        } catch {}
        outer.scrollBy({ top: deltaY, behavior: 'auto' });
      });
    };

    outer.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      try { outer.removeEventListener('wheel', handleWheel as any); } catch {}
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [outerRef]);
}

