import type { FastifyInstance } from "fastify";
import {
  getPolicy,
  addOrUpdateAgent,
  removeAgent,
  type AgentConfig,
} from "../services/policyService.js";
import { addEvent } from "../services/eventLog.js";
import { getRecentEvents } from "../services/eventLog.js";
import { clearSessions } from "../services/sessionStore.js";

// ─── available tools (single source of truth for UI) ────────────────────────

const AVAILABLE_TOOLS = ["hello", "private-signal"];

// ─── routes ─────────────────────────────────────────────────────────────────

export async function registerDashboardRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── GET /dashboard ──────────────────────────────────────────────────────
  app.get("/dashboard", async (_req, reply) => {
    const policy = await getPolicy();
    const events = getRecentEvents(20);
    const html = renderDashboard(policy.agents, events);
    return reply.type("text/html; charset=utf-8").send(html);
  });

  // ── GET /dashboard/events (JSON for live polling) ───────────────────────
  app.get("/dashboard/events", async (_req, reply) => {
    const events = getRecentEvents(20);
    return reply.send(events);
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

	    await addOrUpdateAgent(ensName, config);
	    const invalidatedSessions = clearSessions();
	    addEvent({
	      type: "agent_added",
	      ensName,
	      result: "info",
	      reason: `tools: ${allowedTools.join(", ") || "none"}; invalidated sessions: ${invalidatedSessions}`,
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

	    await removeAgent(ensName);
	    const invalidatedSessions = clearSessions();
	    addEvent({
	      type: "agent_removed",
	      ensName,
	      result: "info",
	      reason: `removed via dashboard; invalidated sessions: ${invalidatedSessions}`,
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
	    max-width: 1180px;
	    margin: 0 auto;
	    padding: 32px 24px;
	  }
	  .dashboard-grid {
	    display: grid;
	    grid-template-columns: minmax(0, 1fr) minmax(360px, 420px);
	    gap: 24px;
	    align-items: start;
	  }
	  .column { min-width: 0; }
	  @media (max-width: 900px) {
	    .dashboard-grid { grid-template-columns: 1fr; }
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
	  input[type="text"], textarea, select {
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
	  textarea {
	    min-height: 96px;
	    resize: vertical;
	    font-family: var(--mono);
	    font-size: 12px;
	  }
	  input[type="text"]:focus, textarea:focus, select:focus {
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
	  .btn-connected {
	    background: var(--green-bg);
	    color: var(--green);
	    border: 1px solid var(--green);
	    cursor: default;
	  }
	  .btn-connected:hover { background: var(--green-bg); }
	  .btn-secondary {
	    background: var(--surface2);
	    color: var(--text);
	    border: 1px solid var(--border);
	  }
	  .btn-secondary:hover { border-color: var(--accent); }
	  .btn-danger {
	    background: transparent;
	    color: var(--red);
	    border: 1px solid var(--red);
	    padding: 4px 10px;
	  }
	  .btn-danger:hover { background: var(--red-bg); }
	  .btn-sm { font-size: 11px; padding: 4px 10px; }
	  .btn:disabled {
	    cursor: not-allowed;
	    opacity: 0.5;
	  }
	  .button-row {
	    display: flex;
	    gap: 8px;
	    flex-wrap: wrap;
	    margin-top: 12px;
	  }

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
	  .demo-panel {
	    position: sticky;
	    top: 24px;
	  }
	  @media (max-width: 900px) {
	    .demo-panel { position: static; }
	  }
	  .demo-status {
	    display: grid;
	    gap: 8px;
	    margin: 12px 0;
	  }
	  .status-line {
	    display: flex;
	    justify-content: space-between;
	    gap: 12px;
	    padding: 8px 10px;
	    background: var(--surface2);
	    border: 1px solid var(--border);
	    border-radius: 6px;
	    font-size: 12px;
	  }
	  .status-line span:first-child { color: var(--text-dim); }
	  .status-line span:last-child {
	    font-family: var(--mono);
	    overflow-wrap: anywhere;
	    text-align: right;
	  }
	  .demo-log {
	    background: #090b10;
	    border: 1px solid var(--border);
	    border-radius: 6px;
	    color: var(--text);
	    font-family: var(--mono);
	    font-size: 11px;
	    line-height: 1.5;
	    margin-top: 12px;
	    max-height: 260px;
	    overflow: auto;
	    padding: 12px;
	    white-space: pre-wrap;
	  }
	  .hint {
	    color: var(--text-dim);
	    font-size: 12px;
	    line-height: 1.5;
	    margin-top: 8px;
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

	  <div class="dashboard-grid">
	    <div class="column">
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
	        <h2><span class="icon">📊</span> Recent Events <span style="font-size:11px;color:var(--text-dim);font-weight:400;margin-left:auto;">auto-refresh 5s</span></h2>
	        <div id="eventsContainer">
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
	      </div>
	    </div>

	    <div class="column">
	      <!-- Wallet Demo -->
	      <div class="card demo-panel">
	        <h2><span class="icon">👛</span> Wallet Demo</h2>
	        <div class="form-group">
	          <label class="field-label" for="demoEnsName">ENS Name</label>
	          <input type="text" id="demoEnsName" placeholder="Connect wallet to reverse-resolve" />
	          <div class="hint">Reverse ENS is attempted after wallet connection. You can edit the ENS name before signing.</div>
	        </div>

	        <div class="demo-status">
	          <div class="status-line"><span>Wallet</span><span id="demoAddress">not connected</span></div>
	          <div class="status-line"><span>Reverse ENS</span><span id="demoReverseEns">not checked</span></div>
	          <div class="status-line"><span>Session</span><span id="demoSession">not signed in</span></div>
	        </div>

	        <div class="button-row">
	          <button type="button" id="connectWalletBtn" class="btn btn-primary">Connect Wallet</button>
	          <button type="button" id="signInBtn" class="btn btn-secondary" disabled>Sign In</button>
	          <button type="button" id="callToolsBtn" class="btn btn-secondary" disabled>Call Tools</button>
	        </div>

	        <div class="form-group" style="margin-top: 16px;">
	          <label class="field-label" for="challengeMessage">Challenge Message</label>
	          <textarea id="challengeMessage" readonly placeholder="The SIWE message will appear here before wallet signing."></textarea>
	        </div>

	        <pre id="demoLog" class="demo-log">Ready.</pre>
	      </div>

	      <!-- Agent Instructions -->
	      <div class="card">
	        <h2><span class="icon">🤖</span> Agent Instructions</h2>
	        <div class="instructions">
	          <ol>
	            <li><strong>Step 0:</strong> Optional reverse lookup with <code>GET /auth/reverse-ens?address=0x...</code></li>
	            <li><strong>Step 1:</strong> <code>POST /auth/challenge</code> with <code>{ "ensName": "...", "address": "0x..." }</code></li>
	            <li><strong>Step 2:</strong> Sign the returned <code>message</code> with your wallet signer (EIP-191)</li>
	            <li><strong>Step 3:</strong> <code>POST /auth/verify</code> with <code>{ "ensName": "...", "address": "0x...", "signature": "0x..." }</code></li>
	            <li><strong>Step 4:</strong> Use the returned <code>sessionToken</code> as <code>Authorization: Bearer &lt;sessionToken&gt;</code></li>
	            <li><strong>Step 5:</strong> Call <code>GET /tool/hello</code> and <code>GET /tool/private-signal</code></li>
	          </ol>
	        </div>
	      </div>

	      <!-- Admin Instructions -->
	      <div class="card">
	        <h2><span class="icon">👤</span> Admin / Demo Instructions</h2>
	        <div class="instructions">
	          <ol>
	            <li>Add your agent's ENS name using the policy form</li>
	            <li>Select which tools the agent is allowed to access</li>
	            <li>Connect a wallet whose address matches that ENS record</li>
	            <li>Sign the SIWE challenge in the wallet popup</li>
	            <li>Call protected tools and watch recent events update after page refresh</li>
	          </ol>
	        </div>
	      </div>
	    </div>
	  </div>

	</div>
	<script>
	  (function () {
	    var address = "";
	    var sessionToken = "";
	    var connectBtn = document.getElementById("connectWalletBtn");
	    var signInBtn = document.getElementById("signInBtn");
	    var callToolsBtn = document.getElementById("callToolsBtn");
	    var ensInput = document.getElementById("demoEnsName");
	    var addressEl = document.getElementById("demoAddress");
	    var reverseEl = document.getElementById("demoReverseEns");
	    var sessionEl = document.getElementById("demoSession");
	    var messageEl = document.getElementById("challengeMessage");
	    var logEl = document.getElementById("demoLog");

	    function log(message, data) {
	      var line = "[" + new Date().toLocaleTimeString() + "] " + message;
	      if (data !== undefined) line += "\\n" + JSON.stringify(data, null, 2);
	      logEl.textContent = logEl.textContent === "Ready." ? line : logEl.textContent + "\\n\\n" + line;
	      logEl.scrollTop = logEl.scrollHeight;
	    }

	    function shortAddress(value) {
	      return value ? value.slice(0, 6) + "..." + value.slice(-4) : "not connected";
	    }

	    function resetSessionState(reason) {
	      sessionToken = "";
	      messageEl.value = "";
	      sessionEl.textContent = reason || "not signed in";
	      callToolsBtn.disabled = true;
	    }

	    /* ── wallet button state helper ──────────────────── */
	    function updateConnectButton(connected) {
	      if (connected) {
	        connectBtn.textContent = "Connected ✓";
	        connectBtn.classList.remove("btn-primary");
	        connectBtn.classList.add("btn-connected");
	      } else {
	        connectBtn.textContent = "Connect Wallet";
	        connectBtn.classList.remove("btn-connected");
	        connectBtn.classList.add("btn-primary");
	      }
	    }

	    async function requestJson(path, options) {
	      var response = await fetch(path, options || {});
	      var text = await response.text();
	      var body = text ? JSON.parse(text) : {};
	      if (!response.ok) {
	        var error = new Error(body.error || "request_failed");
	        error.body = body;
	        throw error;
	      }
	      return body;
	    }

	    async function reverseResolveEns() {
	      reverseEl.textContent = "checking...";
	      var result = await requestJson("/auth/reverse-ens?address=" + encodeURIComponent(address));
	      if (result.ensName && result.forwardMatch) {
	        ensInput.value = result.ensName;
	        reverseEl.textContent = result.ensName;
	        log("Reverse ENS resolved and forward-verified.", result);
	        return;
	      }
	      if (result.ensName) {
	        ensInput.value = result.ensName;
	        reverseEl.textContent = result.ensName + " (forward mismatch)";
	        log("Reverse ENS found, but forward verification did not match this address.", result);
	        return;
	      }
	      reverseEl.textContent = "not found";
	      log("No reverse ENS name found for connected wallet.", result);
	    }

	    async function setConnectedAccount(nextAddress, source) {
	      address = nextAddress || "";
	      addressEl.textContent = shortAddress(address);
	      signInBtn.disabled = !address;
	      updateConnectButton(!!address);
	      resetSessionState("not signed in");
	      if (!address) return;
	      log(source || "Wallet connected.", { address: address });
	      await reverseResolveEns();
	    }

	    connectBtn.addEventListener("click", async function () {
	      try {
	        if (!window.ethereum) {
	          log("No injected wallet found. Install MetaMask, Rabby, or another EIP-1193 wallet.");
	          return;
	        }
	        var accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
	        var connectedAddress = accounts && accounts[0] ? accounts[0] : "";
	        if (!connectedAddress) throw new Error("No wallet account returned.");
	        await setConnectedAccount(connectedAddress, "Wallet connected.");
	      } catch (err) {
	        reverseEl.textContent = "failed";
	        log("Wallet connection failed.", err.body || { error: err.message });
	      }
	    });

	    signInBtn.addEventListener("click", async function () {
	      try {
	        var ensName = ensInput.value.trim();
	        if (!address) throw new Error("Connect a wallet first.");
	        if (!ensName) throw new Error("Enter an ENS name before signing.");

	        sessionEl.textContent = "requesting challenge...";
	        var challenge = await requestJson("/auth/challenge", {
	          method: "POST",
	          headers: { "content-type": "application/json" },
	          body: JSON.stringify({ ensName: ensName, address: address })
	        });
	        messageEl.value = challenge.message || "";
	        log("Challenge received. Wallet signature request will open next.", challenge);

	        sessionEl.textContent = "waiting for signature...";
	        var signature = await window.ethereum.request({
	          method: "personal_sign",
	          params: [challenge.message, address]
	        });
	        log("Message signed.", { signature: signature });

	        sessionEl.textContent = "verifying...";
	        var verify = await requestJson("/auth/verify", {
	          method: "POST",
	          headers: { "content-type": "application/json" },
	          body: JSON.stringify({ ensName: ensName, address: address, signature: signature })
	        });
	        sessionToken = verify.sessionToken;
	        sessionEl.textContent = "active for " + verify.ensName;
	        callToolsBtn.disabled = false;
	        log("Session verified.", verify);
	      } catch (err) {
	        sessionEl.textContent = "failed";
	        log("Sign-in failed.", err.body || { error: err.message });
	      }
	    });

	    callToolsBtn.addEventListener("click", async function () {
	      try {
	        if (!sessionToken) throw new Error("Sign in first.");
	        var headers = { authorization: "Bearer " + sessionToken };
	        var hello = await requestJson("/tool/hello", { headers: headers });
	        log("GET /tool/hello", hello);
	        var privateSignal = await requestJson("/tool/private-signal", { headers: headers });
	        log("GET /tool/private-signal", privateSignal);
	      } catch (err) {
	        log("Tool call failed.", err.body || { error: err.message });
	      }
	    });

	    if (window.ethereum) {
	      window.ethereum.request({ method: "eth_accounts" })
	        .then(function (accounts) {
	          var connectedAddress = accounts && accounts[0] ? accounts[0] : "";
	          if (connectedAddress) {
	            return setConnectedAccount(connectedAddress, "Wallet restored after page reload. Session was reset.");
	          }
	        })
	        .catch(function (err) {
	          log("Silent wallet restore skipped.", { error: err.message });
	        });

	      if (window.ethereum.on) {
	        window.ethereum.on("accountsChanged", function (accounts) {
	          var connectedAddress = accounts && accounts[0] ? accounts[0] : "";
	          reverseEl.textContent = connectedAddress ? "checking..." : "not checked";
	          ensInput.value = connectedAddress ? ensInput.value : "";
	          setConnectedAccount(connectedAddress, connectedAddress ? "Wallet account changed. Session was reset." : "Wallet disconnected.");
	        });
	      }
	    }

	    /* ── live events polling ─────────────────────────── */
	    function escapeHtml(s) {
	      var div = document.createElement("div");
	      div.appendChild(document.createTextNode(s));
	      return div.innerHTML;
	    }

	    function badgeClass(result) {
	      if (result === "allowed") return "badge-active";
	      if (result === "denied") return "badge-suspended";
	      return "badge-info";
	    }

	    function rowClass(result) {
	      if (result === "allowed") return "row-allowed";
	      if (result === "denied") return "row-denied";
	      return "";
	    }

	    function renderEventsTable(events) {
	      if (!events || events.length === 0) {
	        return '<div class="empty-state">No events recorded yet. Authenticate an agent to see activity.</div>';
	      }
	      var html = '<table><thead><tr>';
	      html += '<th>Time</th><th>Type</th><th>ENS Name</th><th>Tool</th><th>Result</th><th>Reason</th>';
	      html += '</tr></thead><tbody>';
	      for (var i = 0; i < events.length; i++) {
	        var e = events[i];
	        html += '<tr class="' + rowClass(e.result) + '">';
	        html += '<td>' + escapeHtml((e.timestamp || "").replace("T", " ").slice(0, 19)) + '</td>';
	        html += '<td>' + escapeHtml(e.type || "") + '</td>';
	        html += '<td>' + escapeHtml(e.ensName || "\u2014") + '</td>';
	        html += '<td>' + escapeHtml(e.tool || "\u2014") + '</td>';
	        html += '<td><span class="badge ' + badgeClass(e.result) + '">' + escapeHtml(e.result || "") + '</span></td>';
	        html += '<td>' + escapeHtml(e.reason || "") + '</td>';
	        html += '</tr>';
	      }
	      html += '</tbody></table>';
	      return html;
	    }

	    var eventsContainer = document.getElementById("eventsContainer");
	    var lastEventsJson = "";

	    function pollEvents() {
	      fetch("/dashboard/events")
	        .then(function (res) { return res.json(); })
	        .then(function (events) {
	          var json = JSON.stringify(events);
	          if (json !== lastEventsJson) {
	            lastEventsJson = json;
	            eventsContainer.innerHTML = renderEventsTable(events);
	          }
	        })
	        .catch(function () { /* silent */ });
	    }

	    setInterval(pollEvents, 5000);
	  })();
	</script>
	</body>
	</html>`;
	}
