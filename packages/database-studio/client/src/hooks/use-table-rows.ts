import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchRows, type RowsQuery, type RowsResponse } from "@/api";

// Keeps the last page on screen while the next loads.
export function useTableRows(table: string, query: RowsQuery) {
  const [data, setData] = useState<RowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Compared by value so an equal query doesn't refetch.
  const queryKey = JSON.stringify(query);
  const stableQuery = useMemo(
    () => JSON.parse(queryKey) as RowsQuery,
    [queryKey],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey forces a refetch
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchRows(table, stableQuery, controller.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [table, stableQuery, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return { data, loading, error, refresh };
}
