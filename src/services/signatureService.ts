import { recoverMessageAddress, type Address, type Hex } from "viem";

export async function recoverSigner(message: string, signature: Hex): Promise<Address> {
  return recoverMessageAddress({ message, signature });
}
