/**
 * Initialize Protocol Config Script
 *
 * Usage:
 *   REGISTRATION_CURRENCY=<mint_pubkey> REGISTRATION_FEE=<amount> anchor run initialize_config --provider.cluster devnet
 *
 * Environment Variables:
 *   REGISTRATION_CURRENCY - SPL token mint address for registration fees (required)
 *   REGISTRATION_FEE      - Fee amount in base units (required, e.g., 1000000 for 1 token with 6 decimals)
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
  const authority = provider.wallet;

  console.log("=== Initialize Protocol Config ===");
  console.log(`Cluster: ${provider.connection.rpcEndpoint}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // Read environment variables
  const registrationCurrencyStr = process.env.REGISTRATION_CURRENCY;
  const registrationFeeStr = process.env.REGISTRATION_FEE;

  if (!registrationCurrencyStr) {
    console.error(
      "Error: REGISTRATION_CURRENCY environment variable is required",
    );
    console.error(
      "Example: REGISTRATION_CURRENCY=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    process.exit(1);
  }

  if (!registrationFeeStr) {
    console.error("Error: REGISTRATION_FEE environment variable is required");
    console.error(
      "Example: REGISTRATION_FEE=1000000 (1 token with 6 decimals)",
    );
    process.exit(1);
  }

  let registrationCurrency: PublicKey;
  try {
    registrationCurrency = new PublicKey(registrationCurrencyStr);
  } catch {
    console.error(
      `Error: Invalid REGISTRATION_CURRENCY pubkey: ${registrationCurrencyStr}`,
    );
    process.exit(1);
  }

  const registrationFee = new anchor.BN(registrationFeeStr);
  if (registrationFee.isNeg()) {
    console.error("Error: REGISTRATION_FEE must be a positive number");
    process.exit(1);
  }

  // Derive PDAs
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
  console.log(`Registration Currency: ${registrationCurrency.toBase58()}`);
  console.log(`Registration Fee: ${registrationFee.toString()}`);

  // Check if config already exists
  try {
    const existingConfig = await program.account.protocolConfig.fetch(
      configPda,
    );
    console.error("\nError: Protocol config already initialized!");
    console.error(`  Authority: ${existingConfig.authority.toBase58()}`);
    console.error(`  Treasury: ${existingConfig.treasury.toBase58()}`);
    console.error(
      `  Currency: ${existingConfig.registrationCurrency.toBase58()}`,
    );
    console.error(`  Fee: ${existingConfig.registrationFee.toString()}`);
    console.error(
      "\nUse 'anchor run update_config' to modify existing config.",
    );
    process.exit(1);
  } catch {
    // Config doesn't exist, proceed with initialization
  }

  console.log("\nInitializing protocol config...");

  try {
    const tx = await program.methods
      .initializeConfig(treasuryPda, registrationCurrency, registrationFee)
      .rpc();

    console.log("\n✓ Protocol config initialized successfully!");
    console.log(`Transaction: ${tx}`);

    // Fetch and display the created config
    const config = await program.account.protocolConfig.fetch(configPda);
    console.log("\nConfig Details:");
    console.log(`  Authority: ${config.authority.toBase58()}`);
    console.log(`  Treasury: ${config.treasury.toBase58()}`);
    console.log(
      `  Registration Currency: ${config.registrationCurrency.toBase58()}`,
    );
    console.log(`  Registration Fee: ${config.registrationFee.toString()}`);

    // Build explorer URL based on cluster
    const endpoint = provider.connection.rpcEndpoint;
    let cluster = "devnet";
    if (endpoint.includes("mainnet")) {
      cluster = "mainnet-beta";
    } else if (endpoint.includes("devnet")) {
      cluster = "devnet";
    }
    console.log(
      `\nExplorer: https://explorer.solana.com/address/${configPda.toBase58()}?cluster=${cluster}`,
    );
  } catch (err) {
    console.error("\nError initializing config:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
