import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { RowsResponse } from "@/api";
import { Button } from "@/components/ui/button";

export const PAGE_SIZES = [25, 50, 100, 250];
export const DEFAULT_PAGE_SIZE = 50;

export function Pager({
  data,
  page,
  limit,
  onPage,
  onLimit,
}: {
  data: RowsResponse | null;
  page: number;
  limit: number;
  onPage: (page: number) => void;
  onLimit: (limit: number) => void;
}) {
  const offset = (page - 1) * limit;
  return (
    <footer className="flex h-9 shrink-0 items-center gap-3 border-t px-3 text-xs text-muted-foreground">
      {data && (
        <span className="tabular-nums">
          {data.totalRows === 0
            ? "0 rows"
            : `${(offset + 1).toLocaleString()}–${(offset + data.rows.length).toLocaleString()} of ${data.totalRows.toLocaleString()} row${data.totalRows === 1 ? "" : "s"}`}
          <span className="ml-2 text-muted-foreground/60">
            {data.responseTime} ms
          </span>
        </span>
      )}
      <div className="ml-auto flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          Rows per page
          <select
            value={limit}
            onChange={(e) => onLimit(Number(e.target.value))}
            className="h-6 rounded border bg-background px-1 text-xs text-foreground"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {data && (
          <div className="flex items-center gap-0.5">
            <PagerButton
              label="First page"
              disabled={page <= 1}
              onClick={() => onPage(1)}
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </PagerButton>
            <PagerButton
              label="Previous page"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </PagerButton>
            <span className="px-1.5 tabular-nums">
              Page {page.toLocaleString()} of {data.totalPages.toLocaleString()}
            </span>
            <PagerButton
              label="Next page"
              disabled={page >= data.totalPages}
              onClick={() => onPage(page + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </PagerButton>
            <PagerButton
              label="Last page"
              disabled={page >= data.totalPages}
              onClick={() => onPage(data.totalPages)}
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </PagerButton>
          </div>
        )}
      </div>
    </footer>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </Button>
  );
}
