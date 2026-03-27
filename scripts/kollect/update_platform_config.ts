/**
 * Update Kollect Platform Config Script
 *
 * Usage:
 *   NEW_BASE_PRICE_PER_PLAY=200000 anchor run kollect_update_platform_config --provider.cluster devnet
 *
 * Environment Variables (all optional, set only what you want to change):
 *   NEW_AUTHORITY            - New authority pubkey
 *   NEW_BASE_PRICE_PER_PLAY  - New base price per play
 *   NEW_PLATFORM_FEE_BPS     - New platform fee in basis points
 *   NEW_SETTLEMENT_CURRENCY  - New SPL token mint address
 *   NEW_MAX_DERIVATIVES      - New max derivative chain depth
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Kollect } from "../../target/types/kollect";
import {
  derivePlatformConfigPda,
  parseOptionalPubkey,
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

  console.log("=== Update Kollect Platform Config ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // Derive config PDA
  const [configPda] = derivePlatformConfigPda(program.programId);
  console.log(`Config PDA: ${configPda.toBase58()}`);

  // Fetch current config
  let currentConfig;
  try {
    currentConfig = await program.account.platformConfig.fetch(configPda);
  } catch {
    console.error("\nError: Platform config not initialized!");
    console.error(
      "Run 'anchor run kollect_initialize_platform' first to initialize the config.",
    );
    process.exit(1);
  }

  // Verify authority
  if (!currentConfig.authority.equals(authority.publicKey)) {
    console.error("\nError: Wallet is not the platform config authority!");
    console.error(`  Config authority: ${currentConfig.authority.toBase58()}`);
    console.error(`  Your wallet: ${authority.publicKey.toBase58()}`);
    process.exit(1);
  }

  console.log("\nCurrent Config:");
  console.log(`  Authority: ${currentConfig.authority.toBase58()}`);
  console.log(
    `  Base Price Per Play: ${currentConfig.basePricePerPlay.toString()}`,
  );
  console.log(`  Platform Fee BPS: ${currentConfig.platformFeeBps}`);
  console.log(
    `  Settlement Currency: ${currentConfig.settlementCurrency.toBase58()}`,
  );
  console.log(`  Max Derivatives: ${currentConfig.maxDerivatives}`);

  // Parse optional environment variables
  const newAuthority = parseOptionalPubkey(
    process.env.NEW_AUTHORITY,
    "NEW_AUTHORITY",
  );
  const newSettlementCurrency = parseOptionalPubkey(
    process.env.NEW_SETTLEMENT_CURRENCY,
    "NEW_SETTLEMENT_CURRENCY",
  );

  let newBasePricePerPlay: anchor.BN | null = null;
  if (process.env.NEW_BASE_PRICE_PER_PLAY) {
    newBasePricePerPlay = new anchor.BN(process.env.NEW_BASE_PRICE_PER_PLAY);
    if (newBasePricePerPlay.isNeg()) {
      console.error("Error: NEW_BASE_PRICE_PER_PLAY must be a positive number");
      process.exit(1);
    }
  }

  let newPlatformFeeBps: number | null = null;
  if (process.env.NEW_PLATFORM_FEE_BPS) {
    newPlatformFeeBps = parseInt(process.env.NEW_PLATFORM_FEE_BPS, 10);
    if (newPlatformFeeBps < 0 || newPlatformFeeBps > 10_000) {
      console.error("Error: NEW_PLATFORM_FEE_BPS must be between 0 and 10000");
      process.exit(1);
    }
  }

  let newMaxDerivatives: number | null = null;
  if (process.env.NEW_MAX_DERIVATIVES) {
    newMaxDerivatives = parseInt(process.env.NEW_MAX_DERIVATIVES, 10);
    if (newMaxDerivatives < 0 || newMaxDerivatives > 65535) {
      console.error("Error: NEW_MAX_DERIVATIVES must be between 0 and 65535");
      process.exit(1);
    }
  }

  // Check that at least one update is provided
  if (
    !newAuthority &&
    !newBasePricePerPlay &&
    newPlatformFeeBps === null &&
    !newSettlementCurrency &&
    newMaxDerivatives === null
  ) {
    console.error("\nError: No updates specified. Set at least one of:");
    console.error(
      "  NEW_AUTHORITY, NEW_BASE_PRICE_PER_PLAY, NEW_PLATFORM_FEE_BPS,",
    );
    console.error("  NEW_SETTLEMENT_CURRENCY, NEW_MAX_DERIVATIVES");
    process.exit(1);
  }

  // Warn about authority transfer
  if (newAuthority) {
    console.log(
      `\n⚠ WARNING: Transferring authority to ${newAuthority.toBase58()}`,
    );
    console.log("  This action cannot be undone by the current authority.");
  }

  console.log("\nUpdating platform config...");

  try {
    const tx = await program.methods
      .updatePlatformConfig({
        newAuthority: newAuthority,
        newBasePricePerPlay: newBasePricePerPlay,
        newPlatformFeeBps: newPlatformFeeBps,
        newSettlementCurrency: newSettlementCurrency,
        newMaxDerivatives: newMaxDerivatives,
      })
      .rpc();

    console.log("\n✓ Platform config updated successfully!");
    console.log(`Transaction: ${tx}`);

    // Fetch and display updated config
    const config = await program.account.platformConfig.fetch(configPda);
    console.log("\nUpdated Config:");
    console.log(`  Authority: ${config.authority.toBase58()}`);
    console.log(`  Base Price Per Play: ${config.basePricePerPlay.toString()}`);
    console.log(`  Platform Fee BPS: ${config.platformFeeBps}`);
    console.log(
      `  Settlement Currency: ${config.settlementCurrency.toBase58()}`,
    );
    console.log(`  Max Derivatives: ${config.maxDerivatives}`);

    console.log(`\nConfig: ${explorerUrl(configPda, cluster)}`);
    console.log(`Tx: ${explorerTxUrl(tx, cluster)}`);
  } catch (err) {
    console.error("\nError updating platform config:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
