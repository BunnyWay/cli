import { useCallback, useState } from "react";

export const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform)
  ? "⌘"
  : "Ctrl ";

export function useCopy(duration = 1200) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(
    (key: string, text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), duration);
      });
    },
    [duration],
  );
  return { copied, copy };
}

// Listens on the window so the drag survives leaving the handle.
export function startDrag(
  e: React.PointerEvent,
  onMove: (dx: number, dy: number) => void,
) {
  e.preventDefault();
  e.stopPropagation();
  const { clientX: x, clientY: y } = e;
  const move = (ev: PointerEvent) => onMove(ev.clientX - x, ev.clientY - y);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
