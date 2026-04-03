import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  getProvider,
  getPrograms,
  initializeIpCorePrerequisites,
  createTestEntity,
  createTestIp,
  deriveEntityTreasuryPda,
  deriveIpConfigPda,
  deriveIpTreasuryPda,
  derivePlatformConfigPda,
  derivePlatformTreasuryPda,
  deriveVenuePda,
  derivePlaybackPda,
  deriveSettlementPda,
  deriveLicenseTemplatePda,
  deriveLicensePda,
  deriveLicenseGrantPda,
  deriveRoyaltySplitPda,
  getTemplateCount,
  randomHash,
  templateName,
  templateUri,
  signerMeta,
  venueCid,
} from "./setup";
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { deriveEntityPda, getEntityCount } from "../../utils/helper";

const SECONDS_PER_DAY = 86400;
const SETTLEMENT_PERIOD_SECONDS = 604800; // 7 days
const BPS_DENOMINATOR = 10_000;
const DERIVATIVE_SHARE_BPS = 1500; // 15%
const DERIVATIVE_SEED = Buffer.from("derivative");

function dayTimestampDaysAgo(days: number): number {
  const now = Math.floor(Date.now() / 1000);
  const dayAligned = now - (now % SECONDS_PER_DAY);
  return dayAligned - days * SECONDS_PER_DAY;
}

