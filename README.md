# ENS AgentGate

A minimal auth-gated tool service for wallet-native agents.

ENS AgentGate demonstrates one focused flow:

1. An agent requests a sign-in challenge
2. The agent signs it with its wallet signer
3. The service verifies that the ENS-resolved address matches the signing address
4. The agent receives a short-lived in-memory session
5. The agent calls a protected tool
6. The tool responds successfully only after authentication

This is not a marketplace, not a multi-agent system, not a policy platform, and not a full auth provider. It is a small MVP for ENS-based access control for wallet-native agents.

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

Intentionally not included:

* database
* Redis
* JWT auth platform
* refresh tokens
* OAuth
* frontend
* smart contracts
* x402
* Lit
* AXL
* ENSIP-25
* ERC-8004
* policy / role engine

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
AGENT_GATE_URL=http://localhost:3001
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

Protected tool endpoint. Returns `401` without a valid session.

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

# 5. Call the protected tool
curl -s http://localhost:3001/tool/hello \
  -H "authorization: Bearer $TOKEN"
```

If the ENS-resolved address does not match the signing address, `/auth/verify` returns:

* `403 ens_address_mismatch`

No session is created.

---

## Demo client

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
5. call `/tool/hello`
6. call `/tool/hello` without token to confirm `401`

---

## How agents use this service

An agent does not need any special framework-specific integration to talk to ENS AgentGate.

Any agent can use it if it can:

1. send an HTTP request to `/auth/challenge`
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
* no role or policy enforcement yet
* no ENS text record authorization yet
* no reverse lookup requirement
* one tool only
* one happy path
* one fail path

Auth is currently based on one simple rule:

**ENS-resolved address must match the signing address**

If a name has no valid address record, authentication fails.

---

## What currently works

* `npm run dev` starts the server
* `POST /auth/challenge` returns a valid sign-in message and nonce
* the message can be signed with any EIP-191 compatible wallet signer
* `POST /auth/verify` checks both signature validity and ENS resolution
* address mismatch blocks authentication
* successful verification creates a session
* `GET /auth/me` works only with a valid bearer token
* `GET /tool/hello` works only with a valid bearer token
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
   Reuse the same `requireSession` middleware

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
