# ENS AgentGate

A minimal auth-gated tool service for wallet-native agents.

ENS AgentGate demonstrates one focused flow:

1. An agent requests a sign-in challenge
2. The agent signs it with its wallet signer
3. The service verifies that the ENS-resolved address matches the signing address
4. The agent receives a short-lived in-memory session
5. Policy checks whether the ENS name is allowed to call the requested tool
6. The tool responds successfully only after authentication **and** policy authorization

---

## Why wallet-native auth instead of API keys

Traditional services issue API keys to humans. An agent is not a human. A wallet-native agent already has:

* a wallet
* an onchain identity
* a signing capability

ENS AgentGate uses that identity directly. Access is granted not to the holder of a secret API key, but to the party that can prove control of the wallet address that the ENS name resolves to.

That means:

* no manually issued client secrets
* no API key rotation flow
* no custom identity database
* no separate auth identity that drifts away from the wallet identity

Any wallet-native agent can interact with this service as long as it can:

* request a challenge
* sign a message
* prove control of an ENS name
* send authenticated HTTP requests with the returned session token

---

## Stack

* Node.js
* TypeScript
* Fastify
* viem
* zod
* dotenv
* in-memory `Map` storage for challenges and sessions
* local `config/policy.json` for access control

Intentionally not included:

* database
* Redis
* JWT auth platform
* refresh tokens
* OAuth
* frontend framework
* smart contracts
* x402
* Lit
* AXL
* ENSIP-25
* ERC-8004

---

## Installation

```bash
npm install
cp .env.example .env
# edit .env
npm run dev
```

The server listens on `http://localhost:3001`.

---

## Environment variables

```env
PORT=3001
APP_DOMAIN=localhost:3001
APP_URI=http://localhost:3001

# Agent signing / execution chain
AGENT_CHAIN_ID=11155111
AGENT_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com

# ENS resolution chain
ENS_CHAIN_ID=11155111
ENS_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ENS_UNIVERSAL_RESOLVER_ADDRESS=

CHALLENGE_TTL_SECONDS=300
SESSION_TTL_SECONDS=1800
LOG_LEVEL=info

# Demo client
DEMO_PRIVATE_KEY=
DEMO_ENS_NAME=
TOOL_GATE_URL=http://localhost:3001
```

---

## Agent chain vs ENS resolution chain

These are modeled separately, even if they currently point to the same network in this MVP.

* **Agent chain**
  The chain where the wallet-native agent signs messages

* **ENS resolution chain**
  The chain used to resolve ENS names through the standard ENS registry and Universal Resolver flow

For this MVP we use **standard Sepolia ENS**, not the ENS App Alpha / ENSv2 dev flow.

---

## ENSv2-ready notes

This project follows the modern ENS resolution path.

* ENS resolution goes through `viem.getEnsAddress()`
* under the hood, this uses the Universal Resolver
* names are normalized with `normalize` from `viem/ens`
* the Universal Resolver address is not hardcoded and can be overridden through env
* the code does not assume ENS is only for `.eth` names
* reverse resolution is not required for auth

This MVP does **not** yet implement:

* ENS text record policies
* namespace checks
* role / status checks
* ENSIP-25
* ERC-8004
* subname issuance
* reputation layers

Those can be added later without changing the core auth flow.

---

## Policy file

### config/policy.json

This local JSON file defines which ENS-verified agents can access which tools.

```json
{
  "agents": {
    "myagent1.eth": {
      "status": "active",
      "allowedTools": ["hello", "private-signal"],
      "label": "Main demo agent"
    },
    "bot.myagent1.eth": {
      "status": "active",
      "allowedTools": ["hello"],
      "label": "Limited sub-agent"
    }
  }
}
```

**Keys:**

* **ENS name** — used as the agent identifier
* **status** — `"active"` or `"suspended"`
* **allowedTools** — array of tool IDs the agent may call
* **label** — optional human-readable description

**Auth + policy rule:**

