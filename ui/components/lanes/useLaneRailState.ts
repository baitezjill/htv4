import { useMemo, useRef, useState, useCallback } from 'react';

export interface LaneRailState {
  mainIds: string[];
  railIds: string[];
  // LRU of visible main lanes (least-recently-used at index 0)
  lru: string[];
  clickMain: (providerId: string) => void; // promotes to MRU
  swapInFromRail: (providerId: string) => void; // swap clicked rail id with LRU main id
}

export function useLaneRailState(allProviderIds: string[], visibleCount = 3): LaneRailState {
  // Keep order deterministic based on passed list
  const initialMain = useMemo(() => allProviderIds.slice(0, visibleCount), [allProviderIds, visibleCount]);
  const initialRail = useMemo(() => allProviderIds.slice(visibleCount), [allProviderIds, visibleCount]);

  const [mainIds, setMainIds] = useState<string[]>(initialMain);
  const [railIds, setRailIds] = useState<string[]>(initialRail);
  const lruRef = useRef<string[]>([...initialMain]);

  const clickMain = useCallback((providerId: string) => {
    // Promote clicked to MRU
    lruRef.current = [...lruRef.current.filter(id => id !== providerId), providerId];
  }, []);

  const swapInFromRail = useCallback((providerId: string) => {
    if (!railIds.includes(providerId) || mainIds.length === 0) return;
    const evictId = lruRef.current[0];
    if (!evictId) return;

    // Replace in main
    const newMain = mainIds.map(id => (id === evictId ? providerId : id));
    // Replace in rail
    const newRail = railIds.map(id => (id === providerId ? evictId : id));

    setMainIds(newMain);
    setRailIds(newRail);

    // Update LRU: remove both ids and push the incoming as MRU
    const rest = lruRef.current.filter(id => id !== evictId && id !== providerId);
    lruRef.current = [...rest, providerId];
  }, [mainIds, railIds]);

  return { mainIds, railIds, lru: lruRef.current, clickMain, swapInFromRail };
}