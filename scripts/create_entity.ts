/**
 * Create Entity Script
 *
 * Registers a new entity on-chain. Each entity is assigned a sequential
 * index from a per-creator counter.
 *
 * Usage:
 *   anchor run create_entity --provider.cluster devnet
 *
 * Examples:
 *   anchor run create_entity --provider.cluster devnet
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../target/types/ip_core";
import { deriveEntityPda, getEntityCount } from "../utils/helper";

/**
 * Gets the Solana explorer URL for a transaction.
 */
const getExplorerUrl = (signature: string, cluster: string): string => {
  const clusterParam = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${clusterParam}`;
};

async function main() {
  // Setup Anchor provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.IpCore as Program<IpCore>;

  const cluster = provider.connection.rpcEndpoint.includes("devnet")
    ? "devnet"
    : provider.connection.rpcEndpoint.includes("mainnet")
    ? "mainnet-beta"
    : "localnet";

  // Get the next entity index from the counter
  const nextIndex = await getEntityCount(program, provider.wallet.publicKey);
  const [entityPda] = deriveEntityPda(
    program.programId,
    provider.wallet.publicKey,
    nextIndex,
  );

  console.log("=".repeat(60));
  console.log("Create Entity");
  console.log("=".repeat(60));
  console.log(`Cluster:     ${cluster}`);
  console.log(`Creator:     ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Index:       ${nextIndex}`);
  console.log(`Entity PDA:  ${entityPda.toBase58()}`);
  console.log("-".repeat(60));

  // Create the entity
  console.log("\nCreating entity...");

  const signature = await program.methods
    .createEntity()
    .accountsPartial({ entity: entityPda })
    .rpc();

  console.log("\nEntity created successfully!");
  console.log(`Transaction: ${signature}`);
  console.log(`Explorer:    ${getExplorerUrl(signature, cluster)}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
