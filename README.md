# ENS AgentGate

ENS AgentGate lets wallet-native agents access protected tools by proving control of an ENS name instead of using static API keys.

## What it does

* creates sign-in challenges
* verifies wallet signatures
* resolves ENS names
* checks ENS-resolved address against signer
* issues short-lived sessions
* gates tools with local policy

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
* Policy is a local demo config, not onchain

## Dashboard

Navigate to `http://localhost:3001/dashboard` to:

* add/update/remove agents
* select allowed tools
* view recent events

## API

* `POST /auth/challenge`
* `POST /auth/verify`
* `GET /auth/me`
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
* local JSON policy
* no production hardening
* no ENS text-record policy yet
* no reverse lookup requirement

## References

* [Coinbase AgentKit](https://docs.cdp.coinbase.com/agent-kit/welcome)
* [ENS documentation](https://docs.ens.domains/)
* [viem documentation](https://viem.sh/)
* [SIWE / EIP-4361](https://eips.ethereum.org/EIPS/eip-4361)
