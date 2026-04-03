/**
 * Create License Template Script
 *
 * Usage:
 *   TEMPLATE_NAME="standard_license" URI="ipfs://QmTest" TRANSFERABLE=true \
 *   DERIVATIVES_ALLOWED=true COMMERCIAL_USE=true COMMERCIAL_REV_SHARE_BPS=500 \
 *     anchor run kollect_create_license_template --provider.cluster devnet
 *
 * Environment Variables:
 *   TEMPLATE_NAME              - Template name, max 64 bytes (required)
 *   URI                        - Template URI, max 96 bytes e.g. IPFS CID (required)
 *   TRANSFERABLE               - "true" or "false" (required)
 *   DERIVATIVES_ALLOWED        - "true" or "false" (required)
 *   COMMERCIAL_USE             - "true" or "false" (required)
 *   DERIVATIVES_RECIPROCAL     - "true" or "false" (default: "false")
 *   DERIVATIVES_APPROVAL       - "true" or "false" (default: "false")
 *   COMMERCIAL_ATTRIBUTION     - "true" or "false" (default: "false")
 *   COMMERCIAL_REV_SHARE_BPS   - Basis points 0-10000 (default: 0)
 *   DERIVATIVE_REV_SHARE_BPS   - Basis points 0-10000 (default: 0)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Kollect } from "../../target/types/kollect";
import {
  deriveTemplateConfigPda,
  deriveLicenseTemplatePda,
  requireEnv,
  getCluster,
  explorerUrl,
  explorerTxUrl,
} from "../../utils/kollect_helper";
import { padBytes } from "../../utils/helper";

const MAX_TEMPLATE_NAME_LENGTH = 64;
const MAX_URI_LENGTH = 96;

function parseBool(value: string, name: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  console.error(`Error: ${name} must be "true" or "false", got "${value}"`);
  process.exit(1);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Kollect as Program<Kollect>;
  const authority = provider.wallet;
  const cluster = getCluster(provider.connection.rpcEndpoint);

  console.log("=== Create License Template ===");
  console.log(`Cluster: ${cluster}`);
  console.log(`Payer: ${authority.publicKey.toBase58()}`);
  console.log(`Program ID: ${program.programId.toBase58()}`);

  // --- Parse environment variables ---

  const templateNameStr = requireEnv("TEMPLATE_NAME", "standard_license");
  const uriStr = requireEnv("URI", "ipfs://QmTest");
  const transferableStr = requireEnv("TRANSFERABLE", "true");
  const derivativesAllowedStr = requireEnv("DERIVATIVES_ALLOWED", "true");
  const commercialUseStr = requireEnv("COMMERCIAL_USE", "true");

  const derivativesReciprocalStr =
    process.env.DERIVATIVES_RECIPROCAL ?? "false";
  const derivativesApprovalStr = process.env.DERIVATIVES_APPROVAL ?? "false";
  const commercialAttributionStr =
    process.env.COMMERCIAL_ATTRIBUTION ?? "false";
  const commercialRevShareBpsStr = process.env.COMMERCIAL_REV_SHARE_BPS ?? "0";
  const derivativeRevShareBpsStr = process.env.DERIVATIVE_REV_SHARE_BPS ?? "0";

  // --- Validate ---

  const templateNameBytes = Buffer.from(templateNameStr);
  if (templateNameBytes.length > MAX_TEMPLATE_NAME_LENGTH) {
    console.error(
      `Error: TEMPLATE_NAME exceeds ${MAX_TEMPLATE_NAME_LENGTH} bytes (got ${templateNameBytes.length})`,
    );
    process.exit(1);
  }

  const uriBytes = Buffer.from(uriStr);
  if (uriBytes.length > MAX_URI_LENGTH) {
    console.error(
      `Error: URI exceeds ${MAX_URI_LENGTH} bytes (got ${uriBytes.length})`,
    );
    process.exit(1);
  }

  const transferable = parseBool(transferableStr, "TRANSFERABLE");
  const derivativesAllowed = parseBool(
    derivativesAllowedStr,
    "DERIVATIVES_ALLOWED",
  );
  const derivativesReciprocal = parseBool(
    derivativesReciprocalStr,
    "DERIVATIVES_RECIPROCAL",
  );
  const derivativesApproval = parseBool(
    derivativesApprovalStr,
    "DERIVATIVES_APPROVAL",
  );
  const commercialUse = parseBool(commercialUseStr, "COMMERCIAL_USE");
  const commercialAttribution = parseBool(
    commercialAttributionStr,
    "COMMERCIAL_ATTRIBUTION",
  );

  const commercialRevShareBps = parseInt(commercialRevShareBpsStr, 10);
  const derivativeRevShareBps = parseInt(derivativeRevShareBpsStr, 10);

  if (
    isNaN(commercialRevShareBps) ||
    commercialRevShareBps < 0 ||
    commercialRevShareBps > 10_000
  ) {
    console.error(
      "Error: COMMERCIAL_REV_SHARE_BPS must be between 0 and 10000",
    );
    process.exit(1);
  }
  if (
    isNaN(derivativeRevShareBps) ||
    derivativeRevShareBps < 0 ||
    derivativeRevShareBps > 10_000
  ) {
    console.error(
      "Error: DERIVATIVE_REV_SHARE_BPS must be between 0 and 10000",
    );
    process.exit(1);
  }

  // --- Derive PDAs ---

  const [templateConfigPda] = deriveTemplateConfigPda(program.programId);

  // Fetch template config to get current count
  let templateCount: number;
  try {
    const config = await program.account.templateConfig.fetch(
      templateConfigPda,
    );
    templateCount = (config.templateCount as anchor.BN).toNumber();
  } catch {
    console.error(
      "\nError: TemplateConfig not found. Platform must be initialized first.",
    );
    console.error(
      "Use 'anchor run kollect_initialize_platform' to initialize.",
    );
    process.exit(1);
  }

  const [licenseTemplatePda] = deriveLicenseTemplatePda(
    templateCount,
    program.programId,
  );

  console.log(`\nTemplate Config PDA: ${templateConfigPda.toBase58()}`);
  console.log(`License Template PDA: ${licenseTemplatePda.toBase58()}`);
  console.log(`Next Template ID: ${templateCount}`);
  console.log(`Template Name: ${templateNameStr}`);
  console.log(`URI: ${uriStr}`);
  console.log(`Transferable: ${transferable}`);
  console.log(`Derivatives Allowed: ${derivativesAllowed}`);
  console.log(`Derivatives Reciprocal: ${derivativesReciprocal}`);
  console.log(`Derivatives Approval: ${derivativesApproval}`);
  console.log(`Commercial Use: ${commercialUse}`);
  console.log(`Commercial Attribution: ${commercialAttribution}`);
  console.log(`Commercial Rev Share BPS: ${commercialRevShareBps}`);
  console.log(`Derivative Rev Share BPS: ${derivativeRevShareBps}`);

  // --- Send transaction ---

  console.log("\nCreating license template...");

  try {
    const tx = await program.methods
      .createLicenseTemplate({
        templateName: padBytes(templateNameStr, MAX_TEMPLATE_NAME_LENGTH),
        transferable,
        derivativesAllowed,
        derivativesReciprocal,
        derivativesApproval,
        commercialUse,
        commercialAttribution,
        commercialRevShareBps,
        derivativeRevShareBps,
        uri: padBytes(uriStr, MAX_URI_LENGTH),
      })
      .accountsPartial({
        payer: authority.publicKey,
        templateConfig: templateConfigPda,
        licenseTemplate: licenseTemplatePda,
      })
      .rpc();

    console.log("\n✓ License template created successfully!");
    console.log(`Transaction: ${tx}`);

    // Fetch and display
    const template = await program.account.licenseTemplate.fetch(
      licenseTemplatePda,
    );

    const nameDecoded = Buffer.from(template.templateName as number[])
      .toString("utf8")
      .replace(/\0+$/, "");
    const uriDecoded = Buffer.from(template.uri as number[])
      .toString("utf8")
      .replace(/\0+$/, "");

    console.log("\nTemplate Details:");
    console.log(
      `  Template ID: ${(template.templateId as anchor.BN).toNumber()}`,
    );
    console.log(`  Creator: ${template.creator.toBase58()}`);
    console.log(`  Name: ${nameDecoded}`);
    console.log(`  Transferable: ${template.transferable}`);
    console.log(`  Derivatives Allowed: ${template.derivativesAllowed}`);
    console.log(`  Derivatives Reciprocal: ${template.derivativesReciprocal}`);
    console.log(`  Derivatives Approval: ${template.derivativesApproval}`);
    console.log(`  Commercial Use: ${template.commercialUse}`);
    console.log(`  Commercial Attribution: ${template.commercialAttribution}`);
    console.log(
      `  Commercial Rev Share BPS: ${template.commercialRevShareBps}`,
    );
    console.log(
      `  Derivative Rev Share BPS: ${template.derivativeRevShareBps}`,
    );
    console.log(`  URI: ${uriDecoded}`);
    console.log(`  Is Active: ${template.isActive}`);
    console.log(
      `  Created At: ${new Date(
        (template.createdAt as anchor.BN).toNumber() * 1000,
      ).toISOString()}`,
    );
    console.log(`  Bump: ${template.bump}`);

    console.log(`\nTemplate: ${explorerUrl(licenseTemplatePda, cluster)}`);
    console.log(`Tx: ${explorerTxUrl(tx, cluster)}`);
  } catch (err) {
    console.error("\nError creating license template:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
