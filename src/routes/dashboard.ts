import type { FastifyInstance } from "fastify";
import {
  getPolicy,
  addOrUpdateAgent,
  removeAgent,
  type AgentConfig,
} from "../services/policyService.js";
import { addEvent } from "../services/eventLog.js";
import { getRecentEvents } from "../services/eventLog.js";

// ─── available tools (single source of truth for UI) ────────────────────────

const AVAILABLE_TOOLS = ["hello", "private-signal"];

// ─── routes ─────────────────────────────────────────────────────────────────

export async function registerDashboardRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── GET /dashboard ──────────────────────────────────────────────────────
  app.get("/dashboard", async (_req, reply) => {
    const policy = getPolicy();
    const events = getRecentEvents(20);
    const html = renderDashboard(policy.agents, events);
    return reply.type("text/html; charset=utf-8").send(html);
  });

  // ── POST /dashboard/agents (add/update) ─────────────────────────────────
  app.post("/dashboard/agents", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const ensName = String(body.ensName ?? "").trim();
    if (!ensName) {
      return reply.redirect("/dashboard");
    }

    const label = String(body.label ?? "").trim();
    const status =
      body.status === "suspended" ? "suspended" : "active";

    // parse allowedTools from checkboxes
    let allowedTools: string[] = [];
    if (typeof body.allowedTools === "string") {
      allowedTools = [body.allowedTools];
    } else if (Array.isArray(body.allowedTools)) {
      allowedTools = (body.allowedTools as string[]).filter(Boolean);
    }

    const config: AgentConfig = {
      status,
      allowedTools,
      ...(label ? { label } : {}),
    };

    addOrUpdateAgent(ensName, config);
    addEvent({
      type: "agent_added",
      ensName,
      result: "info",
      reason: `tools: ${allowedTools.join(", ") || "none"}`,
    });

    return reply.redirect("/dashboard");
  });

  // ── POST /dashboard/agents/remove ───────────────────────────────────────
  app.post("/dashboard/agents/remove", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const ensName = String(body.ensName ?? "").trim();
    if (!ensName) {
      return reply.redirect("/dashboard");
    }

    removeAgent(ensName);
    addEvent({
      type: "agent_removed",
      ensName,
      result: "info",
      reason: "removed via dashboard",
    });

    return reply.redirect("/dashboard");
  });
}

