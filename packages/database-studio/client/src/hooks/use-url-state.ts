import { useSyncExternalStore } from "react";

function getSearch() {
  return window.location.search;
}

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

/** Read a single URL search param reactively. */
export function useUrlParam(key: string): string | null {
  const search = useSyncExternalStore(subscribe, getSearch);
  return new URLSearchParams(search).get(key);
}

/**
 * Update URL search params without a page reload. `push` adds a history
 * entry so Back returns to the previous view (used for navigation, not for
 * every filter keystroke).
 */
export function setUrlParams(
  updates: Record<string, string | null>,
  { push = false }: { push?: boolean } = {},
) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  const search = params.toString();
  if (`?${search}` === window.location.search) return;
  const url = search ? `?${search}` : window.location.pathname;
  if (push) {
    window.history.pushState(null, "", url);
  } else {
    window.history.replaceState(null, "", url);
  }
  // Notify subscribers
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Params scoped to one table's view; cleared when switching tables. */
export const TABLE_VIEW_PARAMS = {
  view: null,
  page: null,
  sort: null,
  order: null,
  filters: null,
  mode: null,
} as const;

/** The `table` param value for the SQL console; not a valid unquoted table name. */
export const SQL_TAB = ":sql";
