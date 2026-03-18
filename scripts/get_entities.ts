/**
 * Get Entities Script
 *
 * Fetches and displays all registered entities, or a single entity
 * when ENTITY_PUBKEY is provided.
 *
 * Usage:
 *   # All entities
 *   anchor run get_entities --provider.cluster devnet
 *
 *   # Single entity by PDA pubkey
 *   ENTITY_PUBKEY=<pubkey> anchor run get_entities --provider.cluster devnet
 *
 * Environment Variables:
 *   ENTITY_PUBKEY  (optional) - PDA public key of an existing entity
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
 * Returns a Solana Explorer address URL for the given cluster.
 */
const explorerUrl = (address: string, cluster: string): string =>
  cluster === "mainnet-beta"
    ? `https://explorer.solana.com/address/${address}`
    : `https://explorer.solana.com/address/${address}?cluster=${cluster}`;

/**
 * Prints a single entity's state to stdout.
 */
function printEntity(
  pubkey: PublicKey,
  entity: {
    creator: PublicKey;
    handle: number[];
    controller: PublicKey;
    currentMetadataRevision: anchor.BN;
    createdAt: anchor.BN;
    updatedAt: anchor.BN;
    bump: number;
  },
  cluster: string,
  index?: number,
): void {
  const prefix = index !== undefined ? `[${index + 1}] ` : "";
  console.log(`\n${prefix}PDA: ${pubkey.toBase58()}`);
  console.log(`  Handle:             ${decodeBytes(entity.handle)}`);
  console.log(`  Creator:            ${entity.creator.toBase58()}`);
  console.log(`  Controller:         ${entity.controller.toBase58()}`);
  console.log(
    `  Metadata Revision:  ${entity.currentMetadataRevision.toString()}`,
  );
  console.log(
    `  Created At:         ${new Date(
      entity.createdAt.toNumber() * 1000,
    ).toISOString()}`,
  );
  console.log(
    `  Updated At:         ${new Date(
      entity.updatedAt.toNumber() * 1000,
    ).toISOString()}`,
  );
  console.log(`  Bump:               ${entity.bump}`);
  console.log(
    `  Explorer:           ${explorerUrl(pubkey.toBase58(), cluster)}`,
  );
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

  const entityPubkeyEnv = process.env.ENTITY_PUBKEY;

  console.log("=".repeat(60));
  console.log("Entities");
  console.log("=".repeat(60));
  console.log(`Cluster:    ${cluster}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // ── Single entity lookup ──────────────────────────────────────
  if (entityPubkeyEnv) {
    let entityPubkey: PublicKey;

    try {
      entityPubkey = new PublicKey(entityPubkeyEnv);
    } catch {
      console.error(`\nInvalid ENTITY_PUBKEY: "${entityPubkeyEnv}"`);
      process.exit(1);
    }

    console.log(`\nFetching entity: ${entityPubkey.toBase58()}`);
    console.log("-".repeat(60));

    try {
      const entity = await program.account.entity.fetch(entityPubkey);
      printEntity(entityPubkey, entity as any, cluster);
    } catch {
      console.error(`\nNo entity found at: ${entityPubkey.toBase58()}`);
      console.error("Verify the pubkey is a valid Entity PDA.");
      process.exit(1);
    }

    console.log("\n" + "=".repeat(60));
    return;
  }

  // ── All entities lookup ───────────────────────────────────────
  console.log("\nFetching all registered entities...");
  console.log("-".repeat(60));

  const allEntities = await program.account.entity.all();

  if (allEntities.length === 0) {
    console.log("\nNo entities registered yet.");
  } else {
    console.log(`\nFound ${allEntities.length} entity/entities:`);
    for (let i = 0; i < allEntities.length; i++) {
      printEntity(
        allEntities[i].publicKey,
        allEntities[i].account as any,
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