1. ENS-resolved address must match the signer address (identity verification)
2. The ENS name must exist in policy with `status: "active"` and the requested tool in `allowedTools` (authorization)

**Important:**

* `policy.json` is a local demo policy, not an onchain policy
* ENS still proves identity — policy decides what that identity can access
* No server restart required when editing through the dashboard
* ENS names are normalized before lookup

---

## Protected tools

| Tool ID | Endpoint | Description |
|---|---|---|
| `hello` | `GET /tool/hello` | Returns a greeting for authorized agents |
| `private-signal` | `GET /tool/private-signal` | Returns a private signal for authorized agents |

Both tools require:

1. Valid session token (`Authorization: Bearer <token>`)
2. Policy allows the ENS name to call the specific tool

**Response if authorized (200):**

```json
{
  "ok": true,
  "tool": "hello",
  "message": "hello, authorized agent myagent.eth",
  "ensName": "myagent.eth",
  "address": "0x..."
}
```

**Response if session valid but policy denies (403):**

```json
{
  "ok": false,
  "error": "policy_denied",
  "reason": "tool_not_allowed"
}
```

**Possible denial reasons:**

* `agent_not_in_policy` — ENS name is not listed in policy.json
* `agent_suspended` — agent exists but status is "suspended"
* `tool_not_allowed` — agent is active but the tool is not in allowedTools

---

## Dashboard

### GET /dashboard

A server-rendered admin UI for managing policy and monitoring events.

**Features:**

1. **Protected Tools** — lists available tool endpoints
2. **Current Policy** — table of all configured agents with their status and allowed tools
3. **Add / Update Agent** — form to add or modify an agent's access
4. **Remove Agent** — remove an agent from policy
5. **Recent Events** — last 20 auth/tool/policy events with color-coded results
6. **Agent Instructions** — copy-paste guide for agent authentication
7. **Admin Instructions** — how to configure and test the demo

**Dashboard routes:**

* `GET /dashboard` — renders the dashboard
* `POST /dashboard/agents` — add or update an agent
* `POST /dashboard/agents/remove` — remove an agent

**No server restart required** — changes through the dashboard update `policy.json` immediately.

---

## HTTP API

### `POST /auth/challenge`

Request body:

```json
{ "ensName": "trader.alice.eth", "address": "0x..." }
```

Response:

```json
{
  "ok": true,
  "message": "<EIP-4361 sign-in message>",
  "nonce": "<hex>",
  "expiresAt": "<iso>"
}
```

### `POST /auth/verify`

Request body:

```json
{ "ensName": "trader.alice.eth", "address": "0x...", "signature": "0x..." }
```

The server verifies:

1. an active challenge exists for `(ensName, address)`
2. the challenge is not expired
3. the challenge has not already been used
4. `recoverMessageAddress(challenge.message, signature)` matches `address`
5. ENS resolution of `ensName` returns the same address

Response:

```json
{
  "ok": true,
  "sessionToken": "<opaque hex>",
  "expiresAt": "<iso>",
  "ensName": "trader.alice.eth",
  "address": "0x..."
}
```

### `GET /auth/me`

Header:

```text
Authorization: Bearer <sessionToken>
```

Returns session information if the token is valid, otherwise `401`.

### `GET /tool/hello`

Header:

```text
Authorization: Bearer <sessionToken>
```

Protected tool endpoint. Returns `401` without a valid session. Returns `403` if policy denies access.

### `GET /tool/private-signal`

Header:

```text
Authorization: Bearer <sessionToken>
```

Protected tool endpoint. Returns `401` without a valid session. Returns `403` if policy denies access.

---

## Error format

All error responses are JSON in this shape:

```json
{ "ok": false, "error": "<code>", ... }
```

Possible codes include:

* `invalid_input`
* `challenge_not_found`
* `challenge_expired`
* `challenge_already_used`
* `invalid_signature`
* `ens_resolution_failed`
* `ens_address_mismatch`
* `unauthorized`
* `policy_denied`