describe("kollect royalty depth enforcement", () => {
  const provider = getProvider();
  const { kollect, ipCore } = getPrograms();
  const authority = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let platformConfigPda: PublicKey;
  let platformTreasuryPda: PublicKey;

  // Entity for all IPs (self-licensing)
  let entityPda: PublicKey;
  let entityTreasuryPda: PublicKey;

  // 4-IP chain: A → B → C → D
  let ipA: PublicKey;
  let ipB: PublicKey;
  let ipC: PublicKey;
  let ipD: PublicKey;

  // Royalty splits
  let splitBA: PublicKey; // B→A (B is derivative of A)
  let splitCB: PublicKey; // C→B (C is derivative of B)
  let splitDC: PublicKey; // D→C (D is derivative of C)

  // IP treasuries + token accounts
  let ipTreasuryA: PublicKey;
  let ipTreasuryB: PublicKey;
  let ipTreasuryC: PublicKey;
  let ipTreasuryD: PublicKey;
  let ipTreasuryAtaA: PublicKey;
  let ipTreasuryAtaB: PublicKey;
  let ipTreasuryAtaC: PublicKey;
  let ipTreasuryAtaD: PublicKey;

  // Settlement fixtures
  let venueId: number;
  let venuePda: PublicKey;
  let venueTokenAccount: PublicKey;
  let platformTreasuryTokenAccount: PublicKey;
  let periodStart: number;
  let commitmentPdas: PublicKey[];

  /**
   * Creates a license template + royalty policy for an IP, purchases a license
   * for the grantee entity, creates a derivative link in ip_core, then onboards
   * the child IP as a derivative in kollect (auto-creating RoyaltySplit).
   */
  async function setupDerivativeChainLink(
    parentIp: PublicKey,
    childIp: PublicKey,
    ownerEntity: PublicKey,
    tplLabel: string,
  ) {
    const parentIpConfig = deriveIpConfigPda(parentIp, kollect.programId);

    // 1. Create global license template (auto-incremented ID)
    const templateId = await getTemplateCount(kollect);
    const tplNameBytes = templateName(tplLabel);
    const licenseTemplatePda = deriveLicenseTemplatePda(
      templateId,
      kollect.programId,
    );

    await kollect.methods
      .createLicenseTemplate({
        templateName: tplNameBytes,
        transferable: true,
        derivativesAllowed: true,
        derivativesReciprocal: false,
        derivativesApproval: false,
        commercialUse: true,
        commercialAttribution: false,
        commercialRevShareBps: 0,
        derivativeRevShareBps: DERIVATIVE_SHARE_BPS,
        uri: templateUri(""),
      })
      .rpc();

    // 2. Create per-IP license
    const licensePda = deriveLicensePda(
      parentIp,
      licenseTemplatePda,
      kollect.programId,
    );

    await kollect.methods
      .createLicense({
        price: new anchor.BN(0),
        maxGrants: 0,
        grantDuration: new anchor.BN(0),
        derivativeRevShareBps: DERIVATIVE_SHARE_BPS,
      })
      .accountsPartial({
        entity: ownerEntity,
        ipConfig: parentIpConfig,
        licenseTemplate: licenseTemplatePda,
        license: licensePda,
      })
      .remainingAccounts([signerMeta(authority.publicKey)])
      .rpc();

    // 3. Purchase license (self-license: same entity is grantee)
    const licenseGrantPda = deriveLicenseGrantPda(
      licensePda,
      ownerEntity,
      kollect.programId,
    );

    const parentIpTreasury = deriveIpTreasuryPda(parentIp, kollect.programId);
    const parentIpTreasuryAta = getAssociatedTokenAddressSync(
      mint,
      parentIpTreasury,
      true,
    );

    const payerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      mint,
      authority.publicKey,
    );

    await kollect.methods
      .purchaseLicense()
      .accountsPartial({
        granteeEntity: ownerEntity,
        license: licensePda,
        licenseGrant: licenseGrantPda,
        payerTokenAccount: payerAta.address,
        platformTokenAccount: platformTreasuryTokenAccount,
        ipTreasuryTokenAccount: parentIpTreasuryAta,
      })
      .remainingAccounts([signerMeta(authority.publicKey)])
      .rpc();

    // 4. Create derivative link in ip_core
    await ipCore.methods
      .createDerivativeLink()
      .accountsPartial({
        parentIp,
        childIp,
        childOwnerEntity: ownerEntity,
        controller: authority.publicKey,
        licenseGrant: licenseGrantPda,
        license: licensePda,
        licenseProgram: kollect.programId,
      })
      .rpc();

    // 5. Onboard child IP as derivative in kollect
    const derivativeLinkPda = PublicKey.findProgramAddressSync(
      [DERIVATIVE_SEED, parentIp.toBuffer(), childIp.toBuffer()],
      ipCore.programId,
    )[0];

    const royaltySplitPda = deriveRoyaltySplitPda(
      childIp,
      parentIp,
      kollect.programId,
    );

    await kollect.methods
      .onboardIp(null)
      .accounts({
        entity: ownerEntity,
        ipAccount: childIp,
        currencyMint: mint,
      })
      .remainingAccounts([
        { pubkey: derivativeLinkPda, isSigner: false, isWritable: false },
        { pubkey: licenseGrantPda, isSigner: false, isWritable: false },
        { pubkey: licensePda, isSigner: false, isWritable: false },
        { pubkey: royaltySplitPda, isSigner: false, isWritable: true },
      ])
      .rpc();

    return { royaltySplitPda, licenseGrantPda, licensePda };
  }

  before(async () => {
    const state = await initializeIpCorePrerequisites();
    mint = state.mint;

    platformConfigPda = derivePlatformConfigPda(kollect.programId);
    platformTreasuryPda = derivePlatformTreasuryPda(kollect.programId);

    // Ensure platform treasury ATA exists
    const platformAtaAcct = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      mint,
      platformTreasuryPda,
      true,
    );
    platformTreasuryTokenAccount = platformAtaAcct.address;

    // Create entity + entity treasury
    const entity = await createTestEntity("royalty_depth_entity");
    entityPda = entity.entityPda;
    entityTreasuryPda = deriveEntityTreasuryPda(entityPda, kollect.programId);

    try {
      await kollect.account.entityTreasury.fetch(entityTreasuryPda);
    } catch {
      await kollect.methods
        .initializeEntityTreasury(authority.publicKey)
        .accounts({ entity: entityPda, currencyMint: mint })
        .rpc();
    }

    // Create 4 IPs
    const ipAResult = await createTestIp(entityPda);
    const ipBResult = await createTestIp(entityPda);
    const ipCResult = await createTestIp(entityPda);
    const ipDResult = await createTestIp(entityPda);
    ipA = ipAResult.ipPda;
    ipB = ipBResult.ipPda;
    ipC = ipCResult.ipPda;
    ipD = ipDResult.ipPda;

    // Onboard IP_A (root, non-derivative)
    await kollect.methods
      .onboardIp(null)
      .accounts({ entity: entityPda, ipAccount: ipA, currencyMint: mint })
      .rpc();

    // Build chain: A → B → C → D
    const linkAB = await setupDerivativeChainLink(
      ipA,
      ipB,
      entityPda,
      "depth_lic_ab",
    );
    splitBA = linkAB.royaltySplitPda;

    const linkBC = await setupDerivativeChainLink(
      ipB,
      ipC,
      entityPda,
      "depth_lic_bc",
    );
    splitCB = linkBC.royaltySplitPda;

    const linkCD = await setupDerivativeChainLink(
      ipC,
      ipD,
      entityPda,
      "depth_lic_cd",
    );
    splitDC = linkCD.royaltySplitPda;

    // Resolve IP treasury PDAs and ATAs
    ipTreasuryA = deriveIpTreasuryPda(ipA, kollect.programId);
    ipTreasuryB = deriveIpTreasuryPda(ipB, kollect.programId);
    ipTreasuryC = deriveIpTreasuryPda(ipC, kollect.programId);
    ipTreasuryD = deriveIpTreasuryPda(ipD, kollect.programId);

    ipTreasuryAtaA = getAssociatedTokenAddressSync(mint, ipTreasuryA, true);
    ipTreasuryAtaB = getAssociatedTokenAddressSync(mint, ipTreasuryB, true);
    ipTreasuryAtaC = getAssociatedTokenAddressSync(mint, ipTreasuryC, true);
    ipTreasuryAtaD = getAssociatedTokenAddressSync(mint, ipTreasuryD, true);

    // Register venue for settlement
    venueId = 9200;
    venuePda = deriveVenuePda(venueId, kollect.programId);

    try {
      await kollect.account.venueAccount.fetch(venuePda);
    } catch {
      await kollect.methods
        .registerVenue(new anchor.BN(venueId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmDepthTestVenue"),
          multiplierBps: 10_000,
        })
        .rpc();
    }

    // Submit 7 days of playback for IP_D
    periodStart = dayTimestampDaysAgo(14);
    commitmentPdas = [];

    for (let i = 0; i < 7; i++) {
      const dayTs = periodStart + i * SECONDS_PER_DAY;
      const pda = derivePlaybackPda(venuePda, dayTs, kollect.programId);
      commitmentPdas.push(pda);

      await kollect.methods
        .submitPlayback(new anchor.BN(dayTs), randomHash(), new anchor.BN(100))
        .accountsPartial({ venue: venuePda })
        .rpc();
    }

    // Fund venue token account
    const venueAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      mint,
      authority.publicKey,
    );
    venueTokenAccount = venueAta.address;

    await mintTo(
      provider.connection,
      authority.payer,
      mint,
      venueTokenAccount,
      authority.publicKey,
      1_000_000_000,
    );

    // Set max_derivatives_depth to 2
    await kollect.methods
      .updatePlatformConfig({
        newAuthority: null,
        newBasePricePerPlay: null,
        newPlatformFeeBps: null,
        newMaxDerivativesDepth: 2,
        newMaxLicenseTypes: null,
      })
      .rpc();

    const config = await kollect.account.platformConfig.fetch(
      platformConfigPda,
    );
    expect(config.maxDerivativesDepth).to.equal(2);
  });

  describe("settle_period with derivative chain", () => {
    it("distributes royalties only up to max_derivatives_depth levels", async () => {
      const ipConfigD = deriveIpConfigPda(ipD, kollect.programId);

      const settledAt = Math.floor(Date.now() / 1000);
      const settlementPda = deriveSettlementPda(
        venuePda,
        periodStart,
        settledAt,
        kollect.programId,
      );

      // Total plays: 7 days × 100 = 700
      // basePricePerPlay=200_000, multiplierBps=10_000 => effectivePrice=200_000
      // amount = 200_000 * 700 = 140_000_000
      const distributionAmount = 140_000_000;
      const distributions = [
        {
          ipAccount: ipD,
          amount: new anchor.BN(distributionAmount),
          plays: new anchor.BN(700),
        },
      ];

      // Record balances before settlement
      const balanceBefore = async (ata: PublicKey) => {
        try {
          const info = await provider.connection.getTokenAccountBalance(ata);
          return Number(info.value.amount);
        } catch {
          return 0;
        }
      };

      const ipABefore = await balanceBefore(ipTreasuryAtaA);
      const ipBBefore = await balanceBefore(ipTreasuryAtaB);
      const ipCBefore = await balanceBefore(ipTreasuryAtaC);
      const ipDBefore = await balanceBefore(ipTreasuryAtaD);

      // remaining_accounts layout:
      //   commitments (writable)
      //   [ipConfig_D, ipTreasury_D, ata_D]               ← the distributing IP
      //   [royaltySplit_D→C, ipTreasury_C, ata_C]          ← depth 0
      //   [royaltySplit_C→B, ipTreasury_B, ata_B]          ← depth 1
      //   (no B→A accounts — loop stops at depth=2)
      const remainingAccounts = [
        ...commitmentPdas.map((pda) => ({
          pubkey: pda,
          isSigner: false,
          isWritable: true,
        })),
        // IP_D base accounts
        { pubkey: ipConfigD, isSigner: false, isWritable: false },
        { pubkey: ipTreasuryD, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryAtaD, isSigner: false, isWritable: true },
        // Depth 0: D→C royalty split
        { pubkey: splitDC, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryC, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryAtaC, isSigner: false, isWritable: true },
        // Depth 1: C→B royalty split
        { pubkey: splitCB, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryB, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryAtaB, isSigner: false, isWritable: true },
        // No depth 2 (B→A) — enforcement test
      ];

      await kollect.methods
        .settlePeriod(
          new anchor.BN(periodStart),
          new anchor.BN(settledAt),
          distributions,
        )
        .accountsPartial({
          venueAuthority: authority.publicKey,
          venue: venuePda,
          settlement: settlementPda,
          venueTokenAccount,
          platformTreasuryTokenAccount,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();

      // Read balances after settlement
      const ipAAfter = await balanceBefore(ipTreasuryAtaA);
      const ipBAfter = await balanceBefore(ipTreasuryAtaB);
      const ipCAfter = await balanceBefore(ipTreasuryAtaC);
      const ipDAfter = await balanceBefore(ipTreasuryAtaD);

      const ipADelta = ipAAfter - ipABefore;
      const ipBDelta = ipBAfter - ipBBefore;
      const ipCDelta = ipCAfter - ipCBefore;
      const ipDDelta = ipDAfter - ipDBefore;

      // Calculate expected values
      // Platform fee is deducted from venue total separately.
      // Per-IP royalty chain walks on the full distribution.amount.
      const netToIpD = distributionAmount;

      // Depth 0: D→C royalty (15% of distribution amount)
      const royaltyToC = Math.floor(
        (netToIpD * DERIVATIVE_SHARE_BPS) / BPS_DENOMINATOR,
      );
      const afterC = netToIpD - royaltyToC;

      // Depth 1: C→B royalty (15% of remaining after C's cut)
      const royaltyToB = Math.floor(
        (afterC * DERIVATIVE_SHARE_BPS) / BPS_DENOMINATOR,
      );
      const finalToD = afterC - royaltyToB;

      // IP_A should get NOTHING (depth limit = 2, so B→A is never walked)
      expect(ipADelta).to.equal(
        0,
        "IP_A should receive zero (beyond depth limit)",
      );

      // IP_B should receive its 15% share
      expect(ipBDelta).to.equal(
        royaltyToB,
        "IP_B should receive depth-1 royalty",
      );

      // IP_C should receive its 15% share
      expect(ipCDelta).to.equal(
        royaltyToC,
        "IP_C should receive depth-0 royalty",
      );

      // IP_D should receive the remainder
      expect(ipDDelta).to.equal(
        finalToD,
        "IP_D should receive remainder after royalties",
      );

      // Verify settlement record
      const record = await kollect.account.settlementRecord.fetch(
        settlementPda,
      );
      expect(record.venue.toString()).to.equal(venuePda.toString());
      expect(record.totalPlays.toNumber()).to.equal(700);
      expect(record.ipCount).to.equal(1);
    });
  });

  // ─── T13: max_derivatives_depth=3 full chain ──────────────────────────

  describe("settle_period with max_derivatives_depth=3", () => {
    it("distributes royalties through the full A→B→C→D chain", async () => {
      // Increase depth to 3 (was 2 from previous test)
      await kollect.methods
        .updatePlatformConfig({
          newAuthority: null,
          newBasePricePerPlay: null,
          newPlatformFeeBps: null,
          newMaxDerivativesDepth: 3,
          newMaxLicenseTypes: null,
        })
        .rpc();

      const config = await kollect.account.platformConfig.fetch(
        platformConfigPda,
      );
      expect(config.maxDerivativesDepth).to.equal(3);

      // Submit 7 new days of playback (different period to avoid collision)
      const newPeriodStart = dayTimestampDaysAgo(28);
      const newCommitmentPdas: PublicKey[] = [];

      for (let i = 0; i < 7; i++) {
        const dayTs = newPeriodStart + i * SECONDS_PER_DAY;
        newCommitmentPdas.push(
          derivePlaybackPda(venuePda, dayTs, kollect.programId),
        );

        await kollect.methods
          .submitPlayback(
            new anchor.BN(dayTs),
            randomHash(),
            new anchor.BN(100),
          )
          .accountsPartial({ venue: venuePda })
          .rpc();
      }

      // Ensure venue has sufficient tokens
      await mintTo(
        provider.connection,
        authority.payer,
        mint,
        venueTokenAccount,
        authority.publicKey,
        1_000_000_000,
      );

      const ipConfigD = deriveIpConfigPda(ipD, kollect.programId);
      const settledAt = Math.floor(Date.now() / 1000);
      const settlementPda = deriveSettlementPda(
        venuePda,
        newPeriodStart,
        settledAt,
        kollect.programId,
      );

      const distributionAmount = 140_000_000;
      const distributions = [
        {
          ipAccount: ipD,
          amount: new anchor.BN(distributionAmount),
          plays: new anchor.BN(700),
        },
      ];

      // Record balances before settlement
      const balanceBefore = async (ata: PublicKey) => {
        try {
          const info = await provider.connection.getTokenAccountBalance(ata);
          return Number(info.value.amount);
        } catch {
          return 0;
        }
      };

      const ipABefore = await balanceBefore(ipTreasuryAtaA);
      const ipBBefore = await balanceBefore(ipTreasuryAtaB);
      const ipCBefore = await balanceBefore(ipTreasuryAtaC);
      const ipDBefore = await balanceBefore(ipTreasuryAtaD);

      // remaining_accounts now includes B→A at depth 2
      const remainingAccounts = [
        ...newCommitmentPdas.map((pda) => ({
          pubkey: pda,
          isSigner: false,
          isWritable: true,
        })),
        // IP_D base accounts
        { pubkey: ipConfigD, isSigner: false, isWritable: false },
        { pubkey: ipTreasuryD, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryAtaD, isSigner: false, isWritable: true },
        // Depth 0: D→C
        { pubkey: splitDC, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryC, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryAtaC, isSigner: false, isWritable: true },
        // Depth 1: C→B
        { pubkey: splitCB, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryB, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryAtaB, isSigner: false, isWritable: true },
        // Depth 2: B→A (now included since depth=3)
        { pubkey: splitBA, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryA, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryAtaA, isSigner: false, isWritable: true },
      ];

      await kollect.methods
        .settlePeriod(
          new anchor.BN(newPeriodStart),
          new anchor.BN(settledAt),
          distributions,
        )
        .accountsPartial({
          venueAuthority: authority.publicKey,
          venue: venuePda,
          settlement: settlementPda,
          venueTokenAccount,
          platformTreasuryTokenAccount,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();

      // Read balances after
      const ipAAfter = await balanceBefore(ipTreasuryAtaA);
      const ipBAfter = await balanceBefore(ipTreasuryAtaB);
      const ipCAfter = await balanceBefore(ipTreasuryAtaC);
      const ipDAfter = await balanceBefore(ipTreasuryAtaD);

      const ipADelta = ipAAfter - ipABefore;
      const ipBDelta = ipBAfter - ipBBefore;
      const ipCDelta = ipCAfter - ipCBefore;
      const ipDDelta = ipDAfter - ipDBefore;

      // Calculate expected: depth=3 walks D→C→B→A (all 3 levels)
      const netToIpD = distributionAmount;

      // Depth 0: D→C (15% of 140M)
      const royaltyToC = Math.floor(
        (netToIpD * DERIVATIVE_SHARE_BPS) / BPS_DENOMINATOR,
      );
      const afterC = netToIpD - royaltyToC;

      // Depth 1: C→B (15% of remainder after C)
      const royaltyToB = Math.floor(
        (afterC * DERIVATIVE_SHARE_BPS) / BPS_DENOMINATOR,
      );
      const afterB = afterC - royaltyToB;

      // Depth 2: B→A (15% of remainder after B)
      const royaltyToA = Math.floor(
        (afterB * DERIVATIVE_SHARE_BPS) / BPS_DENOMINATOR,
      );
      const finalToD = afterB - royaltyToA;

      expect(ipADelta).to.equal(
        royaltyToA,
        "IP_A should receive depth-2 royalty",
      );
      expect(ipBDelta).to.equal(
        royaltyToB,
        "IP_B should receive depth-1 royalty",
      );
      expect(ipCDelta).to.equal(
        royaltyToC,
        "IP_C should receive depth-0 royalty",
      );
      expect(ipDDelta).to.equal(
        finalToD,
        "IP_D should receive remainder after all royalties",
      );
    });
  });
});
