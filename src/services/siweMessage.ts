import type { Address } from "viem";
import { isoFromMs } from "../utils/time.js";

export interface SiweParams {
  domain: string;
  uri: string;
  address: Address;
  chainId: number;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  ensName: string;
}

const STATEMENT =
  "Sign in to access ENS-gated tool service as a wallet-native agent.";

const VERSION = "1";

/**
 * Builds an EIP-4361 (SIWE) compliant message.
 * The exact byte layout matters: signer must sign this exact string.
 */
export function buildSiweMessage(p: SiweParams): string {
  const lines = [
    `${p.domain} wants you to sign in with your Ethereum account:`,
    p.address,
    "",
    STATEMENT,
    "",
    `URI: ${p.uri}`,
    `Version: ${VERSION}`,
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${isoFromMs(p.issuedAtMs)}`,
    `Expiration Time: ${isoFromMs(p.expiresAtMs)}`,
    `Resources:`,
    `- ens:${p.ensName}`,
  ];
  return lines.join("\n");
}
