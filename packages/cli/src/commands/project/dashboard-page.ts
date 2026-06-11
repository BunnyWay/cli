/** Self-contained canvas page served by `bunny project dashboard` (no assets, safe to embed in the compiled binary). */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>bunny canvas</title>
<style>
  :root {
    --bg: #0e1015;
    --card: #171a21;
    --border: #262b36;
    --text: #e8eaf0;
    --dim: #8b93a5;
    --accent: #ff8b3d;
    --database: #4cc38a;
    --script: #7aa2ff;
    --container: #b08bff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 14px 22px;
    border-bottom: 1px solid var(--border);
  }
  header .logo { font-weight: 700; color: var(--accent); }
  header .name { font-weight: 600; }
  header .path {
    margin-left: auto;
    color: var(--dim);
    font: 12px ui-monospace, "SF Mono", Menlo, monospace;
  }
  header .status { color: var(--dim); font-size: 12px; }
  header .status.live::before {
    content: "●";
    color: var(--database);
    margin-right: 5px;
  }
  #error {
    display: none;
    margin: 16px 22px 0;
    padding: 10px 14px;
    border: 1px solid #5c2e2e;
    border-radius: 8px;
    background: #2a1717;
    color: #ff9d9d;
    white-space: pre-wrap;
    font: 12px ui-monospace, Menlo, monospace;
  }
  #canvas {
    position: relative;
    min-height: calc(100vh - 53px);
    padding: 48px;
    background-image: radial-gradient(var(--border) 1px, transparent 1px);
    background-size: 22px 22px;
  }
  #edges {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  #board {
    position: relative;
    display: flex;
    align-items: center;
    gap: 140px;
    max-width: 1100px;
    margin: 0 auto;
  }
  #groups { display: flex; flex-direction: column; gap: 28px; flex: 1; }
  .group-title {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--dim);
    margin-bottom: 10px;
  }
  .cards { display: flex; flex-direction: column; gap: 14px; }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-left: 3px solid var(--kind, var(--border));
    border-radius: 10px;
    padding: 12px 16px;
    max-width: 380px;
  }
  .card .top { display: flex; align-items: center; gap: 10px; }
  .card .label { font-weight: 600; }
  .card .badge {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--kind);
    border: 1px solid var(--kind);
    border-radius: 99px;
    padding: 1px 8px;
  }
  .card .sublabel { color: var(--dim); font-size: 12px; margin-top: 2px; }
  .card .details {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font: 11px ui-monospace, "SF Mono", Menlo, monospace;
    color: var(--dim);
  }
  .card .details b { color: var(--text); font-weight: 500; }
  .card.kind-database { --kind: var(--database); }
  .card.kind-script { --kind: var(--script); }
  .card.kind-app { --kind: var(--accent); }
  .card.kind-project {
    --kind: var(--accent);
    border-left-width: 1px;
    border-color: var(--accent);
    box-shadow: 0 0 0 4px rgb(255 139 61 / 8%);
    padding: 18px 22px;
  }
  .card.kind-project .label { font-size: 17px; }
  .containers { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
  .container-chip {
    border: 1px dashed var(--border);
    border-radius: 8px;
    padding: 7px 12px;
  }
  .container-chip .label { font-size: 13px; }
  .container-chip .label::before { content: "▣ "; color: var(--container); }
  #empty { color: var(--dim); margin-top: 8px; max-width: 380px; }
  #empty code { color: var(--text); }
</style>
</head>
<body>
<header>
  <span class="logo">🐰 bunny canvas</span>
  <span class="name" id="project-name"></span>
  <span class="status live" id="status">watching</span>
  <span class="path" id="config-path"></span>
</header>
<div id="error"></div>
<div id="canvas">
  <svg id="edges"></svg>
  <div id="board">
    <div id="root"></div>
    <div id="groups"></div>
  </div>
</div>
<script>
  const KIND_GROUPS = [
    ["database", "Databases"],
    ["script", "Edge Scripts"],
    ["app", "App"],
  ];
  let lastPayload = "";

  function card(node) {
    const el = document.createElement("div");
    el.className = "card kind-" + node.kind;
    el.dataset.nodeId = node.id;
    const details = node.details
      .map((d) => "<span>" + d.key + " <b>" + escapeHtml(d.value) + "</b></span>")
      .join("");
    el.innerHTML =
      '<div class="top"><span class="label">' + escapeHtml(node.label) + "</span>" +
      '<span class="badge">' + node.kind + "</span></div>" +
      (node.sublabel ? '<div class="sublabel">' + escapeHtml(node.sublabel) + "</div>" : "") +
      (details ? '<div class="details">' + details + "</div>" : "");
    return el;
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value);
    return div.innerHTML;
  }

  function render(graph) {
    document.getElementById("project-name").textContent = graph.name;
    const root = document.getElementById("root");
    const groups = document.getElementById("groups");
    root.innerHTML = "";
    groups.innerHTML = "";

    const project = graph.nodes.find((n) => n.kind === "project");
    root.appendChild(card(project));

    const containersByApp = graph.edges
      .filter((e) => e.from === "app")
      .map((e) => graph.nodes.find((n) => n.id === e.to))
      .filter(Boolean);

    let drewAny = false;
    for (const [kind, title] of KIND_GROUPS) {
      const nodes = graph.nodes.filter((n) => n.kind === kind);
      if (nodes.length === 0) continue;
      drewAny = true;
      const group = document.createElement("div");
      group.innerHTML = '<div class="group-title">' + title + "</div>";
      const cards = document.createElement("div");
      cards.className = "cards";
      for (const node of nodes) {
        const el = card(node);
        if (kind === "app" && containersByApp.length) {
          const wrap = document.createElement("div");
          wrap.className = "containers";
          for (const c of containersByApp) wrap.appendChild(chipFor(c));
          el.appendChild(wrap);
        }
        cards.appendChild(el);
      }
      group.appendChild(cards);
      groups.appendChild(group);
    }

    if (!drewAny) {
      const empty = document.createElement("div");
      empty.id = "empty";
      empty.innerHTML =
        "No resources mapped yet. Run <code>bunny project add database &lt;binding&gt;</code> " +
        "or <code>bunny project init --from-account</code>, then watch this canvas update.";
      groups.appendChild(empty);
    }

    requestAnimationFrame(drawEdges);
  }

  function chipFor(node) {
    const el = document.createElement("div");
    el.className = "container-chip";
    const details = node.details
      .map((d) => "<span>" + d.key + " <b>" + escapeHtml(d.value) + "</b></span>")
      .join("");
    el.innerHTML =
      '<div class="label">' + escapeHtml(node.label) + "</div>" +
      (details ? '<div class="details">' + details + "</div>" : "");
    return el;
  }

  function drawEdges() {
    const svg = document.getElementById("edges");
    const canvas = document.getElementById("canvas");
    const origin = canvas.getBoundingClientRect();
    svg.setAttribute("viewBox", "0 0 " + origin.width + " " + origin.height);
    svg.innerHTML = "";

    const from = document.querySelector('[data-node-id="project"]');
    if (!from) return;
    const a = from.getBoundingClientRect();

    for (const el of document.querySelectorAll("#groups .card")) {
      const b = el.getBoundingClientRect();
      const x1 = a.right - origin.left;
      const y1 = a.top + a.height / 2 - origin.top;
      const x2 = b.left - origin.left;
      const y2 = b.top + b.height / 2 - origin.top;
      const mx = (x1 + x2) / 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        "M " + x1 + " " + y1 + " C " + mx + " " + y1 + ", " + mx + " " + y2 + ", " + x2 + " " + y2,
      );
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--border)");
      path.setAttribute("stroke-width", "1.5");
      svg.appendChild(path);
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", x2);
      dot.setAttribute("cy", y2);
      dot.setAttribute("r", "3");
      dot.setAttribute("fill", "var(--accent)");
      svg.appendChild(dot);
    }
  }

  async function refresh() {
    try {
      const res = await fetch("/api/project");
      const payload = await res.json();
      const errorEl = document.getElementById("error");
      if (payload.error) {
        errorEl.textContent = payload.error;
        errorEl.style.display = "block";
        document.getElementById("status").textContent = "config invalid";
        return;
      }
      errorEl.style.display = "none";
      document.getElementById("status").textContent = "watching";
      document.getElementById("config-path").textContent = payload.path;
      const serialized = JSON.stringify(payload.graph);
      if (serialized !== lastPayload) {
        lastPayload = serialized;
        render(payload.graph);
      }
    } catch {
      document.getElementById("status").textContent = "server stopped";
    }
  }

  window.addEventListener("resize", () => requestAnimationFrame(drawEdges));
  refresh();
  setInterval(refresh, 2000);
</script>
</body>
</html>
`;
