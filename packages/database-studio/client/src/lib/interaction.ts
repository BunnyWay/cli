import { useCallback, useState } from "react";

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** The platform's modifier key as shown in shortcut hints. */
export const MOD_KEY = isMac ? "⌘" : "Ctrl ";

/**
 * Copy text and remember which thing was copied for a moment, so the caller
 * can flash a check mark next to it.
 */
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

/**
 * Track a pointer drag that started with `e`, reporting how far it has moved.
 * Listens on the window so the drag survives leaving the handle.
 */
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
