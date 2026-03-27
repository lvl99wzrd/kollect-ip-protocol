/**
 * Initialize Entity Treasury Script
 *
 * Usage:
 *   ENTITY_PUBKEY=<entity_pda> anchor run kollect_initialize_entity_treasury --provider.cluster devnet
 *
 * Environment Variables:
 *   ENTITY_PUBKEY - The ip_core Entity PDA pubkey (required)
 *   AUTHORITY     - Treasury authority pubkey (optional, defaults to signer)
 *
 * Note: Signer must be the entity's controller (passed via remainingAccounts).
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../../target/types/ip_core";
import { Kollect } from "../../target/types/kollect";
import {
  deriveEntityTreasuryPda,
  requireEnv,
  parsePubkey,
  parseOptionalPubkey,
  signerMeta,
  getCluster,
  explorerUrl,
  explorerTxUrl,
} from "../../utils/kollect_helper";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const kollect = anchor.workspace.Kollect as Program<Kollect>;
  const ipCore = anchor.workspace.IpCore as Program<IpCore>;
  const signer = provider.wallet;
  const cluster = getCluster(provider.connection.rpcEndpoint);

  console.log("=== Initialize Entity Treasury ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Signer: ${signer.publicKey.toBase58()}`);
  console.log(`Kollect Program ID: ${kollect.programId.toBase58()}`);
  console.log(`IpCore Program ID: ${ipCore.programId.toBase58()}`);

  // Read environment variables
  const entityPubkeyStr = requireEnv("ENTITY_PUBKEY", "<entity_pda_pubkey>");
  const entityPubkey = parsePubkey(entityPubkeyStr, "ENTITY_PUBKEY");
  const authorityOverride = parseOptionalPubkey(
    process.env.AUTHORITY,
    "AUTHORITY",
  );
  const treasuryAuthority = authorityOverride || signer.publicKey;

  // Fetch entity from ip_core to get controller
  let entity;
  try {
    entity = await ipCore.account.entity.fetch(entityPubkey);
  } catch {
    console.error(`\nError: Entity not found at ${entityPubkey.toBase58()}`);
    console.error("Verify the ENTITY_PUBKEY is a valid ip_core Entity PDA.");
    process.exit(1);
  }

  console.log(`\nEntity: ${entityPubkey.toBase58()}`);
  console.log(`Entity Controller: ${entity.controller.toBase58()}`);
  console.log(`Treasury Authority: ${treasuryAuthority.toBase58()}`);

  // Verify signer is the entity controller
  if (!entity.controller.equals(signer.publicKey)) {
    console.error("\nError: Signer is not the entity controller!");
    console.error(`  Entity controller: ${entity.controller.toBase58()}`);
    console.error(`  Your wallet: ${signer.publicKey.toBase58()}`);
    process.exit(1);
  }

  // Derive entity treasury PDA
  const [entityTreasuryPda] = deriveEntityTreasuryPda(
    kollect.programId,
    entityPubkey,
  );
  console.log(`Entity Treasury PDA: ${entityTreasuryPda.toBase58()}`);

  // Check if entity treasury already exists
  try {
    const existing = await kollect.account.entityTreasury.fetch(
      entityTreasuryPda,
    );
    console.error("\nError: Entity treasury already initialized!");
    console.error(`  Entity: ${existing.entity.toBase58()}`);
    console.error(`  Authority: ${existing.authority.toBase58()}`);
    console.error(`  Total Earned: ${existing.totalEarned.toString()}`);
    console.error(`  Total Withdrawn: ${existing.totalWithdrawn.toString()}`);
    process.exit(1);
  } catch {
    // Doesn't exist, proceed
  }

  console.log("\nInitializing entity treasury...");

  try {
    const tx = await kollect.methods
      .initializeEntityTreasury(treasuryAuthority)
      .accounts({
        entity: entityPubkey,
      })
      .remainingAccounts([signerMeta(signer.publicKey)])
      .rpc();

    console.log("\n✓ Entity treasury initialized successfully!");
    console.log(`Transaction: ${tx}`);

    // Fetch and display the created treasury
    const treasury = await kollect.account.entityTreasury.fetch(
      entityTreasuryPda,
    );
    console.log("\nTreasury Details:");
    console.log(`  Entity: ${treasury.entity.toBase58()}`);
    console.log(`  Authority: ${treasury.authority.toBase58()}`);
    console.log(`  Total Earned: ${treasury.totalEarned.toString()}`);
    console.log(`  Total Withdrawn: ${treasury.totalWithdrawn.toString()}`);
    console.log(`  Bump: ${treasury.bump}`);

    console.log(`\nTreasury: ${explorerUrl(entityTreasuryPda, cluster)}`);
    console.log(`Tx: ${explorerTxUrl(tx, cluster)}`);
  } catch (err) {
    console.error("\nError initializing entity treasury:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
