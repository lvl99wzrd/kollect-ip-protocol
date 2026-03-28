/**
 * Initialize Kollect Platform Script
 *
 * Usage:
 *   BASE_PRICE_PER_PLAY=100000 PLATFORM_FEE_BPS=500 CURRENCY=<mint> MAX_DERIVATIVES_DEPTH=3 MAX_LICENSE_TYPES=10 \
 *     anchor run kollect_initialize_platform --provider.cluster devnet
 *
 * Environment Variables:
 *   BASE_PRICE_PER_PLAY  - Base price per playback event in lamports/base units (required)
 *   PLATFORM_FEE_BPS     - Platform fee in basis points, e.g. 500 = 5% (required)
 *   CURRENCY  - SPL token mint address for settlement (required)
 *   MAX_DERIVATIVES_DEPTH - Maximum derivative chain depth for royalties (required)
 *   MAX_LICENSE_TYPES    - Maximum license types per IP (required)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
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
  const currencyStr = requireEnv(
    "CURRENCY",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  );
  const maxDerivativesDepthStr = requireEnv("MAX_DERIVATIVES_DEPTH", "3");
  const maxLicenseTypesStr = requireEnv("MAX_LICENSE_TYPES", "10");

  const basePricePerPlay = new anchor.BN(basePricePerPlayStr);
  const platformFeeBps = parseInt(platformFeeBpsStr, 10);
  const currency = parsePubkey(currencyStr, "CURRENCY");
  const maxDerivativesDepth = parseInt(maxDerivativesDepthStr, 10);
  const maxLicenseTypes = parseInt(maxLicenseTypesStr, 10);

  if (basePricePerPlay.isNeg()) {
    console.error("Error: BASE_PRICE_PER_PLAY must be a positive number");
    process.exit(1);
  }
  if (platformFeeBps < 0 || platformFeeBps > 10_000) {
    console.error("Error: PLATFORM_FEE_BPS must be between 0 and 10000");
    process.exit(1);
  }
  if (maxDerivativesDepth < 0 || maxDerivativesDepth > 255) {
    console.error("Error: MAX_DERIVATIVES_DEPTH must be between 0 and 255");
    process.exit(1);
  }
  if (maxLicenseTypes < 1 || maxLicenseTypes > 65535) {
    console.error("Error: MAX_LICENSE_TYPES must be between 1 and 65535");
    process.exit(1);
  }

  // Derive PDAs
  const [configPda] = derivePlatformConfigPda(program.programId);
  const [treasuryPda] = derivePlatformTreasuryPda(program.programId);

  console.log(`\nConfig PDA: ${configPda.toBase58()}`);
  console.log(`Treasury PDA: ${treasuryPda.toBase58()}`);
  console.log(`Currency: ${currency.toBase58()}`);
  console.log(`Base Price Per Play: ${basePricePerPlay.toString()}`);
  console.log(`Platform Fee BPS: ${platformFeeBps}`);
  console.log(`Max Derivatives Depth: ${maxDerivativesDepth}`);
  console.log(`Max License Types: ${maxLicenseTypes}`);

  // Check if config already exists
  try {
    const existing = await program.account.platformConfig.fetch(configPda);
    console.error("\nError: Platform config already initialized!");
    console.error(`  Authority: ${existing.authority.toBase58()}`);
    console.error(
      `  Base Price Per Play: ${existing.basePricePerPlay.toString()}`,
    );
    console.error(`  Platform Fee BPS: ${existing.platformFeeBps}`);
    console.error(`  Currency: ${existing.currency.toBase58()}`);
    console.error(`  Max Derivatives Depth: ${existing.maxDerivativesDepth}`);
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
        currency,
        maxDerivativesDepth,
        maxLicenseTypes,
      )
      .accountsPartial({
        authority: authority.publicKey,
        currencyMint: currency,
        treasuryTokenAccount: getAssociatedTokenAddressSync(
          currency,
          treasuryPda,
          true,
        ),
      })
      .rpc();

    console.log("\n✓ Platform config initialized successfully!");
    console.log(`Transaction: ${tx}`);

    // Fetch and display the created config
    const config = await program.account.platformConfig.fetch(configPda);
    console.log("\nConfig Details:");
    console.log(`  Authority: ${config.authority.toBase58()}`);
    console.log(`  Base Price Per Play: ${config.basePricePerPlay.toString()}`);
    console.log(`  Platform Fee BPS: ${config.platformFeeBps}`);
    console.log(`  Currency: ${config.currency.toBase58()}`);
    console.log(`  Max Derivatives Depth: ${config.maxDerivativesDepth}`);
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
