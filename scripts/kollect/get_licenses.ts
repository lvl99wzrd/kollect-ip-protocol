/**
 * Get Licenses Script
 *
 * Fetches and displays License accounts from the kollect program.
 * Supports direct PDA lookup, filtering by IP account or license template,
 * or fetching all licenses.
 *
 * Usage:
 *   # Fetch all licenses
 *   anchor run kollect_get_licenses --provider.cluster devnet
 *
 *   # Fetch single license by PDA pubkey
 *   LICENSE_PUBKEY=<license_pda> anchor run kollect_get_licenses --provider.cluster devnet
 *
 *   # Filter by IP account
 *   IP_PUBKEY=<ip_pda> anchor run kollect_get_licenses --provider.cluster devnet
 *
 *   # Filter by license template
 *   LICENSE_TEMPLATE_PUBKEY=<template_pda> anchor run kollect_get_licenses --provider.cluster devnet
 *
 *   # Filter by both IP account and license template
 *   IP_PUBKEY=<ip_pda> LICENSE_TEMPLATE_PUBKEY=<template_pda> anchor run kollect_get_licenses --provider.cluster devnet
 *
 * Environment Variables (all optional):
 *   LICENSE_PUBKEY          - Direct License PDA pubkey (takes priority)
 *   IP_PUBKEY               - Filter licenses by ip_account field
 *   LICENSE_TEMPLATE_PUBKEY - Filter licenses by license_template field
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Kollect } from "../../target/types/kollect";
import {
  parseOptionalPubkey,
  getCluster,
  explorerUrl,
} from "../../utils/kollect_helper";

// Anchor account discriminator size (8 bytes)
const DISCRIMINATOR_SIZE = 8;
// ip_account offset: discriminator (8)
const IP_ACCOUNT_OFFSET = DISCRIMINATOR_SIZE;
// license_template offset: discriminator (8) + ip_account (32) + ip_config (32)
const LICENSE_TEMPLATE_OFFSET = DISCRIMINATOR_SIZE + 32 + 32;

function displayLicense(
  address: PublicKey,
  license: any,
  cluster: string,
  index?: number,
) {
  const prefix = index !== undefined ? `[${index + 1}] ` : "";
  const grantDuration =
    license.grantDuration.toNumber() === 0
      ? "perpetual"
      : `${license.grantDuration.toString()}s`;
  const maxGrants =
    license.maxGrants === 0 ? "unlimited" : license.maxGrants.toString();

  console.log(`\n${prefix}PDA: ${address.toBase58()}`);
  console.log(`  IP Account:         ${license.ipAccount.toBase58()}`);
  console.log(`  IP Config:          ${license.ipConfig.toBase58()}`);
  console.log(`  License Template:   ${license.licenseTemplate.toBase58()}`);
  console.log(`  Owner Entity:       ${license.ownerEntity.toBase58()}`);
  console.log(`  Price:              ${license.price.toString()}`);
  console.log(`  Max Grants:         ${maxGrants}`);
  console.log(`  Current Grants:     ${license.currentGrants}`);
  console.log(`  Grant Duration:     ${grantDuration}`);
  console.log(`  Deriv Rev Share:    ${license.derivativeRevShareBps} bps`);
  console.log(`  Active:             ${license.isActive}`);
  console.log(
    `  Created At:         ${new Date(
      license.createdAt.toNumber() * 1000,
    ).toISOString()}`,
  );
  console.log(
    `  Updated At:         ${new Date(
      license.updatedAt.toNumber() * 1000,
    ).toISOString()}`,
  );
  console.log(`  Bump:               ${license.bump}`);
  console.log(`  Explorer:           ${explorerUrl(address, cluster)}`);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Kollect as Program<Kollect>;
  const cluster = getCluster(provider.connection.rpcEndpoint);

  console.log("=== Kollect Licenses ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // Parse optional env vars
  const licensePubkey = parseOptionalPubkey(
    process.env.LICENSE_PUBKEY,
    "LICENSE_PUBKEY",
  );
  const ipPubkey = parseOptionalPubkey(process.env.IP_PUBKEY, "IP_PUBKEY");
  const templatePubkey = parseOptionalPubkey(
    process.env.LICENSE_TEMPLATE_PUBKEY,
    "LICENSE_TEMPLATE_PUBKEY",
  );

  // ── Mode 1: Direct PDA lookup (highest priority) ─────────────
  if (licensePubkey) {
    console.log(`\nFetching license: ${licensePubkey.toBase58()}`);
    console.log("-".repeat(60));

    try {
      const license = await program.account.license.fetch(licensePubkey);
      displayLicense(licensePubkey, license, cluster);
    } catch {
      console.error(
        `\nError: License not found at ${licensePubkey.toBase58()}`,
      );
      console.error("Verify the pubkey is a valid License PDA.");
      process.exit(1);
    }
    return;
  }

  // ── Mode 2: Filtered fetch by IP and/or template ─────────────
  if (ipPubkey || templatePubkey) {
    const filters: { memcmp: { offset: number; bytes: string } }[] = [];

    if (ipPubkey) {
      filters.push({
        memcmp: { offset: IP_ACCOUNT_OFFSET, bytes: ipPubkey.toBase58() },
      });
    }
    if (templatePubkey) {
      filters.push({
        memcmp: {
          offset: LICENSE_TEMPLATE_OFFSET,
          bytes: templatePubkey.toBase58(),
        },
      });
    }

    const filterDesc = [
      ipPubkey && `IP=${ipPubkey.toBase58()}`,
      templatePubkey && `Template=${templatePubkey.toBase58()}`,
    ]
      .filter(Boolean)
      .join(", ");

    console.log(`\nFetching licenses filtered by ${filterDesc}...`);
    console.log("-".repeat(60));

    const licenses = await program.account.license.all(filters);

    if (licenses.length === 0) {
      console.log("\nNo licenses found matching the filter criteria.");
      return;
    }

    console.log(`\nFound ${licenses.length} license(s):`);
    for (let i = 0; i < licenses.length; i++) {
      displayLicense(licenses[i].publicKey, licenses[i].account, cluster, i);
    }
    return;
  }

  // ── Mode 3: Fetch all licenses ───────────────────────────────
  console.log("\nFetching all licenses...");
  console.log("-".repeat(60));

  const allLicenses = await program.account.license.all();

  if (allLicenses.length === 0) {
    console.log("\nNo licenses found.");
    return;
  }

  console.log(`\nFound ${allLicenses.length} license(s):`);
  for (let i = 0; i < allLicenses.length; i++) {
    displayLicense(
      allLicenses[i].publicKey,
      allLicenses[i].account,
      cluster,
      i,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
