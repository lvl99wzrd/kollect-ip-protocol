import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../../target/types/ip_core";
import { Kollect } from "../../target/types/kollect";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { padBytes, deriveEntityPda, getEntityCount } from "../../utils/helper";

// Re-export helper utilities
export { padBytes } from "../../utils/helper";

// ─── Program references ─────────────────────────────────────────────────────

export const getProvider = () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  return provider;
};

export const getPrograms = () => {
  const ipCore = anchor.workspace.IpCore as Program<IpCore>;
  const kollect = anchor.workspace.Kollect as Program<Kollect>;
  return { ipCore, kollect };
};

// ─── PDA Seeds (matching programs/kollect/src/utils/seeds.rs) ────────────────

export const PLATFORM_CONFIG_SEED = Buffer.from("platform_config");
export const PLATFORM_TREASURY_SEED = Buffer.from("platform_treasury");
export const IP_CONFIG_SEED = Buffer.from("ip_config");
export const IP_TREASURY_SEED = Buffer.from("ip_treasury");
export const ENTITY_TREASURY_SEED = Buffer.from("entity_treasury");
export const VENUE_SEED = Buffer.from("venue");
export const PLAYBACK_SEED = Buffer.from("playback");
export const SETTLEMENT_SEED = Buffer.from("settlement");
export const LICENSE_TEMPLATE_SEED = Buffer.from("license_template");
export const LICENSE_SEED = Buffer.from("license");
export const LICENSE_GRANT_SEED = Buffer.from("license_grant");
export const ROYALTY_POLICY_SEED = Buffer.from("royalty_policy");
export const ROYALTY_SPLIT_SEED = Buffer.from("royalty_split");

// ip_core PDA seeds
export const ENTITY_SEED = Buffer.from("entity");
export const IP_SEED = Buffer.from("ip");
export const IP_CORE_CONFIG_SEED = Buffer.from("config");
export const IP_CORE_TREASURY_SEED = Buffer.from("treasury");

// ─── Utility functions ──────────────────────────────────────────────────────

export const randomHash = (): number[] =>
  Array.from(Keypair.generate().publicKey.toBytes());

export const venueName = (name: string): number[] => padBytes(name, 64);

export const templateName = (name: string): number[] => padBytes(name, 32);

export const venueIdBuffer = (venueId: number): Buffer => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(venueId));
  return buf;
};

export const i64Buffer = (value: number): Buffer => {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(value));
  return buf;
};

/**
 * Controller signer account meta for remainingAccounts.
 */
export const signerMeta = (pubkey: PublicKey) => ({
  pubkey,
  isSigner: true,
  isWritable: false,
});

// ─── Shared state ───────────────────────────────────────────────────────────

export interface IpCoreState {
  mint: PublicKey;
  configPda: PublicKey;
  treasuryPda: PublicKey;
  treasuryTokenAccount: PublicKey;
  payerTokenAccount: PublicKey;
}

let ipCoreState: IpCoreState | null = null;

/**
 * Idempotent initialization of ip_core protocol prerequisites.
 * Sets up mint, ProtocolConfig, ProtocolTreasury, and token accounts.
 */
export async function initializeIpCorePrerequisites(): Promise<IpCoreState> {
  if (ipCoreState) return ipCoreState;

  const provider = getProvider();
  const { ipCore } = getPrograms();
  const authority = provider.wallet as anchor.Wallet;

  const [configPda] = PublicKey.findProgramAddressSync(
    [IP_CORE_CONFIG_SEED],
    ipCore.programId,
  );

  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [IP_CORE_TREASURY_SEED],
    ipCore.programId,
  );

  let mint: PublicKey;

  // Check if config already exists
  try {
    const existingConfig = await ipCore.account.protocolConfig.fetch(configPda);
    mint = existingConfig.registrationCurrency;
  } catch {
    mint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6,
    );

    await ipCore.methods
      .initializeConfig(treasuryPda, mint, new anchor.BN(1_000_000))
      .rpc();
  }

  // Initialize treasury (idempotent)
  try {
    await ipCore.account.protocolTreasury.fetch(treasuryPda);
  } catch {
    await ipCore.methods.initializeTreasury().rpc();
  }

  // Treasury token account
  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    authority.payer,
    mint,
    treasuryPda,
    true,
  );

  // Payer token account
  const payerAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    authority.payer,
    mint,
    authority.publicKey,
  );

  // Ensure payer has tokens
  const balance = await provider.connection.getTokenAccountBalance(
    payerAta.address,
  );
  if (balance.value.uiAmount === null || balance.value.uiAmount < 100) {
    await mintTo(
      provider.connection,
      authority.payer,
      mint,
      payerAta.address,
      authority.publicKey,
      1_000_000_000,
    );
  }

  ipCoreState = {
    mint,
    configPda,
    treasuryPda,
    treasuryTokenAccount: treasuryAta.address,
    payerTokenAccount: payerAta.address,
  };

  return ipCoreState;
}

