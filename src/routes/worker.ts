import type { FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "viem";
import { checkToolAccess } from "../services/policyService.js";
import { addEvent } from "../services/eventLog.js";

// The agent's own page. A worker opens this in its own tab and calls its tools;
// the page shows the real gate decision. When the owner revokes the worker (in
// the dashboard or via the CLI), the next call here flips to denied. Read-only:
// it never signs or holds keys, it only resolves the gate decision by address.

const FLEET_DIR = resolve(process.cwd(), ".fleet");
const TOOLS = ["hello", "private-signal"];

interface WorkerInfo {
  label: string;
  name: string;
  address: Address;
}

function loadWorker(label: string): WorkerInfo | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(label)) return null; // guard against path traversal
  const file = resolve(FLEET_DIR, `${label}.json`);
  if (!file.startsWith(FLEET_DIR) || !existsSync(file)) return null;
  try {
    const w = JSON.parse(readFileSync(file, "utf-8")) as { name: string; address: string };
    return { label, name: w.name, address: w.address as Address };
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function registerWorkerRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /worker/:label ── the agent's own console ─────────────────────────
  app.get("/worker/:label", async (req, reply) => {
    const { label } = req.params as { label: string };
    const w = loadWorker(label);
    if (!w) {
      return reply
        .code(404)
        .type("text/html; charset=utf-8")
        .send(renderNotFound(label));
    }
    return reply.type("text/html; charset=utf-8").send(renderWorkerPage(w));
  });

  // ── POST /worker/:label/run ── run the real gate check for this worker ────
  app.post("/worker/:label/run", async (req, reply) => {
    const { label } = req.params as { label: string };
    const w = loadWorker(label);
    if (!w) return reply.code(404).send({ ok: false, error: "unknown_worker" });

    const results = [];
    for (const tool of TOOLS) {
      const r = await checkToolAccess(w.name, tool, w.address);
      addEvent({
        type: r.allowed ? "tool_allowed" : "tool_denied",
        ensName: w.name,
        address: w.address,
        tool,
        result: r.allowed ? "allowed" : "denied",
        reason: `${r.reason} · worker page`,
      });
      results.push({
        tool,
        status: r.allowed ? 200 : 403,
        allowed: r.allowed,
        reason: r.reason,
        response: r.allowed
          ? { ok: true, tool, message: `hello, authorized agent ${w.name}` }
          : { ok: false, error: "policy_denied", reason: r.reason },
      });
    }
    return reply.send({ ok: true, ensName: w.name, address: w.address, results });
  });
}

// ─── HTML ─────────────────────────────────────────────────────────────────

const STYLE = `
  :root{--bg:#0f1117;--surface:#1a1d27;--surface2:#242836;--border:#2e3344;--text:#e4e6ed;--dim:#8b8fa3;--accent:#6c63ff;--green:#34d399;--red:#f87171;--mono:"JetBrains Mono","Fira Code",monospace;--font:"Inter",-apple-system,system-ui,sans-serif;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:var(--font);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:32px;max-width:560px;width:100%;}
  .tag{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:8px;}
  h1{font-family:var(--mono);font-size:22px;font-weight:600;word-break:break-all;}
  .addr{font-family:var(--mono);font-size:12px;color:var(--dim);margin-top:6px;word-break:break-all;}
  .sub{color:var(--dim);font-size:14px;line-height:1.6;margin:16px 0;}
  .btn{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:12px 20px;font-size:15px;font-weight:600;cursor:pointer;font-family:var(--font);}
  .btn:disabled{opacity:.5;cursor:not-allowed;}
  .status{margin:16px 0 8px;font-weight:600;font-size:14px;min-height:20px;}
  .status.ok{color:var(--green);}
  .status.bad{color:var(--red);}
  .out{background:#090b10;border:1px solid var(--border);border-radius:8px;padding:14px;font-family:var(--mono);font-size:12px;line-height:1.5;white-space:pre-wrap;max-height:320px;overflow:auto;}
  .hint{color:var(--dim);font-size:12px;line-height:1.6;margin-top:16px;}
`;

function renderWorkerPage(w: WorkerInfo): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agent · ${esc(w.name)}</title>
<style>${STYLE}</style>
</head><body>
<div class="card">
  <div class="tag">⛓ Agent Worker</div>
  <h1>${esc(w.name)}</h1>
  <div class="addr">${esc(w.address)}</div>
  <p class="sub">This is the agent's own view. It calls the protected tools through ENS AgentGate, authenticated by its ENS identity.</p>
  <button id="run" class="btn">Call my tools</button>
  <div id="status" class="status"></div>
  <pre id="out" class="out">Ready.</pre>
  <p class="hint">To revoke this worker, open the AgentGate dashboard and hit Revoke on its row. Then come back and call again.</p>
</div>
<script>
  (function(){
    var btn=document.getElementById('run');
    var out=document.getElementById('out');
    var status=document.getElementById('status');
    btn.addEventListener('click', async function(){
      btn.disabled=true; status.textContent='calling...'; status.className='status';
      try {
        var res=await fetch(${JSON.stringify(`/worker/${w.label}/run`)}, {method:'POST'});
        var body=await res.json();
        var ok = body.results && body.results.length > 0 && body.results.every(function(r){return r.allowed;});
        status.textContent = ok ? 'ACCESS GRANTED' : 'ACCESS DENIED';
        status.className = 'status ' + (ok ? 'ok' : 'bad');
        out.textContent = JSON.stringify(body.results, null, 2);
      } catch(e){
        status.textContent='error'; status.className='status bad';
        out.textContent=String(e);
      }
      btn.disabled=false;
    });
  })();
</script>
</body></html>`;
}

function renderNotFound(label: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>Worker not found</title><style>${STYLE}</style></head>
<body><div class="card">
  <div class="tag">⛓ Agent Worker</div>
  <h1>Not found</h1>
  <p class="sub">No worker <code>${esc(label)}</code> exists. Spawn one first:</p>
  <pre class="out">npm run fleet -- spawn ${esc(label.replace(/[^a-zA-Z0-9_-]/g, "") || "worker1")}</pre>
</div></body></html>`;
}