// ─── HTML renderer ──────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDashboard(
  agents: Record<string, AgentConfig>,
  events: ReturnType<typeof getRecentEvents>,
): string {
  // ── agent rows ──────────────────────────────────────────────────────────
  const agentRows = Object.entries(agents)
    .map(
      ([name, cfg]) => `
      <tr>
        <td><code>${esc(name)}</code></td>
        <td>${esc(cfg.label ?? "")}</td>
        <td><span class="badge ${cfg.status === "active" ? "badge-active" : "badge-suspended"}">${esc(cfg.status)}</span></td>
        <td>${cfg.allowedTools.map((t) => `<code>${esc(t)}</code>`).join(", ") || "<em>none</em>"}</td>
        <td>
          <form method="post" action="/dashboard/agents/remove" style="display:inline">
            <input type="hidden" name="ensName" value="${esc(name)}" />
            <button type="submit" class="btn btn-danger btn-sm">Remove</button>
          </form>
        </td>
      </tr>`,
    )
    .join("\n");

  // ── tool checkboxes ─────────────────────────────────────────────────────
  const toolCheckboxes = AVAILABLE_TOOLS.map(
    (t) =>
      `<label class="checkbox-label"><input type="checkbox" name="allowedTools" value="${esc(t)}" checked /> ${esc(t)}</label>`,
  ).join("\n            ");

  // ── event rows ──────────────────────────────────────────────────────────
  const eventRows = events
    .map(
      (e) => `
      <tr class="${e.result === "allowed" ? "row-allowed" : e.result === "denied" ? "row-denied" : ""}">
        <td>${esc(e.timestamp.replace("T", " ").slice(0, 19))}</td>
        <td>${esc(e.type)}</td>
        <td>${esc(e.ensName ?? "—")}</td>
        <td>${esc(e.tool ?? "—")}</td>
        <td><span class="badge ${e.result === "allowed" ? "badge-active" : e.result === "denied" ? "badge-suspended" : "badge-info"}">${esc(e.result)}</span></td>
        <td>${esc(e.reason ?? "")}</td>
      </tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ENS AgentGate – Dashboard</title>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #242836;
    --border: #2e3344;
    --text: #e4e6ed;
    --text-dim: #8b8fa3;
    --accent: #6c63ff;
    --accent-hover: #7f78ff;
    --green: #34d399;
    --green-bg: rgba(52,211,153,0.08);
    --red: #f87171;
    --red-bg: rgba(248,113,113,0.08);
    --blue: #60a5fa;
    --blue-bg: rgba(96,165,250,0.08);
    --orange: #fbbf24;
    --font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --mono: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
    --radius: 8px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    min-height: 100vh;
    padding: 0;
  }
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  .container {
    max-width: 960px;
    margin: 0 auto;
    padding: 32px 24px;
  }

  /* ── Header ────────────────────────────────────── */
  .header {
    text-align: center;
    margin-bottom: 40px;
  }
  .header h1 {
    font-size: 28px;
    font-weight: 700;
    background: linear-gradient(135deg, var(--accent), var(--blue));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin-bottom: 6px;
  }
  .header p {
    color: var(--text-dim);
    font-size: 14px;
  }

  /* ── Cards ─────────────────────────────────────── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px;
    margin-bottom: 24px;
  }
  .card h2 {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .card h2 .icon { font-size: 18px; }

  /* ── Table ─────────────────────────────────────── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    text-align: left;
    color: var(--text-dim);
    font-weight: 500;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  tr:last-child td { border-bottom: none; }
  code {
    font-family: var(--mono);
    background: var(--surface2);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }

  /* ── Badges ────────────────────────────────────── */
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 500;
  }
  .badge-active  { background: var(--green-bg); color: var(--green); }
  .badge-suspended { background: var(--red-bg); color: var(--red); }
  .badge-info { background: var(--blue-bg); color: var(--blue); }

  /* ── Event rows ────────────────────────────────── */
  .row-allowed td:first-child { border-left: 3px solid var(--green); }
  .row-denied td:first-child  { border-left: 3px solid var(--red); }

  /* ── Form ──────────────────────────────────────── */
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }
  .form-group { display: flex; flex-direction: column; gap: 4px; }
  .form-group.full { grid-column: 1 / -1; }
  label.field-label {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
  }
  input[type="text"], select {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--text);
    font-size: 14px;
    font-family: var(--font);
    outline: none;
    transition: border-color 0.2s;
  }
  input[type="text"]:focus, select:focus {
    border-color: var(--accent);
  }
  .checkbox-group { display: flex; gap: 16px; flex-wrap: wrap; }
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  input[type="checkbox"] {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
  }

  /* ── Buttons ───────────────────────────────────── */
  .btn {
    display: inline-block;
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    font-family: var(--font);
    transition: all 0.2s;
  }
  .btn-primary {
    background: var(--accent);
    color: #fff;
  }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-danger {
    background: transparent;
    color: var(--red);
    border: 1px solid var(--red);
    padding: 4px 10px;
  }
  .btn-danger:hover { background: var(--red-bg); }
  .btn-sm { font-size: 11px; padding: 4px 10px; }

  /* ── Instructions ──────────────────────────────── */
  .instructions {
    font-size: 13px;
    line-height: 1.7;
    color: var(--text-dim);
  }
  .instructions ol { padding-left: 20px; }
  .instructions li { margin-bottom: 8px; }
  .instructions code {
    color: var(--orange);
    background: var(--surface2);
  }
  .instructions strong { color: var(--text); }

  /* ── Tools list ────────────────────────────────── */
  .tool-list {
    list-style: none;
    padding: 0;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .tool-item {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 16px;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--accent);
  }

  .empty-state {
    color: var(--text-dim);
    font-style: italic;
    padding: 16px 0;
    text-align: center;
  }
</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <h1>⛓ ENS AgentGate</h1>
    <p>Policy-based access control for wallet-native agents</p>
  </div>

  <!-- Protected Tools -->
  <div class="card">
    <h2><span class="icon">🔧</span> Protected Tools</h2>
    <ul class="tool-list">
      <li class="tool-item">GET /tool/hello</li>
      <li class="tool-item">GET /tool/private-signal</li>
    </ul>
  </div>

  <!-- Policy Table -->
  <div class="card">
    <h2><span class="icon">📋</span> Current Policy</h2>
    ${
      Object.keys(agents).length === 0
        ? `<div class="empty-state">No agents configured. Add one below.</div>`
        : `<table>
      <thead><tr>
        <th>ENS Name</th><th>Label</th><th>Status</th><th>Allowed Tools</th><th>Actions</th>
      </tr></thead>
      <tbody>${agentRows}</tbody>
    </table>`
    }
  </div>

  <!-- Add / Update Agent -->
  <div class="card">
    <h2><span class="icon">➕</span> Add / Update Agent</h2>
    <form method="post" action="/dashboard/agents">
      <div class="form-grid">
        <div class="form-group">
          <label class="field-label" for="ensName">ENS Name</label>
          <input type="text" id="ensName" name="ensName" placeholder="myagent.eth" required />
        </div>
        <div class="form-group">
          <label class="field-label" for="label">Label</label>
          <input type="text" id="label" name="label" placeholder="Optional description" />
        </div>
        <div class="form-group">
          <label class="field-label" for="status">Status</label>
          <select id="status" name="status">
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        <div class="form-group">
          <label class="field-label">Allowed Tools</label>
          <div class="checkbox-group">
            ${toolCheckboxes}
          </div>
        </div>
      </div>
      <button type="submit" class="btn btn-primary">Save Agent</button>
    </form>
  </div>

  <!-- Recent Events -->
  <div class="card">
    <h2><span class="icon">📊</span> Recent Events</h2>
    ${
      events.length === 0
        ? `<div class="empty-state">No events recorded yet. Authenticate an agent to see activity.</div>`
        : `<table>
      <thead><tr>
        <th>Time</th><th>Type</th><th>ENS Name</th><th>Tool</th><th>Result</th><th>Reason</th>
      </tr></thead>
      <tbody>${eventRows}</tbody>
    </table>`
    }
  </div>

  <!-- Agent Instructions -->
  <div class="card">
    <h2><span class="icon">🤖</span> Agent Instructions</h2>
    <div class="instructions">
      <ol>
        <li><strong>Step 1:</strong> <code>POST /auth/challenge</code> with <code>{ "ensName": "...", "address": "0x..." }</code></li>
        <li><strong>Step 2:</strong> Sign the returned <code>message</code> with your wallet signer (EIP-191)</li>
        <li><strong>Step 3:</strong> <code>POST /auth/verify</code> with <code>{ "ensName": "...", "address": "0x...", "signature": "0x..." }</code></li>
        <li><strong>Step 4:</strong> Use the returned <code>sessionToken</code> in subsequent requests:<br/><code>Authorization: Bearer &lt;sessionToken&gt;</code></li>
        <li><strong>Step 5:</strong> Call protected tools:<br/><code>GET /tool/hello</code><br/><code>GET /tool/private-signal</code></li>
      </ol>
    </div>
  </div>

  <!-- Admin Instructions -->
  <div class="card">
    <h2><span class="icon">👤</span> Admin / Demo Instructions</h2>
    <div class="instructions">
      <ol>
        <li>Add your agent's ENS name using the form above</li>
        <li>Select which tools the agent is allowed to access</li>
        <li>Click <strong>Save Agent</strong> — no server restart required</li>
        <li>Run the demo client with a matching ENS name and private key:<br/><code>npm run demo</code></li>
        <li>Watch the <strong>Recent Events</strong> section update with auth and tool access results</li>
        <li>To test denied access, remove a tool from the allowed list and call the tool again — you'll get a <code>403 policy_denied</code></li>
      </ol>
    </div>
  </div>

</div>
</body>
</html>`;
}
