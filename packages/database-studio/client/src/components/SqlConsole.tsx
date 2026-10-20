import { Download, History, Lock, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type QueryResult, runQuery, type StudioSchema } from "@/api";
import { DataGrid } from "@/components/DataGrid";
import { MenuItem, Popover } from "@/components/Popover";
import { SqlEditor } from "@/components/SqlEditor";
import { Button } from "@/components/ui/button";
import { downloadRows } from "@/lib/format";
import { MOD_KEY, startDrag } from "@/lib/interaction";
import { quoteIdent } from "@/lib/sql";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "bunny-studio:sql-draft";
const HISTORY_KEY = "bunny-studio:sql-history";
const HISTORY_LIMIT = 50;

interface HistoryEntry {
  sql: string;
  at: number;
}

// Storage can be unavailable (private windows, blocked site data); the console works without it.
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function timeAgo(at: number): string {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}

export interface ConsoleRequest {
  sql: string;
  nonce: number;
}

export function SqlConsole({
  schema,
  request,
}: {
  schema: StudioSchema;
  request: ConsoleRequest | null;
}) {
  const [sql, setSql] = useState(() => {
    const first = schema.tables[0]?.name;
    return load(
      DRAFT_KEY,
      first ? `SELECT * FROM ${quoteIdent(first)} LIMIT 100;` : "",
    );
  });
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    load(HISTORY_KEY, []),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editorHeight, setEditorHeight] = useState(200);
  const abortRef = useRef<AbortController | null>(null);

  const completion = useMemo(
    () =>
      Object.fromEntries([
        ...schema.tables.map((t) => [t.name, t.columns.map((c) => c.name)]),
        ...schema.views.map((v) => [v.name, v.columns]),
      ]),
    [schema],
  );

  useEffect(() => save(DRAFT_KEY, sql), [sql]);

  const run = useCallback(async (statement: string) => {
    const text = statement.trim();
    if (!text) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setHistory((h) => {
      const next = [
        { sql: text, at: Date.now() },
        ...h.filter((e) => e.sql !== text),
      ].slice(0, HISTORY_LIMIT);
      save(HISTORY_KEY, next);
      return next;
    });
    try {
      setResult(await runQuery(text, controller.signal));
    } catch (e) {
      if (controller.signal.aborted) return;
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!request) return;
    setSql(request.sql);
    run(request.sql);
  }, [request, run]);

  function exportResult(format: "csv" | "json") {
    if (!result) return;
    downloadRows("query", result.columns, result.rows, format);
    setExportOpen(false);
  }

  function startResize(e: React.PointerEvent) {
    const start = editorHeight;
    startDrag(e, (_, dy) =>
      setEditorHeight(
        Math.max(80, Math.min(window.innerHeight - 200, start + dy)),
      ),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={running}
          onClick={() => run(sql)}
          title={`Run (${MOD_KEY}Enter runs the statement under the cursor)`}
        >
          <Play className="h-3 w-3" />
          Run
          <kbd className="font-mono text-[10px] opacity-70">{MOD_KEY}↵</kbd>
        </Button>
        <div className="relative">
          <Button
            variant={historyOpen ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1 text-xs"
            disabled={history.length === 0}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <History className="h-3 w-3" />
            History
          </Button>
          <Popover
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            className="w-[28rem]"
          >
            <div className="max-h-80 overflow-y-auto">
              {history.map((entry) => (
                <MenuItem
                  key={`${entry.at}-${entry.sql}`}
                  onClick={() => {
                    setSql(entry.sql);
                    setHistoryOpen(false);
                  }}
                  className="items-start"
                >
                  <span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-all font-mono">
                    {entry.sql}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {timeAgo(entry.at)}
                  </span>
                </MenuItem>
              ))}
            </div>
            <div className="mt-1 border-t pt-1">
              <MenuItem
                onClick={() => {
                  setHistory([]);
                  save(HISTORY_KEY, []);
                  setHistoryOpen(false);
                }}
                className="text-muted-foreground"
              >
                Clear history
              </MenuItem>
            </div>
          </Popover>
        </div>
        <span
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground"
          title={
            schema.tokenReadOnly
              ? "Studio rejects statements that write, and its database token is read-only, so the database refuses writes too."
              : "Studio rejects statements that write. The token came from --token or .env and may allow writes, so that check is the only guard. Run without them to use a read-only token."
          }
        >
          <Lock className="h-3 w-3" />
          {schema.tokenReadOnly
            ? "Read-only token · SELECT, WITH, EXPLAIN, PRAGMA, VALUES"
            : "Your token · writes blocked by studio · SELECT, WITH, EXPLAIN, PRAGMA, VALUES"}
        </span>
      </div>

      <div style={{ height: editorHeight }} className="shrink-0">
        <SqlEditor
          value={sql}
          onChange={setSql}
          onRun={run}
          schema={completion}
        />
      </div>
      <div
        onPointerDown={startResize}
        className="h-1.5 shrink-0 cursor-row-resize border-y bg-card hover:bg-primary/40"
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        {running && (
          <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-border">
            <div className="sweep-bar h-full w-1/3 bg-primary" />
          </div>
        )}
        {error ? (
          <div className="m-3 rounded-md border border-destructive/60 bg-destructive/15 px-3 py-2 font-mono text-xs text-destructive-foreground">
            {error}
          </div>
        ) : result ? (
          <DataGrid
            columns={result.columns.map((name) => ({ name }))}
            rows={result.rows}
            emptyMessage={
              result.columns.length === 0
                ? "The statement ran and returned no columns."
                : "No rows."
            }
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <p>Run a query to see results here.</p>
            <p className="text-muted-foreground/70">
              Tab completes table and column names. Reads count against your
              quota, so add a LIMIT to large tables.
            </p>
          </div>
        )}
      </div>

      <footer className="flex h-9 shrink-0 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
        {result && !error && (
          <>
            <span className="tabular-nums">
              {result.rows.length.toLocaleString()} row
              {result.rows.length === 1 ? "" : "s"}
              <span className="ml-2 text-muted-foreground/60">
                {result.durationMs} ms
              </span>
            </span>
            {result.truncated && (
              <span className="text-primary">
                Showing the first {result.rows.length.toLocaleString()}. Add a
                LIMIT to see a specific range.
              </span>
            )}
          </>
        )}
        <div className={cn("relative ml-auto", !result && "hidden")}>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-xs"
            disabled={!result || result.rows.length === 0}
            onClick={() => setExportOpen(!exportOpen)}
          >
            <Download className="h-3 w-3" />
            Export
          </Button>
          <Popover
            open={exportOpen}
            onClose={() => setExportOpen(false)}
            align="right"
            className="bottom-full top-auto mb-1 w-40"
          >
            <MenuItem onClick={() => exportResult("csv")}>As CSV</MenuItem>
            <MenuItem onClick={() => exportResult("json")}>As JSON</MenuItem>
          </Popover>
        </div>
      </footer>
    </div>
  );
}
