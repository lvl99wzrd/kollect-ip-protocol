/**
 * Initialize Protocol Treasury Script
 *
 * Usage:
 *   anchor run initialize_treasury --provider.cluster devnet
 *
 * Prerequisites:
 *   - Protocol config must be initialized first
 *   - Signer must be the config authority
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { IpCore } from "../target/types/ip_core";

async function main() {
  // Configure provider from Anchor.toml / CLI args
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IpCore as Program<IpCore>;
  const authority = provider.wallet;

  console.log("=== Initialize Protocol Treasury ===");
  console.log(`Cluster: ${provider.connection.rpcEndpoint}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

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

  // Verify config exists
  let config;
  try {
    config = await program.account.protocolConfig.fetch(configPda);
  } catch {
    console.error("\nError: Protocol config not initialized!");
    console.error(
      "Run 'anchor run initialize_config' first to initialize the config.",
    );
    process.exit(1);
  }

  // Verify signer is authority
  if (!config.authority.equals(authority.publicKey)) {
    console.error("\nError: Signer is not the config authority!");
    console.error(`  Expected: ${config.authority.toBase58()}`);
    console.error(`  Got: ${authority.publicKey.toBase58()}`);
    process.exit(1);
  }

  // Check if treasury already exists
  let treasuryExists = false;
  try {
    const existingTreasury = await program.account.protocolTreasury.fetch(
      treasuryPda,
    );
    treasuryExists = true;
    console.log("\n✓ Protocol treasury already initialized.");
    console.log(`  Authority: ${existingTreasury.authority.toBase58()}`);
    console.log(`  Config: ${existingTreasury.config.toBase58()}`);
  } catch {
    // Treasury doesn't exist, proceed with initialization
  }

  if (!treasuryExists) {
    console.log("\nInitializing protocol treasury...");

    try {
      const tx = await program.methods.initializeTreasury().rpc();

      console.log("\n✓ Protocol treasury initialized successfully!");
      console.log(`Transaction: ${tx}`);

      // Fetch and display the created treasury
      const treasury = await program.account.protocolTreasury.fetch(
        treasuryPda,
      );
      console.log("\nTreasury Details:");
      console.log(`  Authority: ${treasury.authority.toBase58()}`);
      console.log(`  Config: ${treasury.config.toBase58()}`);
    } catch (err) {
      console.error("\nError initializing treasury:", err);
      process.exit(1);
    }
  }

  // Initialize treasury ATA for the registration currency
  console.log("\nChecking treasury token account (ATA)...");
  console.log(`  Mint: ${config.registrationCurrency.toBase58()}`);

  try {
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (authority as anchor.Wallet).payer,
      config.registrationCurrency,
      treasuryPda,
      true, // allowOwnerOffCurve — required because treasury is a PDA
    );

    console.log(`\n✓ Treasury ATA ready: ${treasuryAta.address.toBase58()}`);
    console.log(`  Mint: ${treasuryAta.mint.toBase58()}`);
    console.log(`  Owner: ${treasuryAta.owner.toBase58()}`);
    console.log(`  Balance: ${treasuryAta.amount.toString()}`);
  } catch (err) {
    console.error("\nError initializing treasury ATA:", err);
    process.exit(1);
  }

  // Build explorer URL based on cluster
  const endpoint = provider.connection.rpcEndpoint;
  let cluster = "devnet";
  if (endpoint.includes("mainnet")) {
    cluster = "mainnet-beta";
  } else if (endpoint.includes("devnet")) {
    cluster = "devnet";
  }
  console.log(
    `\nExplorer: https://explorer.solana.com/address/${treasuryPda.toBase58()}?cluster=${cluster}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
