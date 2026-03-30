import { PublicKey } from "@solana/web3.js";

// PDA seed constants — must match programs/kollect/src/utils/seeds.rs
const PLATFORM_CONFIG_SEED = "platform_config";
const PLATFORM_TREASURY_SEED = "platform_treasury";
const ENTITY_TREASURY_SEED = "entity_treasury";
const TEMPLATE_CONFIG_SEED = "template_config";
const LICENSE_TEMPLATE_SEED = "license_template";
const LICENSE_SEED = "license";
const LICENSE_GRANT_SEED = "license_grant";

export const derivePlatformConfigPda = (
  programId: PublicKey,
): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PLATFORM_CONFIG_SEED)],
    programId,
  );
};

export const derivePlatformTreasuryPda = (
  programId: PublicKey,
): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PLATFORM_TREASURY_SEED)],
    programId,
  );
};

export const deriveTemplateConfigPda = (
  programId: PublicKey,
): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(TEMPLATE_CONFIG_SEED)],
    programId,
  );
};

export const deriveEntityTreasuryPda = (
  programId: PublicKey,
  entity: PublicKey,
): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(ENTITY_TREASURY_SEED), entity.toBuffer()],
    programId,
  );
};

const u64LeBuffer = (n: number): Buffer => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
};

export const deriveLicenseTemplatePda = (
  templateId: number,
  programId: PublicKey,
): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(LICENSE_TEMPLATE_SEED), u64LeBuffer(templateId)],
    programId,
  );
};

export const deriveLicensePda = (
  programId: PublicKey,
  ipAccount: PublicKey,
  licenseTemplate: PublicKey,
): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(LICENSE_SEED),
      ipAccount.toBuffer(),
      licenseTemplate.toBuffer(),
    ],
    programId,
  );
};

export const deriveLicenseGrantPda = (
  programId: PublicKey,
  license: PublicKey,
  granteeEntity: PublicKey,
): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(LICENSE_GRANT_SEED),
      license.toBuffer(),
      granteeEntity.toBuffer(),
    ],
    programId,
  );
};

export const getCluster = (endpoint: string): string => {
  if (endpoint.includes("mainnet")) return "mainnet-beta";
  if (endpoint.includes("devnet")) return "devnet";
  return "localnet";
};

export const explorerUrl = (address: PublicKey, cluster: string): string => {
  return `https://explorer.solana.com/address/${address.toBase58()}?cluster=${cluster}`;
};

export const explorerTxUrl = (tx: string, cluster: string): string => {
  return `https://explorer.solana.com/tx/${tx}?cluster=${cluster}`;
};

export const requireEnv = (name: string, example?: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} environment variable is required`);
    if (example) {
      console.error(`Example: ${name}=${example}`);
    }
    process.exit(1);
  }
  return value;
};

export const parseOptionalPubkey = (
  value: string | undefined,
  name: string,
): PublicKey | null => {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    console.error(`Error: Invalid ${name} pubkey: ${value}`);
    process.exit(1);
  }
};

export const parsePubkey = (value: string, name: string): PublicKey => {
  try {
    return new PublicKey(value);
  } catch {
    console.error(`Error: Invalid ${name} pubkey: ${value}`);
    process.exit(1);
  }
};

export const signerMeta = (pubkey: PublicKey) => ({
  pubkey,
  isSigner: true,
  isWritable: false,
});
