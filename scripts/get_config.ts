/**
 * Get Protocol Config Script
 *
 * Usage:
 *   anchor run get_config --provider.cluster devnet
 *   anchor run get_config --provider.cluster mainnet-beta
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { IpCore } from "../target/types/ip_core";

async function main() {
  // Configure provider from Anchor.toml / CLI args
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IpCore as Program<IpCore>;

  // Determine cluster name for display
  const endpoint = provider.connection.rpcEndpoint;
  let cluster = "localnet";
  if (endpoint.includes("mainnet")) {
    cluster = "mainnet-beta";
  } else if (endpoint.includes("devnet")) {
    cluster = "devnet";
  }

  console.log("=== Protocol Config ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    program.programId,
  );

  console.log(`Config PDA: ${configPda.toBase58()}`);
  console.log(`Treasury PDA: ${treasuryPda.toBase58()}`);

  // Fetch config
  try {
    const config = await program.account.protocolConfig.fetch(configPda);

    console.log("\nConfig Details:");
    console.log(`  Authority: ${config.authority.toBase58()}`);
    console.log(`  Treasury: ${config.treasury.toBase58()}`);
    console.log(
      `  Registration Currency: ${config.registrationCurrency.toBase58()}`,
    );
    console.log(`  Registration Fee: ${config.registrationFee.toString()}`);
    console.log(`  Bump: ${config.bump}`);

    console.log(
      `\nExplorer: https://explorer.solana.com/address/${configPda.toBase58()}?cluster=${cluster}`,
    );
  } catch {
    console.log("\nProtocol config is NOT initialized.");
    console.log("Run 'anchor run initialize_config' to create it.");
  }

  // Check treasury status
  console.log("\n=== Treasury Status ===");
  try {
    const treasury = await program.account.protocolTreasury.fetch(treasuryPda);
    console.log("Treasury initialized:");
    console.log(`  Authority: ${treasury.authority.toBase58()}`);
    console.log(`  Config: ${treasury.config.toBase58()}`);
    console.log(`  Bump: ${treasury.bump}`);
  } catch {
    console.log("Treasury is NOT initialized.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
