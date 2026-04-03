/**
 * Get Venues Script
 *
 * Fetches and displays VenueAccount accounts from the kollect program.
 * Supports direct PDA lookup or fetching all venues.
 *
 * Usage:
 *   # Fetch all venues
 *   anchor run kollect_get_venues --provider.cluster devnet
 *
 *   # Fetch single venue by PDA pubkey
 *   VENUE_PUBKEY=<venue_pda> anchor run kollect_get_venues --provider.cluster devnet
 *
 * Environment Variables (all optional):
 *   VENUE_PUBKEY - Direct VenueAccount PDA pubkey
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

/**
 * Decodes a fixed-length CID byte array to a UTF-8 string,
 * stripping trailing zero bytes.
 */
function decodeCid(cid: number[]): string {
  const end = cid.indexOf(0);
  const bytes = end === -1 ? cid : cid.slice(0, end);
  return Buffer.from(bytes).toString("utf-8");
}

function displayVenue(
  address: PublicKey,
  venue: any,
  cluster: string,
  index?: number,
) {
  const prefix = index !== undefined ? `[${index + 1}] ` : "";

  console.log(`\n${prefix}PDA: ${address.toBase58()}`);
  console.log(`  Venue ID:           ${venue.venueId.toString()}`);
  console.log(`  Authority:          ${venue.authority.toBase58()}`);
  console.log(`  CID:                ${decodeCid(venue.cid)}`);
  console.log(`  Multiplier:         ${venue.multiplierBps} bps`);
  console.log(`  Active:             ${venue.isActive}`);
  console.log(`  Total Commitments:  ${venue.totalCommitments.toString()}`);
  console.log(
    `  Registered At:      ${new Date(
      venue.registeredAt.toNumber() * 1000,
    ).toISOString()}`,
  );
  console.log(
    `  Updated At:         ${new Date(
      venue.updatedAt.toNumber() * 1000,
    ).toISOString()}`,
  );
  console.log(`  Bump:               ${venue.bump}`);
  console.log(`  Explorer:           ${explorerUrl(address, cluster)}`);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Kollect as Program<Kollect>;
  const cluster = getCluster(provider.connection.rpcEndpoint);

  console.log("=== Kollect Venues ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  const venuePubkey = parseOptionalPubkey(
    process.env.VENUE_PUBKEY,
    "VENUE_PUBKEY",
  );

  // ── Mode 1: Direct PDA lookup ────────────────────────────────
  if (venuePubkey) {
    console.log(`\nFetching venue: ${venuePubkey.toBase58()}`);
    console.log("-".repeat(60));

    try {
      const venue = await program.account.venueAccount.fetch(venuePubkey);
      displayVenue(venuePubkey, venue, cluster);
    } catch {
      console.error(`\nError: Venue not found at ${venuePubkey.toBase58()}`);
      console.error("Verify the pubkey is a valid VenueAccount PDA.");
      process.exit(1);
    }
    return;
  }

  // ── Mode 2: Fetch all venues ─────────────────────────────────
  console.log("\nFetching all venues...");
  console.log("-".repeat(60));

  const allVenues = await program.account.venueAccount.all();

  if (allVenues.length === 0) {
    console.log("\nNo venues found.");
    return;
  }

  console.log(`\nFound ${allVenues.length} venue(s):`);
  for (let i = 0; i < allVenues.length; i++) {
    displayVenue(allVenues[i].publicKey, allVenues[i].account, cluster, i);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
