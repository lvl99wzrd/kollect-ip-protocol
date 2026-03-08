/**
 * Register Metadata Schema Script
 *
 * Creates a new metadata schema on-chain.
 *
 * Usage:
 *   SCHEMA_ID=<id> VERSION=<version> SCHEMA_JSON=<path> anchor run register_schema --provider.cluster devnet
 *
 * Environment Variables:
 *   SCHEMA_ID   - Unique schema identifier (e.g., "entity.metadata.v1")
 *   VERSION     - Schema version (e.g., "1.0.0")
 *   SCHEMA_JSON - Path to JSON file containing { cid: "...", schema: {...} }
 *
 * Example:
 *   SCHEMA_ID="entity.metadata.v1" VERSION="1.0.0" SCHEMA_JSON="utils/metadata-schema/entity.metadata.v1.json" anchor run register_schema --provider.cluster devnet
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";
import { IpCore } from "../target/types/ip_core";

// Constants matching on-chain field sizes
const MAX_SCHEMA_ID_LENGTH = 32;
const MAX_VERSION_LENGTH = 16;
const MAX_CID_LENGTH = 96;

/**
 * Pads a string to a fixed-length byte array.
 */
const padBytes = (data: string, length: number): number[] => {
  const bytes = Buffer.from(data);
  if (bytes.length > length) {
    throw new Error(
      `Input "${data}" exceeds maximum length of ${length} bytes`,
    );
  }
  const padded = Buffer.alloc(length);
  bytes.copy(padded);
  return Array.from(padded);
};

/**
 * Computes SHA-256 hash of a JSON object.
 */
const hashSchema = (schema: object): number[] => {
  const json = JSON.stringify(schema);
  const hash = crypto.createHash("sha256").update(json).digest();
  return Array.from(hash);
};

/**
 * Gets the Solana explorer URL for a transaction.
 */
const getExplorerUrl = (signature: string, cluster: string): string => {
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${clusterParam}`;
};

async function main() {
  // Validate environment variables
  const schemaId = process.env.SCHEMA_ID;
  const version = process.env.VERSION;
  const schemaJsonPath = process.env.SCHEMA_JSON;

  if (!schemaId) {
    throw new Error("SCHEMA_ID environment variable is required");
  }
  if (!version) {
    throw new Error("VERSION environment variable is required");
  }
  if (!schemaJsonPath) {
    throw new Error("SCHEMA_JSON environment variable is required");
  }

  // Validate input lengths
  if (Buffer.from(schemaId).length > MAX_SCHEMA_ID_LENGTH) {
    throw new Error(
      `SCHEMA_ID exceeds maximum length of ${MAX_SCHEMA_ID_LENGTH} bytes`,
    );
  }
  if (Buffer.from(version).length > MAX_VERSION_LENGTH) {
    throw new Error(
      `VERSION exceeds maximum length of ${MAX_VERSION_LENGTH} bytes`,
    );
  }

  // Read and parse schema JSON file
  if (!fs.existsSync(schemaJsonPath)) {
    throw new Error(`Schema JSON file not found: ${schemaJsonPath}`);
  }

  const schemaJsonContent = fs.readFileSync(schemaJsonPath, "utf-8");
  let schemaJson: { cid: string; schema: object };

  try {
    schemaJson = JSON.parse(schemaJsonContent);
  } catch (err) {
    throw new Error(`Failed to parse schema JSON: ${err}`);
  }

  // Validate schema JSON structure
  if (!schemaJson.cid || typeof schemaJson.cid !== "string") {
    throw new Error('Schema JSON must contain a "cid" field (string)');
  }
  if (!schemaJson.schema || typeof schemaJson.schema !== "object") {
    throw new Error('Schema JSON must contain a "schema" field (object)');
  }

  if (Buffer.from(schemaJson.cid).length > MAX_CID_LENGTH) {
    throw new Error(`CID exceeds maximum length of ${MAX_CID_LENGTH} bytes`);
  }

  // Setup Anchor provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.IpCore as Program<IpCore>;

  const cluster = provider.connection.rpcEndpoint.includes("devnet")
    ? "devnet"
    : provider.connection.rpcEndpoint.includes("mainnet")
    ? "mainnet-beta"
    : "localnet";

  console.log("=".repeat(60));
  console.log("Register Metadata Schema");
  console.log("=".repeat(60));
  console.log(`Cluster:   ${cluster}`);
  console.log(`Creator:   ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Schema ID: ${schemaId}`);
  console.log(`Version:   ${version}`);
  console.log(`CID:       ${schemaJson.cid}`);
  console.log("-".repeat(60));

  // Prepare instruction parameters
  const schemaIdBytes = padBytes(schemaId, MAX_SCHEMA_ID_LENGTH);
  const versionBytes = padBytes(version, MAX_VERSION_LENGTH);
  const schemaHash = hashSchema(schemaJson.schema);
  const cidBytes = padBytes(schemaJson.cid, MAX_CID_LENGTH);

  // Derive PDA
  const [schemaPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata_schema"),
      Buffer.from(schemaIdBytes),
      Buffer.from(versionBytes),
    ],
    program.programId,
  );

  console.log(`Schema PDA: ${schemaPda.toBase58()}`);

  // Check if schema already exists
  const existingSchema = await provider.connection.getAccountInfo(schemaPda);
  if (existingSchema) {
    console.log("\nSchema already exists at this PDA.");
    console.log("Schemas are unique per (id, version) combination.");
    process.exit(0);
  }

  // Create the schema
  console.log("\nCreating metadata schema...");

  const signature = await program.methods
    .createMetadataSchema(schemaIdBytes, versionBytes, schemaHash, cidBytes)
    .rpc();

  console.log("\nSchema created successfully!");
  console.log(`Transaction: ${signature}`);
  console.log(`Explorer:    ${getExplorerUrl(signature, cluster)}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
