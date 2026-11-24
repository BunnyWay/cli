import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

// Swap ?token= for the HttpOnly auth cookie, then scrub it so it never lingers in history.
function exchangeToken(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (!token) return Promise.resolve();

  return fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    credentials: "same-origin",
  })
    .then(() => undefined)
    .finally(() => {
      params.delete("token");
      const qs = params.toString();
      const newUrl =
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
    });
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

exchangeToken().then(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
