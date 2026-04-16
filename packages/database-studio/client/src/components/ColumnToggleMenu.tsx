import { type VisibilityState } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import { FadeScrollArea } from "@/components/FadeScrollArea";

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
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-md border bg-popover p-1 shadow-md">
        <FadeScrollArea className="max-h-64">
          {columns.map((col) => {
            const visible = visibility[col] !== false;
            return (
              <label
                key={col}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
              >
                <Checkbox
                  checked={visible}
                  onCheckedChange={() => onChange({ ...visibility, [col]: !visible })}
                  className="size-3.5"
                />
                <span className="truncate font-mono">{col}</span>
              </label>
            );
          })}
        </FadeScrollArea>
        {hiddenCount > 0 && (
          <div className="border-t px-2 pt-1 mt-1">
            <button
              onClick={() => onChange({})}
              className="w-full rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
            >
              Show all columns
            </button>
          </div>
        )}
      </div>
    </>
  );
}
