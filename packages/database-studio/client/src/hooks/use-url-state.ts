import { useSyncExternalStore } from "react";

function getSearch() {
  return window.location.search;
}

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

export function useUrlParam(key: string): string | null {
  const search = useSyncExternalStore(subscribe, getSearch);
  return new URLSearchParams(search).get(key);
}

// `push` is for navigation only, so Back skips individual filter and paging edits.
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
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export const TABLE_VIEW_PARAMS = {
  view: null,
  page: null,
  sort: null,
  order: null,
  filters: null,
  mode: null,
} as const;

// Not a valid unquoted table name, so it can't clash with one.
export const SQL_TAB = ":sql";
