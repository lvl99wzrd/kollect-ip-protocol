/**
 * Get Kollect Platform Config Script
 *
 * Usage:
 *   anchor run kollect_get_platform_config --provider.cluster devnet
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Kollect } from "../../target/types/kollect";
import {
  derivePlatformConfigPda,
  derivePlatformTreasuryPda,
  getCluster,
  explorerUrl,
} from "../../utils/kollect_helper";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Kollect as Program<Kollect>;
  const cluster = getCluster(provider.connection.rpcEndpoint);

  console.log("=== Kollect Platform Config ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // Derive PDAs
  const [configPda] = derivePlatformConfigPda(program.programId);
  const [treasuryPda] = derivePlatformTreasuryPda(program.programId);

  console.log(`Config PDA: ${configPda.toBase58()}`);
  console.log(`Treasury PDA: ${treasuryPda.toBase58()}`);

  // Fetch config
  try {
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

    console.log(`\n  Explorer: ${explorerUrl(configPda, cluster)}`);
  } catch {
    console.log("\nPlatform config is NOT initialized.");
    console.log("Run 'anchor run kollect_initialize_platform' to create it.");
  }

  // Check treasury status
  console.log("\n=== Platform Treasury Status ===");
  try {
    const treasury = await program.account.platformTreasury.fetch(treasuryPda);
    console.log("Treasury initialized:");
    console.log(`  Authority: ${treasury.authority.toBase58()}`);
    console.log(`  Config: ${treasury.config.toBase58()}`);
    console.log(`  Bump: ${treasury.bump}`);

    console.log(`\n  Explorer: ${explorerUrl(treasuryPda, cluster)}`);
  } catch {
    console.log("Platform treasury is NOT initialized.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
