import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAddress, type Address, type Hex } from "viem";
import { env } from "../utils/env.js";
import { addSeconds, isoFromMs, nowMs } from "../utils/time.js";
import { logger } from "../utils/logger.js";
import {
  findLatestActive,
  markUsed,
  newNonce,
  putChallenge,
} from "../services/challengeStore.js";
import { createSession } from "../services/sessionStore.js";
import { buildSiweMessage } from "../services/siweMessage.js";
import {
  EnsResolutionError,
  addressesEqual,
  normalizeEnsName,
  resolveEnsAddress,
} from "../services/ensService.js";
import { recoverSigner } from "../services/signatureService.js";
import { requireSession } from "../middleware/requireSession.js";

const addressSchema = z
  .string()
  .refine((v) => isAddress(v), "must be a 0x-prefixed EVM address");

const challengeSchema = z.object({
  ensName: z.string().min(3).max(255),
  address: addressSchema,
});

const verifySchema = z.object({
  ensName: z.string().min(3).max(255),
  address: addressSchema,
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, "signature must be 0x-prefixed hex"),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/challenge", async (req, reply) => {
    const parsed = challengeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_input",
        details: parsed.error.flatten(),
      });
    }

    let normalized: string;
    try {
      normalized = normalizeEnsName(parsed.data.ensName);
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_input",
        reason: "ens_name_normalization_failed",
        details: (err as Error).message,
      });
    }

    const address = parsed.data.address as Address;
    const nonce = newNonce();
    const issuedAtMs = nowMs();
    const expiresAtMs = addSeconds(issuedAtMs, env.challengeTtlSec);

    const message = buildSiweMessage({
      domain: env.appDomain,
      uri: env.appUri,
      address,
      chainId: env.agentChainId,
      nonce,
      issuedAtMs,
      expiresAtMs,
      ensName: normalized,
    });

    putChallenge({
      nonce,
      ensName: normalized,
      address,
      message,
      createdAt: issuedAtMs,
      expiresAt: expiresAtMs,
      used: false,
    });

    logger.info("auth.challenge.issued", { ensName: normalized, address, nonce });

    return reply.send({
      ok: true,
      message,
      nonce,
      expiresAt: isoFromMs(expiresAtMs),
    });
  });

  app.post("/auth/verify", async (req, reply) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_input",
        details: parsed.error.flatten(),
      });
    }

    const providedAddress = parsed.data.address as Address;
    const signature = parsed.data.signature as Hex;

    let normalized: string;
    try {
      normalized = normalizeEnsName(parsed.data.ensName);
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_input",
        reason: "ens_name_normalization_failed",
        details: (err as Error).message,
      });
    }

    const challenge = findLatestActive(normalized, providedAddress);
    if (!challenge) {
      return reply.code(404).send({ ok: false, error: "challenge_not_found" });
    }
    if (challenge.expiresAt <= nowMs()) {
      return reply.code(410).send({ ok: false, error: "challenge_expired" });
    }

    let recovered: Address;
    try {
      recovered = await recoverSigner(challenge.message, signature);
    } catch (err) {
      return reply.code(400).send({
        ok: false,
        error: "invalid_signature",
        details: (err as Error).message,
      });
    }

    if (!addressesEqual(recovered, providedAddress)) {
      return reply.code(401).send({
        ok: false,
        error: "invalid_signature",
        reason: "recovered_signer_mismatch",
        recovered,
        provided: providedAddress,
      });
    }

    let resolved: Address | null;
    try {
      resolved = await resolveEnsAddress(normalized);
    } catch (err) {
      const e = err as EnsResolutionError;
      return reply.code(502).send({
        ok: false,
        error: "ens_resolution_failed",
        details: e.message,
      });
    }
    if (!resolved) {
      return reply.code(404).send({
        ok: false,
        error: "ens_resolution_failed",
        reason: "no_address_record",
      });
    }
    if (!addressesEqual(resolved, providedAddress)) {
      return reply.code(403).send({
        ok: false,
        error: "ens_address_mismatch",
        ensResolved: resolved,
        provided: providedAddress,
      });
    }

    markUsed(challenge.nonce);
    const session = createSession(normalized, providedAddress);

    logger.info("auth.verify.ok", {
      ensName: normalized,
      address: providedAddress,
      nonce: challenge.nonce,
    });

    return reply.send({
      ok: true,
      sessionToken: session.token,
      expiresAt: isoFromMs(session.expiresAt),
      ensName: session.ensName,
      address: session.address,
    });
  });

  app.get("/auth/me", { preHandler: requireSession }, async (req, reply) => {
    const s = req.session!;
    return reply.send({
      ok: true,
      ensName: s.ensName,
      address: s.address,
      expiresAt: isoFromMs(s.expiresAt),
    });
  });
}
