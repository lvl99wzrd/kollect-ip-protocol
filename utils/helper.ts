import * as fs from "fs";
import * as crypto from "crypto";
import { PublicKey } from "@solana/web3.js";

export const padBytes = (data: string, length: number): number[] => {
  const bytes = Buffer.from(data);
  const padded = Buffer.alloc(length);
  bytes.copy(padded);
  return Array.from(padded);
};

/**
 * Converts a number to an 8-byte little-endian buffer (u64).
 */
export const indexToLeBuffer = (index: number): Buffer => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(index));
  return buf;
};

/**
 * Derives the CreatorEntityCounter PDA.
 */
export const deriveCounterPda = (
  creator: PublicKey,
  programId: PublicKey,
): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("entity_counter"), creator.toBuffer()],
    programId,
  );
};

/**
 * Derives an Entity PDA from creator and index.
 */
export const deriveEntityPda = (
  programId: PublicKey,
  creator: PublicKey,
  index: number,
): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("entity"), creator.toBuffer(), indexToLeBuffer(index)],
    programId,
  );
};

/**
 * Fetches the current entity count for a creator from on-chain counter.
 * Returns 0 if the counter PDA doesn't exist yet.
 */
export const getEntityCount = async (
  program: any,
  creator: PublicKey,
): Promise<number> => {
  const [counterPda] = deriveCounterPda(creator, program.programId);
  try {
    const counter = await program.account.creatorEntityCounter.fetch(
      counterPda,
    );
    return counter.entityCount.toNumber();
  } catch {
    return 0;
  }
};

/**
 * Computes SHA-256 hash of a buffer.
 * @param buffer - The buffer to hash
 * @returns 32-byte hash as number[]
 */
export const hashBuffer = (buffer: Buffer): number[] => {
  const hash = crypto.createHash("sha256").update(buffer).digest();
  return Array.from(hash);
};

/**
 * Computes SHA-256 hash of a file.
 * @param filePath - Absolute or relative path to the file
 * @returns 32-byte hash as number[]
 */
export const hashFile = (filePath: string): number[] => {
  const buffer = fs.readFileSync(filePath);
  return hashBuffer(buffer);
};