// ─── Entity helpers ─────────────────────────────────────────────────────────

export interface TestEntity {
  entityPda: PublicKey;
}

/**
 * Create an ip_core Entity using counter-based sequential index.
 */
export async function createTestEntity(label?: string): Promise<TestEntity> {
  const provider = getProvider();
  const { ipCore } = getPrograms();
  const creator = provider.wallet as anchor.Wallet;

  const index = await getEntityCount(ipCore, creator.publicKey);
  const [entityPda] = deriveEntityPda(
    ipCore.programId,
    creator.publicKey,
    index,
  );

  await ipCore.methods
    .createEntity()
    .accountsPartial({ entity: entityPda })
    .rpc();

  return { entityPda };
}

// ─── IP helpers ─────────────────────────────────────────────────────────────

export interface TestIp {
  ipPda: PublicKey;
  contentHash: number[];
}

/**
 * Create an ip_core IpAccount (always creates a new one with random hash).
 */
export async function createTestIp(entityPda: PublicKey): Promise<TestIp> {
  const provider = getProvider();
  const { ipCore } = getPrograms();
  const creator = provider.wallet as anchor.Wallet;
  const state = await initializeIpCorePrerequisites();

  const contentHash = randomHash();

  const [ipPda] = PublicKey.findProgramAddressSync(
    [IP_SEED, entityPda.toBuffer(), Buffer.from(contentHash)],
    ipCore.programId,
  );

  await ipCore.methods
    .createIp(contentHash)
    .accounts({
      registrantEntity: entityPda,
      controller: creator.publicKey,
      treasuryTokenAccount: state.treasuryTokenAccount,
      payerTokenAccount: state.payerTokenAccount,
    })
    .rpc();

  return { ipPda, contentHash };
}

// ─── Kollect PDA derivation helpers ─────────────────────────────────────────

export function derivePlatformConfigPda(
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [PLATFORM_CONFIG_SEED],
    kollectProgramId,
  )[0];
}

export function derivePlatformTreasuryPda(
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [PLATFORM_TREASURY_SEED],
    kollectProgramId,
  )[0];
}

export function deriveEntityTreasuryPda(
  entityPda: PublicKey,
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [ENTITY_TREASURY_SEED, entityPda.toBuffer()],
    kollectProgramId,
  )[0];
}

export function deriveIpConfigPda(
  ipPda: PublicKey,
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [IP_CONFIG_SEED, ipPda.toBuffer()],
    kollectProgramId,
  )[0];
}

export function deriveIpTreasuryPda(
  ipPda: PublicKey,
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [IP_TREASURY_SEED, ipPda.toBuffer()],
    kollectProgramId,
  )[0];
}

export function deriveVenuePda(
  venueId: number,
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VENUE_SEED, venueIdBuffer(venueId)],
    kollectProgramId,
  )[0];
}

export function derivePlaybackPda(
  venuePda: PublicKey,
  dayTimestamp: number,
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [PLAYBACK_SEED, venuePda.toBuffer(), i64Buffer(dayTimestamp)],
    kollectProgramId,
  )[0];
}

export function deriveSettlementPda(
  venuePda: PublicKey,
  periodStart: number,
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SETTLEMENT_SEED, venuePda.toBuffer(), i64Buffer(periodStart)],
    kollectProgramId,
  )[0];
}

export function deriveLicenseTemplatePda(
  ipPda: PublicKey,
  name: number[],
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [LICENSE_TEMPLATE_SEED, ipPda.toBuffer(), Buffer.from(name)],
    kollectProgramId,
  )[0];
}

export function deriveLicensePda(
  licenseTemplatePda: PublicKey,
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [LICENSE_SEED, licenseTemplatePda.toBuffer()],
    kollectProgramId,
  )[0];
}

export function deriveLicenseGrantPda(
  licensePda: PublicKey,
  granteeEntityPda: PublicKey,
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [LICENSE_GRANT_SEED, licensePda.toBuffer(), granteeEntityPda.toBuffer()],
    kollectProgramId,
  )[0];
}

export function deriveRoyaltyPolicyPda(
  licenseTemplatePda: PublicKey,
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [ROYALTY_POLICY_SEED, licenseTemplatePda.toBuffer()],
    kollectProgramId,
  )[0];
}

export function deriveRoyaltySplitPda(
  derivativeIpPda: PublicKey,
  originIpPda: PublicKey,
  kollectProgramId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [ROYALTY_SPLIT_SEED, derivativeIpPda.toBuffer(), originIpPda.toBuffer()],
    kollectProgramId,
  )[0];
}
