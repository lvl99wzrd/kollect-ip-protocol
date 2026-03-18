/**
 * Get Metadata Accounts Script
 *
 * Fetches and displays all metadata accounts, or a single metadata account
 * when METADATA_PUBKEY is provided.
 *
 * Usage:
 *   # All metadata accounts
 *   anchor run get_metadata --provider.cluster devnet
 *
 *   # All metadata accounts filtered by schema
 *   SCHEMA_PUBKEY=<pubkey> anchor run get_metadata --provider.cluster devnet
 *
 *   # Single metadata account by PDA pubkey
 *   METADATA_PUBKEY=<pubkey> anchor run get_metadata --provider.cluster devnet
 *
 * Environment Variables:
 *   METADATA_PUBKEY  (optional) - PDA public key of an existing metadata account
 *   SCHEMA_PUBKEY    (optional) - PDA public key of a schema to filter by (fetch-all only)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { IpCore } from "../target/types/ip_core";

/**
 * Decodes a fixed-length byte array to a trimmed UTF-8 string.
 */
const decodeBytes = (bytes: number[] | Uint8Array): string =>
  Buffer.from(bytes).toString("utf-8").replace(/\0/g, "");

/**
 * Encodes a fixed-length byte array to a lowercase hex string.
 */
const toHex = (bytes: number[] | Uint8Array): string =>
  Buffer.from(bytes).toString("hex");

/**
 * Returns a Solana Explorer address URL for the given cluster.
 */
const explorerUrl = (address: string, cluster: string): string =>
  cluster === "mainnet-beta"
    ? `https://explorer.solana.com/address/${address}`
    : `https://explorer.solana.com/address/${address}?cluster=${cluster}`;

/**
 * Returns a human-readable label for the parent type enum.
 */
const parentTypeLabel = (parentType: Record<string, unknown>): string => {
  if ("entity" in parentType) return "Entity";
  if ("ip" in parentType) return "IP";
  return JSON.stringify(parentType);
};

/**
 * Prints a single metadata account's state to stdout.
 */
function printMetadata(
  pubkey: PublicKey,
  meta: {
    schema: PublicKey;
    hash: number[];
    cid: number[];
    parentType: Record<string, unknown>;
    parent: PublicKey;
    revision: anchor.BN;
    createdAt: anchor.BN;
    bump: number;
  },
  cluster: string,
  index?: number,
): void {
  const prefix = index !== undefined ? `[${index + 1}] ` : "";
  console.log(`\n${prefix}PDA: ${pubkey.toBase58()}`);
  console.log(`  Schema:       ${meta.schema.toBase58()}`);
  console.log(`  Hash:         ${toHex(meta.hash)}`);
  console.log(`  CID:          ${decodeBytes(meta.cid)}`);
  console.log(`  Parent Type:  ${parentTypeLabel(meta.parentType)}`);
  console.log(`  Parent:       ${meta.parent.toBase58()}`);
  console.log(`  Revision:     ${meta.revision.toString()}`);
  console.log(
    `  Created At:   ${new Date(
      meta.createdAt.toNumber() * 1000,
    ).toISOString()}`,
  );
  console.log(`  Bump:         ${meta.bump}`);
  console.log(`  Explorer:     ${explorerUrl(pubkey.toBase58(), cluster)}`);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IpCore as Program<IpCore>;

  const endpoint = provider.connection.rpcEndpoint;
  let cluster = "localnet";
  if (endpoint.includes("mainnet")) {
    cluster = "mainnet-beta";
  } else if (endpoint.includes("devnet")) {
    cluster = "devnet";
  }

  const metadataPubkeyEnv = process.env.METADATA_PUBKEY;
  const schemaPubkeyEnv = process.env.SCHEMA_PUBKEY;

  let schemaPubkey: PublicKey | undefined;
  if (schemaPubkeyEnv) {
    try {
      schemaPubkey = new PublicKey(schemaPubkeyEnv);
    } catch {
      console.error(`\nInvalid SCHEMA_PUBKEY: "${schemaPubkeyEnv}"`);
      process.exit(1);
    }
  }

  console.log("=".repeat(60));
  console.log("Metadata Accounts");
  console.log("=".repeat(60));
  console.log(`Cluster:    ${cluster}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);
  if (schemaPubkey) {
    console.log(`Schema:     ${schemaPubkey.toBase58()}`);
  }

  // ── Single metadata account lookup ────────────────────────────
  if (metadataPubkeyEnv) {
    let metadataPubkey: PublicKey;

    try {
      metadataPubkey = new PublicKey(metadataPubkeyEnv);
    } catch {
      console.error(`\nInvalid METADATA_PUBKEY: "${metadataPubkeyEnv}"`);
      process.exit(1);
    }

    console.log(`\nFetching metadata account: ${metadataPubkey.toBase58()}`);
    console.log("-".repeat(60));

    try {
      const meta = await program.account.metadataAccount.fetch(metadataPubkey);
      printMetadata(metadataPubkey, meta as any, cluster);
    } catch {
      console.error(
        `\nNo metadata account found at: ${metadataPubkey.toBase58()}`,
      );
      console.error("Verify the pubkey is a valid MetadataAccount PDA.");
      process.exit(1);
    }

    console.log("\n" + "=".repeat(60));
    return;
  }

  // ── All metadata accounts lookup ──────────────────────────────
  const filters = schemaPubkey
    ? [{ memcmp: { offset: 8, bytes: schemaPubkey.toBase58() } }]
    : [];

  console.log(
    schemaPubkey
      ? "\nFetching metadata accounts by schema..."
      : "\nFetching all metadata accounts...",
  );
  console.log("-".repeat(60));

  const allMetadata = await program.account.metadataAccount.all(filters);

  if (allMetadata.length === 0) {
    console.log("\nNo metadata accounts registered yet.");
  } else {
    console.log(`\nFound ${allMetadata.length} metadata account(s):`);
    for (let i = 0; i < allMetadata.length; i++) {
      printMetadata(
        allMetadata[i].publicKey,
        allMetadata[i].account as any,
        cluster,
        i,
      );
    }
  }

  console.log("\n" + "=".repeat(60));
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
