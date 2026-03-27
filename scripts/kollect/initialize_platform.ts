/**
 * Initialize Kollect Platform Script
 *
 * Usage:
 *   BASE_PRICE_PER_PLAY=100000 PLATFORM_FEE_BPS=500 SETTLEMENT_CURRENCY=<mint> MAX_DERIVATIVES=10 \
 *     anchor run kollect_initialize_platform --provider.cluster devnet
 *
 * Environment Variables:
 *   BASE_PRICE_PER_PLAY  - Base price per playback event in lamports/base units (required)
 *   PLATFORM_FEE_BPS     - Platform fee in basis points, e.g. 500 = 5% (required)
 *   SETTLEMENT_CURRENCY  - SPL token mint address for settlement (required)
 *   MAX_DERIVATIVES      - Maximum derivative chain depth (required)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Kollect } from "../../target/types/kollect";
import {
  derivePlatformConfigPda,
  derivePlatformTreasuryPda,
  requireEnv,
  parsePubkey,
  getCluster,
  explorerUrl,
  explorerTxUrl,
} from "../../utils/kollect_helper";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Kollect as Program<Kollect>;
  const authority = provider.wallet;
  const cluster = getCluster(provider.connection.rpcEndpoint);

  console.log("=== Initialize Kollect Platform ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // Read and validate environment variables
  const basePricePerPlayStr = requireEnv("BASE_PRICE_PER_PLAY", "100000");
  const platformFeeBpsStr = requireEnv("PLATFORM_FEE_BPS", "500");
  const settlementCurrencyStr = requireEnv(
    "SETTLEMENT_CURRENCY",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  );
  const maxDerivativesStr = requireEnv("MAX_DERIVATIVES", "10");

  const basePricePerPlay = new anchor.BN(basePricePerPlayStr);
  const platformFeeBps = parseInt(platformFeeBpsStr, 10);
  const settlementCurrency = parsePubkey(
    settlementCurrencyStr,
    "SETTLEMENT_CURRENCY",
  );
  const maxDerivatives = parseInt(maxDerivativesStr, 10);

  if (basePricePerPlay.isNeg()) {
    console.error("Error: BASE_PRICE_PER_PLAY must be a positive number");
    process.exit(1);
  }
  if (platformFeeBps < 0 || platformFeeBps > 10_000) {
    console.error("Error: PLATFORM_FEE_BPS must be between 0 and 10000");
    process.exit(1);
  }
  if (maxDerivatives < 0 || maxDerivatives > 65535) {
    console.error("Error: MAX_DERIVATIVES must be between 0 and 65535");
    process.exit(1);
  }

  // Derive PDAs
  const [configPda] = derivePlatformConfigPda(program.programId);
  const [treasuryPda] = derivePlatformTreasuryPda(program.programId);

  console.log(`\nConfig PDA: ${configPda.toBase58()}`);
  console.log(`Treasury PDA: ${treasuryPda.toBase58()}`);
  console.log(`Settlement Currency: ${settlementCurrency.toBase58()}`);
  console.log(`Base Price Per Play: ${basePricePerPlay.toString()}`);
  console.log(`Platform Fee BPS: ${platformFeeBps}`);
  console.log(`Max Derivatives: ${maxDerivatives}`);

  // Check if config already exists
  try {
    const existing = await program.account.platformConfig.fetch(configPda);
    console.error("\nError: Platform config already initialized!");
    console.error(`  Authority: ${existing.authority.toBase58()}`);
    console.error(
      `  Base Price Per Play: ${existing.basePricePerPlay.toString()}`,
    );
    console.error(`  Platform Fee BPS: ${existing.platformFeeBps}`);
    console.error(
      `  Settlement Currency: ${existing.settlementCurrency.toBase58()}`,
    );
    console.error(`  Max Derivatives: ${existing.maxDerivatives}`);
    console.error(
      "\nUse 'anchor run kollect_update_platform_config' to modify existing config.",
    );
    process.exit(1);
  } catch {
    // Config doesn't exist, proceed with initialization
  }

  console.log("\nInitializing platform config...");

  try {
    const tx = await program.methods
      .initializePlatform(
        basePricePerPlay,
        platformFeeBps,
        settlementCurrency,
        maxDerivatives,
      )
      .rpc();

    console.log("\n✓ Platform config initialized successfully!");
    console.log(`Transaction: ${tx}`);

    // Fetch and display the created config
    const config = await program.account.platformConfig.fetch(configPda);
    console.log("\nConfig Details:");
    console.log(`  Authority: ${config.authority.toBase58()}`);
    console.log(`  Base Price Per Play: ${config.basePricePerPlay.toString()}`);
    console.log(`  Platform Fee BPS: ${config.platformFeeBps}`);
    console.log(
      `  Settlement Currency: ${config.settlementCurrency.toBase58()}`,
    );
    console.log(`  Max Derivatives: ${config.maxDerivatives}`);
    console.log(`  Treasury: ${config.treasury.toBase58()}`);
    console.log(`  Bump: ${config.bump}`);

    console.log(`\nConfig: ${explorerUrl(configPda, cluster)}`);
    console.log(`Treasury: ${explorerUrl(treasuryPda, cluster)}`);
    console.log(`Tx: ${explorerTxUrl(tx, cluster)}`);
  } catch (err) {
    console.error("\nError initializing platform:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
