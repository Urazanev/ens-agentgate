# ENS AgentGate

ENS AgentGate lets wallet-native agents access protected tools by proving control of an ENS name instead of using static API keys.

## What it does

* creates sign-in challenges
* verifies wallet signatures
* resolves ENS names
* checks ENS-resolved address against signer
* issues short-lived sessions
* gates tools with operator policy (single agents or whole fleets)
* gives each fleet worker its own identity as an ENS subname with its own key
* lets the agent owner revoke a worker on-chain (kill switch), re-checked on every call

## Why this matters

Agents already have wallets and signing keys. Instead of giving them static API keys, services can authenticate them through wallet signatures and ENS identity.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
npm run demo
```

## Environment

Set these in your `.env` file:

```env
AGENT_CHAIN_ID=11155111
AGENT_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ENS_CHAIN_ID=11155111
ENS_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ENS_REVOKE_TTL_SECONDS=15
AGENT_GATE_URL=http://localhost:3001
DEMO_PRIVATE_KEY=
DEMO_ENS_NAME=
```

## Auth flow

1. agent requests challenge
2. agent signs challenge
3. server verifies signature
4. server resolves ENS name
5. server checks resolved address equals signer
6. server creates session
7. session is used for protected tools

## Policy

Access control is managed by `config/policy.json`:

```json
{
  "agents": {
    "myagent1.eth": {
      "status": "active",
      "allowedTools": [
        "hello",
        "private-signal"
      ]
    }
  }
}
```

* `status` can be "active" or "suspended"
* `allowedTools` specifies which endpoints the agent can hit
* a key like `*.myfleet.eth` grants a whole fleet at once (see Fleet Passports)
* Policy is a local demo config, not onchain
* this operator policy is the only thing that **grants** access

## Fleet Passports (ENS subnames as worker identities)

In practice an "agent" is a fleet: an orchestrator plus N workers, and today they all share one private key. One leaked worker key compromises the whole fleet at every service. Fleet Passports fixes this with ENS hierarchy:

* the operator grants access **once to a namespace**: policy entry `*.myfleet.eth`
* the fleet owner spawns workers as subnames (`worker1.myfleet.eth`, ...), **each with its own key**
* firing a worker = one on-chain transaction that zeroes the subname's address record; that worker loses access at every ENS-resolving service, mid-session
* one leaked key now burns one worker, not the fleet

Why this stays safe (no self-granting): the grant lives in the operator's policy and only matches the namespace. Nobody but the root owner can create subnames under `myfleet.eth`, so nobody can join the fleet by themselves. ENS subname ownership IS the attenuation: children can only ever hold what the root vouches for, and the owner can only subtract.

### Enforcement on every call

For each tool call AgentGate re-checks, with a short on-chain read cache:

1. **operator grant**: exact policy entry, or fleet entry `*.root` matching the agent's name
2. **liveness**: the agent's ENS name must still resolve to the session's signer address; a zeroed/removed record denies with `identity_revoked`
3. **kill switch on the agent's name**: `agentgate.revoked = true|1|yes|revoked` denies with `revoked_by_owner`
4. **kill switch on the fleet root**: pauses every worker in the namespace at once, denies with `fleet_paused`

Checks 2-4 are owner-held and strictly subtractive. They can revoke, never grant. If the ENS read itself fails (RPC down), the gate fails open and the operator policy stands alone, so an outage cannot lock out every agent.

Reads are cached for `ENS_REVOKE_TTL_SECONDS` (default 15). The dashboard **↻ Sync from ENS** button drops the caches so a revoke bites on the very next call.

### Fleet CLI

The root owner key (`DEMO_PRIVATE_KEY`) pays for spawn/revoke; workers never need gas. Worker keys are stored in `.fleet/` (gitignored).

```bash
npm run fleet -- spawn worker1      # mint worker1.<root> with a fresh key
npm run demo -- --worker worker1    # sign in and call tools as that worker
npm run fleet -- revoke worker1     # fire it: addr record -> 0x0, access dies
npm run fleet -- restore worker1    # re-hire from the saved key
npm run fleet -- list               # local workers + their on-chain state
```

The fleet root is `DEMO_ENS_NAME` (override with `--root name.eth`). Wrapped (NameWrapper) and unwrapped roots are both supported.

### Whole-fleet pause

```bash
npm run killswitch -- myfleet.eth on    # sets agentgate.revoked=true on the root
npm run killswitch -- myfleet.eth off
```

One text record on the root pauses every worker (`fleet_paused`); clearing it resumes them. Useful as the emergency brake while you rotate keys or investigate.

## Dashboard

Navigate to `http://localhost:3001/dashboard` to:

* connect a wallet, sign in (SIWE), and call protected tools from the browser
* add / update / remove agents and pick their allowed tools
* see each agent's on-chain kill-switch state in the **Kill switch (ENS)** column, and **↻ Sync from ENS** to re-read it
* watch a live event log

## API

* `POST /auth/challenge`
* `POST /auth/verify`
* `GET /auth/me`
* `GET /auth/reverse-ens?address=0x...` (reverse + forward check, for the dashboard)
* `GET /auth/resolve-ens?name=foo.eth` (forward resolution; dashboard pre-sign check)
* `GET /tool/hello`
* `GET /tool/private-signal`

## Demo scenarios

Run `npm run demo` and use the dashboard to test different states:

* allowed agent -> tool succeeds (200)
* valid ENS but not in policy -> 403
* valid ENS but tool not allowed -> 403
* no token -> 401

## Deployment notes

* Vercel supported out of the box
* do not deploy private keys (`DEMO_PRIVATE_KEY`)
* filesystem writes are ephemeral on serverless
* for persistent policy use Redis/database later

## Limitations

* in-memory sessions
* local JSON/Redis policy (operator grant); ENS used for identity, liveness and owner-held revocation
* no production hardening
* on-chain reads are cached (revocation bites within `ENS_REVOKE_TTL_SECONDS`, or instantly via "Sync from ENS")
* fleet matching is suffix-based (`*.root` matches any depth)
* no reverse lookup requirement at auth time

## References

* [Coinbase AgentKit](https://docs.cdp.coinbase.com/agent-kit/welcome)
* [ENS documentation](https://docs.ens.domains/)
* [viem documentation](https://viem.sh/)
* [SIWE / EIP-4361](https://eips.ethereum.org/EIPS/eip-4361)
