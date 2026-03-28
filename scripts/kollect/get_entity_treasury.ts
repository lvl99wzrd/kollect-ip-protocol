/**
 * Get Entity Treasury Script
 *
 * Usage:
 *   # Fetch all entity treasuries
 *   anchor run kollect_get_entity_treasury --provider.cluster devnet
 *
 *   # Fetch by entity PDA (derives treasury PDA)
 *   ENTITY_PUBKEY=<entity_pda> anchor run kollect_get_entity_treasury --provider.cluster devnet
 *
 *   # Fetch by direct treasury PDA
 *   ENTITY_TREASURY_PUBKEY=<treasury_pda> anchor run kollect_get_entity_treasury --provider.cluster devnet
 *
 * Environment Variables (all optional):
 *   ENTITY_PUBKEY          - ip_core Entity PDA (derives treasury from it)
 *   ENTITY_TREASURY_PUBKEY - Direct treasury PDA pubkey (takes priority)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Kollect } from "../../target/types/kollect";
import {
  deriveEntityTreasuryPda,
  parseOptionalPubkey,
  getCluster,
  explorerUrl,
} from "../../utils/kollect_helper";

function displayTreasury(
  label: string,
  address: PublicKey,
  treasury: any,
  cluster: string,
) {
  console.log(`\n${label}`);
  console.log(`  Address: ${address.toBase58()}`);
  console.log(`  Entity: ${treasury.entity.toBase58()}`);
  console.log(`  Authority: ${treasury.authority.toBase58()}`);
  console.log(`  Total Earned: ${treasury.totalEarned.toString()}`);
  console.log(`  Total Withdrawn: ${treasury.totalWithdrawn.toString()}`);
  console.log(`  Bump: ${treasury.bump}`);
  console.log(`  Explorer: ${explorerUrl(address, cluster)}`);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Kollect as Program<Kollect>;
  const cluster = getCluster(provider.connection.rpcEndpoint);

  console.log("=== Kollect Entity Treasury ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // Check for direct treasury pubkey first (takes priority)
  const treasuryPubkey = parseOptionalPubkey(
    process.env.ENTITY_TREASURY_PUBKEY,
    "ENTITY_TREASURY_PUBKEY",
  );

  if (treasuryPubkey) {
    // Direct fetch
    try {
      const treasury = await program.account.entityTreasury.fetch(
        treasuryPubkey,
      );
      displayTreasury("Entity Treasury:", treasuryPubkey, treasury, cluster);
    } catch {
      console.error(
        `\nError: Entity treasury not found at ${treasuryPubkey.toBase58()}`,
      );
      process.exit(1);
    }
    return;
  }

  // Check for entity pubkey (derives treasury PDA)
  const entityPubkey = parseOptionalPubkey(
    process.env.ENTITY_PUBKEY,
    "ENTITY_PUBKEY",
  );

  if (entityPubkey) {
    const [entityTreasuryPda] = deriveEntityTreasuryPda(
      program.programId,
      entityPubkey,
    );

    try {
      const treasury = await program.account.entityTreasury.fetch(
        entityTreasuryPda,
      );
      displayTreasury(
        `Entity Treasury (for entity ${entityPubkey.toBase58()}):`,
        entityTreasuryPda,
        treasury,
        cluster,
      );
    } catch {
      console.log(
        `\nEntity treasury not initialized for entity ${entityPubkey.toBase58()}`,
      );
      console.log(`Expected PDA: ${entityTreasuryPda.toBase58()}`);
      console.log(
        "Run 'anchor run kollect_initialize_entity_treasury' to create it.",
      );
    }
    return;
  }

  // Fetch all entity treasuries
  console.log("\nFetching all entity treasuries...");

  const treasuries = await program.account.entityTreasury.all();

  if (treasuries.length === 0) {
    console.log("\nNo entity treasuries found.");
    return;
  }

  console.log(`\nFound ${treasuries.length} entity treasury(ies):\n`);

  for (const { publicKey, account } of treasuries) {
    displayTreasury("---", publicKey, account, cluster);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