---

## Full happy-path example with curl

```bash
# 1. Request a challenge
curl -s -X POST http://localhost:3001/auth/challenge \
  -H 'content-type: application/json' \
  -d '{"ensName":"trader.alice.eth","address":"0xYOURADDRESS"}'

# 2. Sign the "message" field from the response using any EIP-191 compatible signer
#    Examples:
#    - viem account.signMessage
#    - ethers wallet.signMessage
#    - MetaMask personal_sign

# 3. Verify the signature
curl -s -X POST http://localhost:3001/auth/verify \
  -H 'content-type: application/json' \
  -d '{"ensName":"trader.alice.eth","address":"0xYOURADDRESS","signature":"0xSIG"}'

# 4. Check the current session
curl -s http://localhost:3001/auth/me \
  -H "authorization: Bearer $TOKEN"

# 5. Call the protected tools
curl -s http://localhost:3001/tool/hello \
  -H "authorization: Bearer $TOKEN"

curl -s http://localhost:3001/tool/private-signal \
  -H "authorization: Bearer $TOKEN"
```

If the ENS-resolved address does not match the signing address, `/auth/verify` returns:

* `403 ens_address_mismatch`

No session is created.

---

## Demo flow with policy

### Setup

1. Edit `config/policy.json` to include your ENS name (or use the dashboard)
2. Set `DEMO_PRIVATE_KEY` and `DEMO_ENS_NAME` in `.env`
3. Start the server

### Run

```bash
# terminal 1
npm run dev

# terminal 2
npm run demo
```

`examples/demo-agent-client.ts` runs the full flow:

1. request challenge
2. sign challenge
3. verify challenge
4. fetch `/auth/me`
5. call `/tool/hello` — shows 200 if allowed, 403 if denied
6. call `/tool/private-signal` — shows 200 if allowed, 403 if denied
7. call `/tool/hello` without token to confirm `401`

### Testing allowed vs denied access

To test a **denied** response:

1. Open the dashboard at `http://localhost:3001/dashboard`
2. Edit the agent to remove `private-signal` from allowed tools
3. Click Save Agent
4. Run `npm run demo` again
5. `/tool/private-signal` will return `403 policy_denied` with reason `tool_not_allowed`

To test a **suspended** agent:

1. Update the agent status to `suspended` in the dashboard
2. All tool calls will return `403 policy_denied` with reason `agent_suspended`

To test an **unknown** agent:

1. Remove the agent from policy
2. All tool calls will return `403 policy_denied` with reason `agent_not_in_policy`

---

## How to add an agent through the dashboard

1. Open `http://localhost:3001/dashboard`
2. In the "Add / Update Agent" section:
   * Enter the ENS name
   * Add an optional label
   * Select status (active / suspended)
   * Check the tools the agent should access
3. Click **Save Agent**
4. The agent appears in the Current Policy table immediately
5. No server restart is needed

---

## How an agent calls the service

An agent does not need any special framework-specific integration to talk to ENS AgentGate.

Any agent can use it if it can:

1. send an HTTP request to `/auth/challenge` with `ensName` and `address`
2. sign the returned message with its wallet
3. send the signature to `/auth/verify`
4. store the returned session token
5. include that token in the `Authorization: Bearer <token>` header for protected tool requests

In other words, ENS AgentGate is just an HTTP auth service for wallet-native agents.

---

## Current limitations

* challenge and session stores are fully in memory
* restarting the server clears all sessions and challenges
* session tokens are opaque random strings
* no refresh token logic
* no revocation list
* no rate limiting
* no HTTPS or CORS hardening
* policy is a local JSON file, not onchain
* no ENS text record authorization yet
* no reverse lookup requirement

Auth is based on two rules:

1. **ENS-resolved address must match the signing address** (identity)
2. **ENS name must be allowed by policy for the requested tool** (authorization)

If a name has no valid address record, authentication fails.
If a name is not in policy or not allowed for a tool, the request is denied with `403`.

