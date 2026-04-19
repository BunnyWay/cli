import type { VisibilityState } from "@tanstack/react-table";
import { FadeScrollArea } from "@/components/FadeScrollArea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function ColumnToggleMenu({
  columns,
  visibility,
  onChange,
  onClose,
}: {
  columns: string[];
  visibility: VisibilityState;
  onChange: (v: VisibilityState) => void;
  onClose: () => void;
}) {
  const hiddenCount = Object.values(visibility).filter((v) => !v).length;

  return (
    <>
      <Button
        variant="ghost"
        aria-label="Close column menu"
        onClick={onClose}
        className="fixed inset-0 z-20 h-auto w-auto cursor-default rounded-none p-0 hover:bg-transparent focus-visible:ring-0"
      />
      <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-md border bg-popover p-1 shadow-md">
        <FadeScrollArea className="max-h-64">
          {columns.map((col) => {
            const visible = visibility[col] !== false;
            return (
              <Button
                key={col}
                variant="ghost"
                onClick={() => onChange({ ...visibility, [col]: !visible })}
                className="flex h-auto w-full cursor-pointer items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-xs"
              >
                <Checkbox
                  checked={visible}
                  tabIndex={-1}
                  className="size-3.5 pointer-events-none"
                />
                <span className="truncate font-mono">{col}</span>
              </Button>
            );
          })}
        </FadeScrollArea>
        {hiddenCount > 0 && (
          <div className="border-t px-2 pt-1 mt-1">
            <Button
              variant="ghost"
              onClick={() => onChange({})}
              className="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground"
            >
              Show all columns
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
