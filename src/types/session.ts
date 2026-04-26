import type { Address } from "viem";

export interface Session {
  token: string;
  ensName: string;
  address: Address;
  createdAt: number;
  expiresAt: number;
}
