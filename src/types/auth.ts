import type { Address, Hex } from "viem";

export interface Challenge {
  nonce: string;
  ensName: string;
  address: Address;
  message: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface ChallengeRequest {
  ensName: string;
  address: Address;
}

export interface VerifyRequest {
  ensName: string;
  address: Address;
  signature: Hex;
}
