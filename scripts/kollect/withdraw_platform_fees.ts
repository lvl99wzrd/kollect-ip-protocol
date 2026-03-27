/**
 * Withdraw Kollect Platform Fees Script
 *
 * Usage:
 *   AMOUNT=1000000 anchor run kollect_withdraw_platform_fees --provider.cluster devnet
 *
 * Environment Variables:
 *   AMOUNT      - Amount to withdraw in base units (required)
 *   DESTINATION - Destination token account pubkey (optional, defaults to authority's ATA)
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
  derivePlatformTreasuryPda,
  requireEnv,
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

  console.log("=== Withdraw Kollect Platform Fees ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // Read environment variables
  const amountStr = requireEnv("AMOUNT", "1000000");
  const amount = new anchor.BN(amountStr);
  if (amount.isNeg() || amount.isZero()) {
    console.error("Error: AMOUNT must be a positive number");
    process.exit(1);
  }

  const destinationOverride = parseOptionalPubkey(
    process.env.DESTINATION,
    "DESTINATION",
  );

  // Derive PDAs
  const [configPda] = derivePlatformConfigPda(program.programId);
  const [treasuryPda] = derivePlatformTreasuryPda(program.programId);

  // Fetch config to get settlement currency
  let config;
  try {
    config = await program.account.platformConfig.fetch(configPda);
  } catch {
    console.error("\nError: Platform config not initialized!");
    process.exit(1);
  }

  // Verify authority
  let treasury;
  try {
    treasury = await program.account.platformTreasury.fetch(treasuryPda);
  } catch {
    console.error("\nError: Platform treasury not initialized!");
    process.exit(1);
  }

  if (!treasury.authority.equals(authority.publicKey)) {
    console.error("\nError: Wallet is not the treasury authority!");
    console.error(`  Treasury authority: ${treasury.authority.toBase58()}`);
    console.error(`  Your wallet: ${authority.publicKey.toBase58()}`);
    process.exit(1);
  }

  const mint = config.settlementCurrency;

  // Resolve treasury token account (ATA for treasury PDA)
  const treasuryTokenAccount = await getAssociatedTokenAddress(
    mint,
    treasuryPda,
    true, // allowOwnerOffCurve — treasury is a PDA
  );

  // Resolve destination
  let destination;
  if (destinationOverride) {
    destination = destinationOverride;
  } else {
    // Default to authority's ATA for settlement currency
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (authority as anchor.Wallet).payer,
      mint,
      authority.publicKey,
    );
    destination = ata.address;
  }

  console.log(`\nSettlement Currency: ${mint.toBase58()}`);
  console.log(`Treasury Token Account: ${treasuryTokenAccount.toBase58()}`);
  console.log(`Destination: ${destination.toBase58()}`);
  console.log(`Amount: ${amount.toString()}`);

  console.log("\nWithdrawing platform fees...");

  try {
    const tx = await program.methods
      .withdrawPlatformFees(amount)
      .accounts({
        treasuryTokenAccount,
        destination,
      })
      .rpc();

    console.log("\n✓ Platform fees withdrawn successfully!");
    console.log(`Transaction: ${tx}`);
    console.log(`Tx: ${explorerTxUrl(tx, cluster)}`);
  } catch (err) {
    console.error("\nError withdrawing platform fees:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
