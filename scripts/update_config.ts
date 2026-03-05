/**
 * Update Protocol Config Script
 *
 * Usage:
 *   NEW_REGISTRATION_FEE=<amount> anchor run update_config --provider.cluster devnet
 *
 * Environment Variables (all optional, only set what you want to change):
 *   NEW_AUTHORITY             - New authority pubkey
 *   NEW_TREASURY              - New treasury PDA pubkey
 *   NEW_REGISTRATION_CURRENCY - New SPL token mint address
 *   NEW_REGISTRATION_FEE      - New fee amount in base units
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { IpCore } from "../target/types/ip_core";

function parseOptionalPubkey(
  value: string | undefined,
  name: string,
): PublicKey | null {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    console.error(`Error: Invalid ${name} pubkey: ${value}`);
    process.exit(1);
  }
}

async function main() {
  // Configure provider from Anchor.toml / CLI args
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IpCore as Program<IpCore>;
  const authority = provider.wallet;

  console.log("=== Update Protocol Config ===");
  console.log(`Cluster: ${provider.connection.rpcEndpoint}`);
  console.log(`Authority: ${authority.publicKey.toBase58()}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  console.log(`Config PDA: ${configPda.toBase58()}`);

  // Fetch current config
  let currentConfig;
  try {
    currentConfig = await program.account.protocolConfig.fetch(configPda);
  } catch {
    console.error("\nError: Protocol config not initialized!");
    console.error("Run 'anchor run initialize_config' first.");
    process.exit(1);
  }

  // Verify authority
  if (!currentConfig.authority.equals(authority.publicKey)) {
    console.error("\nError: Wallet is not the config authority!");
    console.error(`  Config authority: ${currentConfig.authority.toBase58()}`);
    console.error(`  Your wallet: ${authority.publicKey.toBase58()}`);
    process.exit(1);
  }

  console.log("\nCurrent Config:");
  console.log(`  Authority: ${currentConfig.authority.toBase58()}`);
  console.log(`  Treasury: ${currentConfig.treasury.toBase58()}`);
  console.log(
    `  Registration Currency: ${currentConfig.registrationCurrency.toBase58()}`,
  );
  console.log(
    `  Registration Fee: ${currentConfig.registrationFee.toString()}`,
  );

  // Parse environment variables
  const newAuthority = parseOptionalPubkey(
    process.env.NEW_AUTHORITY,
    "NEW_AUTHORITY",
  );
  const newTreasury = parseOptionalPubkey(
    process.env.NEW_TREASURY,
    "NEW_TREASURY",
  );
  const newRegistrationCurrency = parseOptionalPubkey(
    process.env.NEW_REGISTRATION_CURRENCY,
    "NEW_REGISTRATION_CURRENCY",
  );

  let newRegistrationFee: anchor.BN | null = null;
  if (process.env.NEW_REGISTRATION_FEE) {
    newRegistrationFee = new anchor.BN(process.env.NEW_REGISTRATION_FEE);
    if (newRegistrationFee.isNeg()) {
      console.error("Error: NEW_REGISTRATION_FEE must be a positive number");
      process.exit(1);
    }
  }

  // Check if any updates are requested
  if (
    !newAuthority &&
    !newTreasury &&
    !newRegistrationCurrency &&
    !newRegistrationFee
  ) {
    console.error("\nError: No updates specified!");
    console.error(
      "Set at least one of: NEW_AUTHORITY, NEW_TREASURY, NEW_REGISTRATION_CURRENCY, NEW_REGISTRATION_FEE",
    );
    process.exit(1);
  }

  console.log("\nUpdates to apply:");
  if (newAuthority) console.log(`  Authority: ${newAuthority.toBase58()}`);
  if (newTreasury) console.log(`  Treasury: ${newTreasury.toBase58()}`);
  if (newRegistrationCurrency)
    console.log(
      `  Registration Currency: ${newRegistrationCurrency.toBase58()}`,
    );
  if (newRegistrationFee)
    console.log(`  Registration Fee: ${newRegistrationFee.toString()}`);

  // Warn about authority transfer
  if (newAuthority) {
    console.log(
      "\n⚠️  WARNING: You are transferring authority to a new address!",
    );
    console.log(
      "   This action cannot be undone without the new authority's signature.",
    );
  }

  console.log("\nUpdating protocol config...");

  try {
    const tx = await program.methods
      .updateConfig({
        newAuthority,
        newTreasury,
        newRegistrationCurrency,
        newRegistrationFee,
      })
      .rpc();

    console.log("\n✓ Protocol config updated successfully!");
    console.log(`Transaction: ${tx}`);

    // Fetch and display the updated config
    const config = await program.account.protocolConfig.fetch(configPda);
    console.log("\nUpdated Config:");
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
      `\nExplorer: https://explorer.solana.com/tx/${tx}?cluster=${cluster}`,
    );
  } catch (err) {
    console.error("\nError updating config:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
