import * as fs from "fs";
import * as crypto from "crypto";

export const padBytes = (data: string, length: number): number[] => {
  const bytes = Buffer.from(data);
  const padded = Buffer.alloc(length);
  bytes.copy(padded);
  return Array.from(padded);
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