---

## Deployment

### Vercel

A `vercel.json` is included for serverless deployment.

**Required env vars:**

```env
APP_DOMAIN=<deployed-domain>
APP_URI=https://<deployed-domain>
AGENT_CHAIN_ID=11155111
AGENT_RPC_URL=<sepolia-rpc>
ENS_CHAIN_ID=11155111
ENS_RPC_URL=<sepolia-rpc>
ENS_UNIVERSAL_RESOLVER_ADDRESS=
CHALLENGE_TTL_SECONDS=300
SESSION_TTL_SECONDS=1800
LOG_LEVEL=info
```

**Do NOT set in public deployment:**

```env
DEMO_PRIVATE_KEY=
DEMO_ENS_NAME=
```

`DEMO_PRIVATE_KEY` is only for the local demo client (`npm run demo`). Never deploy it to a public environment unless you fully understand the risk. For public demos, run the signing client locally against the deployed AgentGate URL.

**Important serverless limitation:**

The dashboard writes `config/policy.json` to the local filesystem at runtime. On serverless platforms (Vercel, AWS Lambda), filesystem writes are **ephemeral** and do not persist between invocations. This means:

* dashboard edits will appear to work but may reset on the next cold start
* for production, replace the JSON file store with Redis, a database, or an external config service
* for a static demo deployment, pre-configure `config/policy.json` before deploying

`PORT` is not needed on Vercel — the platform manages port binding automatically.

### Local

```bash
npm install
cp .env.example .env
# edit .env with your values
npm run dev
```

---

## What currently works

* `npm run dev` starts the server
* `POST /auth/challenge` returns a valid sign-in message and nonce
* the message can be signed with any EIP-191 compatible wallet signer
* `POST /auth/verify` checks both signature validity and ENS resolution
* address mismatch blocks authentication
* successful verification creates a session
* `GET /auth/me` works only with a valid bearer token
* `GET /tool/hello` works with valid token + policy allows `hello`
* `GET /tool/private-signal` works with valid token + policy allows `private-signal`
* policy denials return `403 policy_denied`
* `GET /dashboard` renders admin UI for policy management
* dashboard can add, update, and remove agents without server restart
* recent events are visible in the dashboard
* `npm run demo` completes the full flow end to end

---

## Next steps without rewriting the MVP

1. Add an agent-side helper that:

   * requests a challenge
   * signs it with the agent wallet
   * verifies it
   * stores the session token
   * attaches it to protected tool requests

2. Add ENS text-record policy checks
   For example:

   * `agent.role`
   * `agent.status`
   * `agent.allowed-tools`

3. Replace in-memory stores with Redis

4. Add more protected tools
   Reuse the same `requireSession` + `policyGate` pattern

---

## References

* Coinbase AgentKit
  [https://docs.cdp.coinbase.com/agent-kit/welcome](https://docs.cdp.coinbase.com/agent-kit/welcome)
  [https://github.com/coinbase/agentkit](https://github.com/coinbase/agentkit)

* ENS docs
  [https://docs.ens.domains/](https://docs.ens.domains/)
  [https://docs.ens.domains/web/ensv2-readiness](https://docs.ens.domains/web/ensv2-readiness)
  [https://docs.ens.domains/resolution/](https://docs.ens.domains/resolution/)
  [https://docs.ens.domains/resolvers/universal/](https://docs.ens.domains/resolvers/universal/)

* viem
  [https://viem.sh/](https://viem.sh/)
  [https://viem.sh/docs/ens/actions/getEnsAddress](https://viem.sh/docs/ens/actions/getEnsAddress)
  [https://viem.sh/docs/utilities/recoverMessageAddress](https://viem.sh/docs/utilities/recoverMessageAddress)

* SIWE / EIP-4361
  [https://eips.ethereum.org/EIPS/eip-4361](https://eips.ethereum.org/EIPS/eip-4361)

If any implementation detail conflicts with the official documentation, the official documentation takes precedence.
