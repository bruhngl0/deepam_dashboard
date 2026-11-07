'use client';

/**
 * A filter value kept in the page's query string, so a filtered view survives a reload and can be
 * shared, the same as the CRM's URL filters (D-82). Updates replace the history entry rather than
 * adding one, so typing into a filter doesn't fill the back button. The server render and first
 * client render use `initial`; the URL value takes over straight after.
 */

import { useCallback, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => { listeners.delete(listener); window.removeEventListener('popstate', listener); };
}

export function useUrlState<T extends string = string>(key: string, initial: NoInfer<T>): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(key) ?? initial,
    () => initial,
  ) as T;
  const set = useCallback((next: T) => {
    const url = new URL(window.location.href);
    if (next === initial || next === '') url.searchParams.delete(key);
    else url.searchParams.set(key, next);
    window.history.replaceState(window.history.state, '', url);
    listeners.forEach(listener => listener());
  }, [key, initial]);
  return [value, set];
}
