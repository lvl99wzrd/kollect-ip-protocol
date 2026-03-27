/**
 * Withdraw Entity Earnings Script
 *
 * Usage:
 *   ENTITY_PUBKEY=<entity_pda> AMOUNT=500000 anchor run kollect_withdraw_entity_earnings --provider.cluster devnet
 *
 * Environment Variables:
 *   ENTITY_PUBKEY - The ip_core Entity PDA pubkey (required)
 *   AMOUNT        - Amount to withdraw in base units (required)
 *   DESTINATION   - Destination token account pubkey (optional, defaults to authority's ATA)
 *
 * Note: Signer must be the entity treasury authority.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { Kollect } from "../../target/types/kollect";
import {
  derivePlatformConfigPda,
  deriveEntityTreasuryPda,
  requireEnv,
  parsePubkey,
  parseOptionalPubkey,
  getCluster,
  explorerTxUrl,
} from "../../utils/kollect_helper";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Kollect as Program<Kollect>;
  const authority = provider.wallet;
  const cluster = getCluster(provider.connection.rpcEndpoint);

  console.log("=== Withdraw Entity Earnings ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // Read environment variables
  const entityPubkeyStr = requireEnv("ENTITY_PUBKEY", "<entity_pda_pubkey>");
  const amountStr = requireEnv("AMOUNT", "500000");

  const entityPubkey = parsePubkey(entityPubkeyStr, "ENTITY_PUBKEY");
  const amount = new anchor.BN(amountStr);
  if (amount.isNeg() || amount.isZero()) {
    console.error("Error: AMOUNT must be a positive number");
    process.exit(1);
  }

  const destinationOverride = parseOptionalPubkey(
    process.env.DESTINATION,
    "DESTINATION",
  );

  // Derive entity treasury PDA
  const [entityTreasuryPda] = deriveEntityTreasuryPda(
    program.programId,
    entityPubkey,
  );

  // Fetch entity treasury
  let entityTreasury;
  try {
    entityTreasury = await program.account.entityTreasury.fetch(
      entityTreasuryPda,
    );
  } catch {
    console.error(
      `\nError: Entity treasury not found at ${entityTreasuryPda.toBase58()}`,
    );
    console.error("Run 'anchor run kollect_initialize_entity_treasury' first.");
    process.exit(1);
  }

  // Verify authority
  if (!entityTreasury.authority.equals(authority.publicKey)) {
    console.error("\nError: Wallet is not the entity treasury authority!");
    console.error(
      `  Treasury authority: ${entityTreasury.authority.toBase58()}`,
    );
    console.error(`  Your wallet: ${authority.publicKey.toBase58()}`);
    process.exit(1);
  }

  console.log(`\nEntity: ${entityPubkey.toBase58()}`);
  console.log(`Entity Treasury: ${entityTreasuryPda.toBase58()}`);
  console.log(`Total Earned: ${entityTreasury.totalEarned.toString()}`);
  console.log(`Total Withdrawn: ${entityTreasury.totalWithdrawn.toString()}`);

  // Fetch platform config for settlement currency
  const [configPda] = derivePlatformConfigPda(program.programId);
  let config;
  try {
    config = await program.account.platformConfig.fetch(configPda);
  } catch {
    console.error("\nError: Platform config not initialized!");
    process.exit(1);
  }

  const mint = config.settlementCurrency;

  // Resolve treasury token account (ATA for entity treasury PDA)
  const treasuryTokenAccount = await getAssociatedTokenAddress(
    mint,
    entityTreasuryPda,
    true, // allowOwnerOffCurve — entity treasury is a PDA
  );

  // Resolve destination
  let destination;
  if (destinationOverride) {
    destination = destinationOverride;
  } else {
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (authority as anchor.Wallet).payer,
      mint,
      authority.publicKey,
    );
    destination = ata.address;
  }

  console.log(`Settlement Currency: ${mint.toBase58()}`);
  console.log(`Treasury Token Account: ${treasuryTokenAccount.toBase58()}`);
  console.log(`Destination: ${destination.toBase58()}`);
  console.log(`Withdraw Amount: ${amount.toString()}`);

  console.log("\nWithdrawing entity earnings...");

  try {
    const tx = await program.methods
      .withdrawEntityEarnings(amount)
      .accountsPartial({
        entityTreasury: entityTreasuryPda,
        treasuryTokenAccount,
        destination,
      })
      .rpc();

    console.log("\n✓ Entity earnings withdrawn successfully!");
    console.log(`Transaction: ${tx}`);

    // Fetch updated treasury
    const updated = await program.account.entityTreasury.fetch(
      entityTreasuryPda,
    );
    console.log("\nUpdated Treasury:");
    console.log(`  Total Earned: ${updated.totalEarned.toString()}`);
    console.log(`  Total Withdrawn: ${updated.totalWithdrawn.toString()}`);

    console.log(`\nTx: ${explorerTxUrl(tx, cluster)}`);
  } catch (err) {
    console.error("\nError withdrawing entity earnings:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
