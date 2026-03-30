/**
 * Get Derivative Links Script
 *
 * Fetches and displays all derivative link accounts, or a single derivative
 * link when DERIVATIVE_LINK_PUBKEY is provided.
 *
 * Usage:
 *   # All derivative links
 *   anchor run get_derivative_links --provider.cluster devnet
 *
 *   # Single derivative link by PDA pubkey
 *   DERIVATIVE_LINK_PUBKEY=<pubkey> anchor run get_derivative_links --provider.cluster devnet
 *
 * Environment Variables:
 *   DERIVATIVE_LINK_PUBKEY  (optional) - PDA public key of an existing derivative link
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { IpCore } from "../target/types/ip_core";

/**
 * Returns a Solana Explorer address URL for the given cluster.
 */
const explorerUrl = (address: string, cluster: string): string =>
  cluster === "mainnet-beta"
    ? `https://explorer.solana.com/address/${address}`
    : `https://explorer.solana.com/address/${address}?cluster=${cluster}`;

/**
 * Prints a single derivative link's state to stdout.
 */
function printDerivativeLink(
  pubkey: PublicKey,
  link: {
    parentIp: PublicKey;
    childIp: PublicKey;
    license: PublicKey;
    createdAt: anchor.BN;
    bump: number;
  },
  cluster: string,
  index?: number,
): void {
  const prefix = index !== undefined ? `[${index + 1}] ` : "";
  console.log(`\n${prefix}PDA: ${pubkey.toBase58()}`);
  console.log(`  Parent IP:   ${link.parentIp.toBase58()}`);
  console.log(`  Child IP:    ${link.childIp.toBase58()}`);
  console.log(`  License:     ${link.license.toBase58()}`);
  console.log(
    `  Created At:  ${new Date(
      link.createdAt.toNumber() * 1000,
    ).toISOString()}`,
  );
  console.log(`  Bump:        ${link.bump}`);
  console.log(`  Explorer:    ${explorerUrl(pubkey.toBase58(), cluster)}`);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IpCore as Program<IpCore>;

  const endpoint = provider.connection.rpcEndpoint;
  let cluster = "localnet";
  if (endpoint.includes("mainnet")) {
    cluster = "mainnet-beta";
  } else if (endpoint.includes("devnet")) {
    cluster = "devnet";
  }

  const linkPubkeyEnv = process.env.DERIVATIVE_LINK_PUBKEY;

  console.log("=".repeat(60));
  console.log("Derivative Links");
  console.log("=".repeat(60));
  console.log(`Cluster:    ${cluster}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // ── Single derivative link lookup ─────────────────────────────
  if (linkPubkeyEnv) {
    let linkPubkey: PublicKey;

    try {
      linkPubkey = new PublicKey(linkPubkeyEnv);
    } catch {
      console.error(`\nInvalid DERIVATIVE_LINK_PUBKEY: "${linkPubkeyEnv}"`);
      process.exit(1);
    }

    console.log(`\nFetching derivative link: ${linkPubkey.toBase58()}`);
    console.log("-".repeat(60));

    try {
      const link = await program.account.derivativeLink.fetch(linkPubkey);
      printDerivativeLink(linkPubkey, link as any, cluster);
    } catch {
      console.error(`\nNo derivative link found at: ${linkPubkey.toBase58()}`);
      console.error("Verify the pubkey is a valid DerivativeLink PDA.");
      process.exit(1);
    }

    console.log("\n" + "=".repeat(60));
    return;
  }

  // ── All derivative links lookup ───────────────────────────────
  console.log("\nFetching all derivative links...");
  console.log("-".repeat(60));

  const allLinks = await program.account.derivativeLink.all();

  if (allLinks.length === 0) {
    console.log("\nNo derivative links found.");
  } else {
    console.log(`\nFound ${allLinks.length} derivative link(s):`);
    for (let i = 0; i < allLinks.length; i++) {
      printDerivativeLink(
        allLinks[i].publicKey,
        allLinks[i].account as any,
        cluster,
        i,
      );
    }
  }

  console.log("\n" + "=".repeat(60));
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
