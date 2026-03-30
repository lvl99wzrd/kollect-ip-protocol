/**
 * Get License Grants Script
 *
 * Fetches and displays LicenseGrant accounts from the kollect program.
 * Supports direct PDA lookup, filtering by license or grantee entity,
 * or fetching all license grants.
 *
 * Usage:
 *   # Fetch all license grants
 *   anchor run kollect_get_license_grants --provider.cluster devnet
 *
 *   # Fetch single license grant by PDA pubkey
 *   LICENSE_GRANT_PUBKEY=<grant_pda> anchor run kollect_get_license_grants --provider.cluster devnet
 *
 *   # Filter by license
 *   LICENSE_PUBKEY=<license_pda> anchor run kollect_get_license_grants --provider.cluster devnet
 *
 *   # Filter by grantee entity
 *   GRANTEE_PUBKEY=<entity_pda> anchor run kollect_get_license_grants --provider.cluster devnet
 *
 *   # Filter by both license and grantee entity
 *   LICENSE_PUBKEY=<license_pda> GRANTEE_PUBKEY=<entity_pda> anchor run kollect_get_license_grants --provider.cluster devnet
 *
 * Environment Variables (all optional):
 *   LICENSE_GRANT_PUBKEY - Direct LicenseGrant PDA pubkey (takes priority)
 *   LICENSE_PUBKEY       - Filter grants by license field
 *   GRANTEE_PUBKEY       - Filter grants by grantee field
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
// license offset: discriminator (8)
const LICENSE_OFFSET = DISCRIMINATOR_SIZE;
// grantee offset: discriminator (8) + license (32)
const GRANTEE_OFFSET = DISCRIMINATOR_SIZE + 32;

function displayLicenseGrant(
  address: PublicKey,
  grant: any,
  cluster: string,
  index?: number,
) {
  const prefix = index !== undefined ? `[${index + 1}] ` : "";
  const expiration =
    grant.expiration.toNumber() === 0
      ? "perpetual"
      : new Date(grant.expiration.toNumber() * 1000).toISOString();

  console.log(`\n${prefix}PDA: ${address.toBase58()}`);
  console.log(`  License:    ${grant.license.toBase58()}`);
  console.log(`  Grantee:    ${grant.grantee.toBase58()}`);
  console.log(
    `  Granted At: ${new Date(
      grant.grantedAt.toNumber() * 1000,
    ).toISOString()}`,
  );
  console.log(`  Expiration: ${expiration}`);
  console.log(`  Price Paid: ${grant.pricePaid.toString()}`);
  console.log(`  Bump:       ${grant.bump}`);
  console.log(`  Explorer:   ${explorerUrl(address, cluster)}`);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Kollect as Program<Kollect>;
  const cluster = getCluster(provider.connection.rpcEndpoint);

  console.log("=== Kollect License Grants ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // Parse optional env vars
  const grantPubkey = parseOptionalPubkey(
    process.env.LICENSE_GRANT_PUBKEY,
    "LICENSE_GRANT_PUBKEY",
  );
  const licensePubkey = parseOptionalPubkey(
    process.env.LICENSE_PUBKEY,
    "LICENSE_PUBKEY",
  );
  const granteePubkey = parseOptionalPubkey(
    process.env.GRANTEE_PUBKEY,
    "GRANTEE_PUBKEY",
  );

  // ── Mode 1: Direct PDA lookup (highest priority) ─────────────
  if (grantPubkey) {
    console.log(`\nFetching license grant: ${grantPubkey.toBase58()}`);
    console.log("-".repeat(60));

    try {
      const grant = await program.account.licenseGrant.fetch(grantPubkey);
      displayLicenseGrant(grantPubkey, grant, cluster);
    } catch {
      console.error(
        `\nError: License grant not found at ${grantPubkey.toBase58()}`,
      );
      console.error("Verify the pubkey is a valid LicenseGrant PDA.");
      process.exit(1);
    }
    return;
  }

  // ── Mode 2: Filtered fetch by license and/or grantee ─────────
  if (licensePubkey || granteePubkey) {
    const filters: { memcmp: { offset: number; bytes: string } }[] = [];

    if (licensePubkey) {
      filters.push({
        memcmp: { offset: LICENSE_OFFSET, bytes: licensePubkey.toBase58() },
      });
    }
    if (granteePubkey) {
      filters.push({
        memcmp: { offset: GRANTEE_OFFSET, bytes: granteePubkey.toBase58() },
      });
    }

    const filterDesc = [
      licensePubkey && `License=${licensePubkey.toBase58()}`,
      granteePubkey && `Grantee=${granteePubkey.toBase58()}`,
    ]
      .filter(Boolean)
      .join(", ");

    console.log(`\nFetching license grants filtered by ${filterDesc}...`);
    console.log("-".repeat(60));

    const grants = await program.account.licenseGrant.all(filters);

    if (grants.length === 0) {
      console.log("\nNo license grants found matching the filter criteria.");
      return;
    }

    console.log(`\nFound ${grants.length} license grant(s):`);
    for (let i = 0; i < grants.length; i++) {
      displayLicenseGrant(grants[i].publicKey, grants[i].account, cluster, i);
    }
    return;
  }

  // ── Mode 3: Fetch all license grants ─────────────────────────
  console.log("\nFetching all license grants...");
  console.log("-".repeat(60));

  const allGrants = await program.account.licenseGrant.all();

  if (allGrants.length === 0) {
    console.log("\nNo license grants found.");
    return;
  }

  console.log(`\nFound ${allGrants.length} license grant(s):`);
  for (let i = 0; i < allGrants.length; i++) {
    displayLicenseGrant(
      allGrants[i].publicKey,
      allGrants[i].account,
      cluster,
      i,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
