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
  randomHash,
  venueIdBuffer,
  venueCid,
} from "./setup";
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const SECONDS_PER_DAY = 86400;
const SETTLEMENT_PERIOD_SECONDS = 604800; // 7 days

/**
 * Returns a day-aligned timestamp (midnight UTC) for N days ago.
 */
function dayTimestampDaysAgo(days: number): number {
  const now = Math.floor(Date.now() / 1000);
  const dayAligned = now - (now % SECONDS_PER_DAY);
  return dayAligned - days * SECONDS_PER_DAY;
}

describe("kollect playback & settlement", () => {
  const provider = getProvider();
  const { kollect } = getPrograms();
  const authority = provider.wallet as anchor.Wallet;

  let platformConfigPda: PublicKey;
  let venueId: number;
  let venuePda: PublicKey;

  before(async () => {
    await initializeIpCorePrerequisites();

    platformConfigPda = derivePlatformConfigPda(kollect.programId);
    await kollect.account.platformConfig.fetch(platformConfigPda);

    // Register a venue for playback tests
    venueId = 9000;
    venuePda = deriveVenuePda(venueId, kollect.programId);

    try {
      await kollect.account.venueAccount.fetch(venuePda);
    } catch {
      await kollect.methods
        .registerVenue(new anchor.BN(venueId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmPlaybackVenue"),
          multiplierBps: 10_000,
        })
        .rpc();
    }
  });

  // ─── Submit Playback ───────────────────────────────────────────────────────

  describe("submit_playback", () => {
    it("submits a single-day playback commitment", async () => {
      const dayTs = dayTimestampDaysAgo(20);
      const commitmentHash = randomHash();
      const totalPlays = 1500;
      const commitmentPda = derivePlaybackPda(
        venuePda,
        dayTs,
        kollect.programId,
      );

      await kollect.methods
        .submitPlayback(
          new anchor.BN(dayTs),
          commitmentHash,
          new anchor.BN(totalPlays),
        )
        .accountsPartial({
          venue: venuePda,
        })
        .rpc();

      const commitment = await kollect.account.playbackCommitment.fetch(
        commitmentPda,
      );
      expect(commitment.venue.toString()).to.equal(venuePda.toString());
      expect(commitment.dayTimestamp.toNumber()).to.equal(dayTs);
      expect(commitment.commitmentHash).to.deep.equal(commitmentHash);
      expect(commitment.totalPlays.toNumber()).to.equal(totalPlays);
      expect(commitment.settled).to.be.false;
      expect(commitment.submittedAt.toNumber()).to.be.greaterThan(0);
    });

    it("submits multiple days of playback", async () => {
      const day1 = dayTimestampDaysAgo(19);
      const day2 = dayTimestampDaysAgo(18);

      await kollect.methods
        .submitPlayback(new anchor.BN(day1), randomHash(), new anchor.BN(2000))
        .accountsPartial({ venue: venuePda })
        .rpc();

      await kollect.methods
        .submitPlayback(new anchor.BN(day2), randomHash(), new anchor.BN(1800))
        .accountsPartial({ venue: venuePda })
        .rpc();

      const c1 = await kollect.account.playbackCommitment.fetch(
        derivePlaybackPda(venuePda, day1, kollect.programId),
      );
      const c2 = await kollect.account.playbackCommitment.fetch(
        derivePlaybackPda(venuePda, day2, kollect.programId),
      );
      expect(c1.totalPlays.toNumber()).to.equal(2000);
      expect(c2.totalPlays.toNumber()).to.equal(1800);
    });

    it("fails with duplicate day_timestamp (PDA collision)", async () => {
      const dupDay = dayTimestampDaysAgo(20); // same as earlier test

      try {
        await kollect.methods
          .submitPlayback(
            new anchor.BN(dupDay),
            randomHash(),
            new anchor.BN(100),
          )
          .accountsPartial({ venue: venuePda })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err).to.exist;
      }
    });

    it("fails with non-day-aligned timestamp", async () => {
      const nonAligned = dayTimestampDaysAgo(15) + 3600; // off by 1 hour

      try {
        await kollect.methods
          .submitPlayback(
            new anchor.BN(nonAligned),
            randomHash(),
            new anchor.BN(100),
          )
          .accountsPartial({ venue: venuePda })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidDayTimestamp");
      }
    });

    it("fails with deactivated venue", async () => {
      // Register and deactivate another venue
      const deactVenueId = 9001;
      const deactVenuePda = deriveVenuePda(deactVenueId, kollect.programId);

      try {
        await kollect.account.venueAccount.fetch(deactVenuePda);
      } catch {
        await kollect.methods
          .registerVenue(new anchor.BN(deactVenueId), {
            venueAuthority: authority.publicKey,
            cid: venueCid("QmDeactVenue"),
            multiplierBps: 10_000,
          })
          .rpc();
      }

      await kollect.methods
        .deactivateVenue()
        .accountsPartial({ venue: deactVenuePda })
        .rpc();

      try {
        await kollect.methods
          .submitPlayback(
            new anchor.BN(dayTimestampDaysAgo(5)),
            randomHash(),
            new anchor.BN(100),
          )
          .accountsPartial({ venue: deactVenuePda })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("VenueNotActive");
      }
    });

    it("fails with wrong authority", async () => {
      const fakeAuthority = anchor.web3.Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        fakeAuthority.publicKey,
        2_000_000_000,
      );
      await provider.connection.confirmTransaction(airdropSig);

      const dayTs = dayTimestampDaysAgo(16);

      try {
        await kollect.methods
          .submitPlayback(
            new anchor.BN(dayTs),
            randomHash(),
            new anchor.BN(100),
          )
          .accountsPartial({
            authority: fakeAuthority.publicKey,
            venue: venuePda,
          })
          .signers([fakeAuthority])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAuthority");
      }
    });
  });

  // ─── Settle Period ─────────────────────────────────────────────────────────

  describe("settle_period", () => {
    let settlementVenueId: number;
    let settlementVenuePda: PublicKey;
    let periodStart: number;
    let commitmentPdas: PublicKey[];
    let mint: PublicKey;
    let venueTokenAccount: PublicKey;
    let platformTreasuryTokenAccount: PublicKey;
    let usedSettledAt: number;

    before(async () => {
      // Create a dedicated venue for settlement tests
      settlementVenueId = 9100;
      settlementVenuePda = deriveVenuePda(settlementVenueId, kollect.programId);

      try {
        await kollect.account.venueAccount.fetch(settlementVenuePda);
      } catch {
        await kollect.methods
          .registerVenue(new anchor.BN(settlementVenueId), {
            venueAuthority: authority.publicKey,
            cid: venueCid("QmSettlementVenue"),
            multiplierBps: 10_000,
          })
          .rpc();
      }

      // Period starts 14 days ago so period_end = 7 days ago (already passed)
      periodStart = dayTimestampDaysAgo(14);
      commitmentPdas = [];

      // Submit commitments within the period (days 14..8 ago)
      for (let i = 0; i < 7; i++) {
        const dayTs = periodStart + i * SECONDS_PER_DAY;
        const pda = derivePlaybackPda(
          settlementVenuePda,
          dayTs,
          kollect.programId,
        );
        commitmentPdas.push(pda);

        await kollect.methods
          .submitPlayback(
            new anchor.BN(dayTs),
            randomHash(),
            new anchor.BN(100 + i * 10),
          )
          .accountsPartial({ venue: settlementVenuePda })
          .rpc();
      }

      // Setup token accounts for settlement
      const config = await kollect.account.platformConfig.fetch(
        platformConfigPda,
      );
      mint = config.currency;
      const platformTreasuryPda = derivePlatformTreasuryPda(kollect.programId);

      const venueAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        authority.publicKey,
      );
      venueTokenAccount = venueAta.address;

      const platformAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        platformTreasuryPda,
        true,
      );
      platformTreasuryTokenAccount = platformAta.address;

      // Fund venue token account
      await mintTo(
        provider.connection,
        authority.payer,
        mint,
        venueTokenAccount,
        authority.publicKey,
        1_000_000_000,
      );
    });

    it("settles a period with commitments", async () => {
      // Create a test entity + IP for distributions
      const entity = await createTestEntity("settle_entity");
      const entityTreasuryPda = deriveEntityTreasuryPda(
        entity.entityPda,
        kollect.programId,
      );

      try {
        await kollect.account.entityTreasury.fetch(entityTreasuryPda);
      } catch {
        await kollect.methods
          .initializeEntityTreasury(authority.publicKey)
          .accounts({ entity: entity.entityPda, currencyMint: mint })
          .rpc();
      }

      const ip = await createTestIp(entity.entityPda);
      const ipConfigPda = deriveIpConfigPda(ip.ipPda, kollect.programId);
      try {
        await kollect.account.ipConfig.fetch(ipConfigPda);
      } catch {
        await kollect.methods
          .onboardIp(null)
          .accounts({
            entity: entity.entityPda,
            ipAccount: ip.ipPda,
            currencyMint: mint,
          })
          .rpc();
      }

      // Create IP treasury token account
      const ipTreasuryPda = deriveIpTreasuryPda(ip.ipPda, kollect.programId);
      const ipTreasuryAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        ipTreasuryPda,
        true,
      );

      // settled_at must be close to on-chain clock (within 30s tolerance)
      usedSettledAt = Math.floor(Date.now() / 1000);
      const settlementPda = deriveSettlementPda(
        settlementVenuePda,
        periodStart,
        usedSettledAt,
        kollect.programId,
      );

      // Total plays: 100+110+120+130+140+150+160 = 910
      // basePricePerPlay=200_000, multiplierBps=10_000 => effectivePrice=200_000
      // amount = 200_000 * 910 = 182_000_000
      const distributions = [
        {
          ipAccount: ip.ipPda,
          amount: new anchor.BN(182_000_000),
          plays: new anchor.BN(910),
        },
      ];

      // remaining_accounts: commitment PDAs, then per-IP [IpConfig, IpTreasury, ipTreasuryTokenAccount]
      const remainingAccounts = [
        ...commitmentPdas.map((pda) => ({
          pubkey: pda,
          isSigner: false,
          isWritable: true,
        })),
        { pubkey: ipConfigPda, isSigner: false, isWritable: false },
        { pubkey: ipTreasuryPda, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryAta.address, isSigner: false, isWritable: true },
      ];

      await kollect.methods
        .settlePeriod(
          new anchor.BN(periodStart),
          new anchor.BN(usedSettledAt),
          distributions,
        )
        .accountsPartial({
          venueAuthority: authority.publicKey,
          venue: settlementVenuePda,
          settlement: settlementPda,
          venueTokenAccount,
          platformTreasuryTokenAccount,
        })
        .remainingAccounts(remainingAccounts)
        .rpc();

      const record = await kollect.account.settlementRecord.fetch(
        settlementPda,
      );
      expect(record.venue.toString()).to.equal(settlementVenuePda.toString());
      expect(record.periodStart.toNumber()).to.equal(periodStart);
      expect(record.periodEnd.toNumber()).to.equal(
        periodStart + SETTLEMENT_PERIOD_SECONDS,
      );
      expect(record.totalPlays.toNumber()).to.equal(910);
      expect(record.commitmentCount).to.equal(7);
      expect(record.ipCount).to.equal(1);
      expect(record.settledAt.toNumber()).to.equal(usedSettledAt);

      // Verify commitments are marked as settled
      for (const pda of commitmentPdas) {
        const commitment = await kollect.account.playbackCommitment.fetch(pda);
        expect(commitment.settled).to.be.true;
      }
    });

    it("fails with period not yet ended", async () => {
      // Use a period_start of today — no commitments exist for this period
      const futurePeriodStart = dayTimestampDaysAgo(0);
      const futureSettledAt = Math.floor(Date.now() / 1000);
      const futureSettlementPda = deriveSettlementPda(
        settlementVenuePda,
        futurePeriodStart,
        futureSettledAt,
        kollect.programId,
      );

      try {
        await kollect.methods
          .settlePeriod(
            new anchor.BN(futurePeriodStart),
            new anchor.BN(futureSettledAt),
            [],
          )
          .accountsPartial({
            venueAuthority: authority.publicKey,
            venue: settlementVenuePda,
            settlement: futureSettlementPda,
            venueTokenAccount,
            platformTreasuryTokenAccount,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("NoCommitmentsToSettle");
      }
    });

    it("fails with duplicate settlement period (PDA collision)", async () => {
      const settlementPda = deriveSettlementPda(
        settlementVenuePda,
        periodStart,
        usedSettledAt,
        kollect.programId,
      );

      try {
        await kollect.methods
          .settlePeriod(
            new anchor.BN(periodStart),
            new anchor.BN(usedSettledAt),
            [],
          )
          .accountsPartial({
            venueAuthority: authority.publicKey,
            venue: settlementVenuePda,
            settlement: settlementPda,
            venueTokenAccount,
            platformTreasuryTokenAccount,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err).to.exist;
      }
    });

    it("fails with no commitments to settle", async () => {
      // Use a different past period with no commitments
      const emptyPeriodStart = dayTimestampDaysAgo(28);
      const emptySettledAt = Math.floor(Date.now() / 1000);
      const emptySettlementPda = deriveSettlementPda(
        settlementVenuePda,
        emptyPeriodStart,
        emptySettledAt,
        kollect.programId,
      );

      try {
        await kollect.methods
          .settlePeriod(
            new anchor.BN(emptyPeriodStart),
            new anchor.BN(emptySettledAt),
            [],
          )
          .accountsPartial({
            venueAuthority: authority.publicKey,
            venue: settlementVenuePda,
            settlement: emptySettlementPda,
            venueTokenAccount,
            platformTreasuryTokenAccount,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("NoCommitmentsToSettle");
      }
    });

    it("fails with wrong authority", async () => {
      const fakeAuth = anchor.web3.Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        fakeAuth.publicKey,
        2_000_000_000,
      );
      await provider.connection.confirmTransaction(airdropSig);

      const otherPeriodStart = dayTimestampDaysAgo(21);
      const otherSettledAt = Math.floor(Date.now() / 1000);
      const otherSettlementPda = deriveSettlementPda(
        settlementVenuePda,
        otherPeriodStart,
        otherSettledAt,
        kollect.programId,
      );

      try {
        await kollect.methods
          .settlePeriod(
            new anchor.BN(otherPeriodStart),
            new anchor.BN(otherSettledAt),
            [],
          )
          .accountsPartial({
            authority: fakeAuth.publicKey,
            venueAuthority: authority.publicKey,
            venue: settlementVenuePda,
            settlement: otherSettlementPda,
            venueTokenAccount,
            platformTreasuryTokenAccount,
          })
          .signers([fakeAuth])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAuthority");
      }
    });

    // ─── T4: Partial Settlement ────────────────────────────────────────────

    describe("partial settlement", () => {
      let partialVenuePda: PublicKey;
      let partialPeriodStart: number;
      let partialCommitmentPdas: PublicKey[];
      let partialIpPda: PublicKey;
      let partialIpConfigPda: PublicKey;
      let partialIpTreasuryPda: PublicKey;
      let partialIpTreasuryAta: PublicKey;

      before(async () => {
        const partialVenueId = 9102;
        partialVenuePda = deriveVenuePda(partialVenueId, kollect.programId);

        await kollect.methods
          .registerVenue(new anchor.BN(partialVenueId), {
            venueAuthority: authority.publicKey,
            cid: venueCid("QmPartialVenue"),
            multiplierBps: 10_000,
          })
          .rpc();

        partialPeriodStart = dayTimestampDaysAgo(14);
        partialCommitmentPdas = [];

        for (let i = 0; i < 7; i++) {
          const dayTs = partialPeriodStart + i * SECONDS_PER_DAY;
          partialCommitmentPdas.push(
            derivePlaybackPda(partialVenuePda, dayTs, kollect.programId),
          );

          await kollect.methods
            .submitPlayback(
              new anchor.BN(dayTs),
              randomHash(),
              new anchor.BN(100),
            )
            .accountsPartial({ venue: partialVenuePda })
            .rpc();
        }

        // Create entity + IP for distributions
        const entity = await createTestEntity("partial_settle_ent");
        const entityTreasuryPda = deriveEntityTreasuryPda(
          entity.entityPda,
          kollect.programId,
        );

        await kollect.methods
          .initializeEntityTreasury(authority.publicKey)
          .accounts({ entity: entity.entityPda, currencyMint: mint })
          .rpc();

        const ip = await createTestIp(entity.entityPda);
        partialIpPda = ip.ipPda;
        partialIpConfigPda = deriveIpConfigPda(partialIpPda, kollect.programId);
        partialIpTreasuryPda = deriveIpTreasuryPda(
          partialIpPda,
          kollect.programId,
        );

        await kollect.methods
          .onboardIp(null)
          .accounts({
            entity: entity.entityPda,
            ipAccount: partialIpPda,
            currencyMint: mint,
          })
          .rpc();

        partialIpTreasuryAta = getAssociatedTokenAddressSync(
          mint,
          partialIpTreasuryPda,
          true,
        );

        // Ensure venue has enough tokens
        await mintTo(
          provider.connection,
          authority.payer,
          mint,
          venueTokenAccount,
          authority.publicKey,
          500_000_000,
        );
      });

      it("settles a period in two partial batches", async () => {
        // First partial: 3 days (300 plays)
        const settledAt1 = Math.floor(Date.now() / 1000);
        const settlementPda1 = deriveSettlementPda(
          partialVenuePda,
          partialPeriodStart,
          settledAt1,
          kollect.programId,
        );

        // effective = 200_000 * 10_000/10_000 = 200_000; amount = 200_000 * 300 = 60_000_000
        await kollect.methods
          .settlePeriod(
            new anchor.BN(partialPeriodStart),
            new anchor.BN(settledAt1),
            [
              {
                ipAccount: partialIpPda,
                amount: new anchor.BN(60_000_000),
                plays: new anchor.BN(300),
              },
            ],
          )
          .accountsPartial({
            venueAuthority: authority.publicKey,
            venue: partialVenuePda,
            settlement: settlementPda1,
            venueTokenAccount,
            platformTreasuryTokenAccount,
          })
          .remainingAccounts([
            ...partialCommitmentPdas.slice(0, 3).map((pda) => ({
              pubkey: pda,
              isSigner: false,
              isWritable: true,
            })),
            {
              pubkey: partialIpConfigPda,
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: partialIpTreasuryPda,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: partialIpTreasuryAta,
              isSigner: false,
              isWritable: true,
            },
          ])
          .rpc();

        const record1 = await kollect.account.settlementRecord.fetch(
          settlementPda1,
        );
        expect(record1.totalPlays.toNumber()).to.equal(300);
        expect(record1.commitmentCount).to.equal(3);

        // Wait for different settled_at timestamp
        await new Promise((r) => setTimeout(r, 1100));

        // Second partial: 4 days (400 plays)
        const settledAt2 = Math.floor(Date.now() / 1000);
        const settlementPda2 = deriveSettlementPda(
          partialVenuePda,
          partialPeriodStart,
          settledAt2,
          kollect.programId,
        );

        await kollect.methods
          .settlePeriod(
            new anchor.BN(partialPeriodStart),
            new anchor.BN(settledAt2),
            [
              {
                ipAccount: partialIpPda,
                amount: new anchor.BN(80_000_000),
                plays: new anchor.BN(400),
              },
            ],
          )
          .accountsPartial({
            venueAuthority: authority.publicKey,
            venue: partialVenuePda,
            settlement: settlementPda2,
            venueTokenAccount,
            platformTreasuryTokenAccount,
          })
          .remainingAccounts([
            ...partialCommitmentPdas.slice(3).map((pda) => ({
              pubkey: pda,
              isSigner: false,
              isWritable: true,
            })),
            {
              pubkey: partialIpConfigPda,
              isSigner: false,
              isWritable: false,
            },
            {
              pubkey: partialIpTreasuryPda,
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: partialIpTreasuryAta,
              isSigner: false,
              isWritable: true,
            },
          ])
          .rpc();

        const record2 = await kollect.account.settlementRecord.fetch(
          settlementPda2,
        );
        expect(record2.totalPlays.toNumber()).to.equal(400);
        expect(record2.commitmentCount).to.equal(4);

        // Verify all 7 commitments are settled
        for (const pda of partialCommitmentPdas) {
          const c = await kollect.account.playbackCommitment.fetch(pda);
          expect(c.settled).to.be.true;
        }
      });
    });

    // ─── T5: Price Override + Venue Multiplier ─────────────────────────────

    it("applies venue multiplier to price override", async () => {
      // Create entity + IP with override = 300_000
      const entity = await createTestEntity("override_mult_ent");
      const entityTreasuryPda = deriveEntityTreasuryPda(
        entity.entityPda,
        kollect.programId,
      );

      await kollect.methods
        .initializeEntityTreasury(authority.publicKey)
        .accounts({ entity: entity.entityPda, currencyMint: mint })
        .rpc();

      const ip = await createTestIp(entity.entityPda);

      await kollect.methods
        .onboardIp(new anchor.BN(300_000))
        .accounts({
          entity: entity.entityPda,
          ipAccount: ip.ipPda,
          currencyMint: mint,
        })
        .rpc();

      const ipConfigPda = deriveIpConfigPda(ip.ipPda, kollect.programId);
      const ipTreasuryPda = deriveIpTreasuryPda(ip.ipPda, kollect.programId);
      const ipTreasuryAta = getAssociatedTokenAddressSync(
        mint,
        ipTreasuryPda,
        true,
      );

      // Register venue with multiplier_bps = 15_000 (1.5x)
      const multVenueId = 9103;
      const multVenuePda = deriveVenuePda(multVenueId, kollect.programId);

      await kollect.methods
        .registerVenue(new anchor.BN(multVenueId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmMultiplierVenue"),
          multiplierBps: 15_000,
        })
        .rpc();

      // Submit 1 day playback (100 plays)
      const dayTs = dayTimestampDaysAgo(14);
      const commitmentPda = derivePlaybackPda(
        multVenuePda,
        dayTs,
        kollect.programId,
      );

      await kollect.methods
        .submitPlayback(new anchor.BN(dayTs), randomHash(), new anchor.BN(100))
        .accountsPartial({ venue: multVenuePda })
        .rpc();

      // effective_price = calculate_bps(300_000, 15_000) = 450_000
      // distribution.amount = 450_000 * 100 = 45_000_000
      const settledAt = Math.floor(Date.now() / 1000);
      const setlPda = deriveSettlementPda(
        multVenuePda,
        dayTs,
        settledAt,
        kollect.programId,
      );

      await kollect.methods
        .settlePeriod(new anchor.BN(dayTs), new anchor.BN(settledAt), [
          {
            ipAccount: ip.ipPda,
            amount: new anchor.BN(45_000_000),
            plays: new anchor.BN(100),
          },
        ])
        .accountsPartial({
          venueAuthority: authority.publicKey,
          venue: multVenuePda,
          settlement: setlPda,
          venueTokenAccount,
          platformTreasuryTokenAccount,
        })
        .remainingAccounts([
          { pubkey: commitmentPda, isSigner: false, isWritable: true },
          { pubkey: ipConfigPda, isSigner: false, isWritable: false },
          { pubkey: ipTreasuryPda, isSigner: false, isWritable: true },
          { pubkey: ipTreasuryAta, isSigner: false, isWritable: true },
        ])
        .rpc();

      // If the old code (bypass multiplier) were still running, this would fail
      // because it would expect 300_000 * 100 = 30_000_000 ≠ 45_000_000
      const ipTreasury = await kollect.account.ipTreasury.fetch(ipTreasuryPda);
      expect(ipTreasury.totalEarned.toNumber()).to.equal(45_000_000);
    });

    // ─── T6: Platform Fee Verification ─────────────────────────────────────

    it("deducts correct platform fee during settlement", async () => {
      const entity = await createTestEntity("fee_check_entity");

      await kollect.methods
        .initializeEntityTreasury(authority.publicKey)
        .accounts({ entity: entity.entityPda, currencyMint: mint })
        .rpc();

      const ip = await createTestIp(entity.entityPda);
      const ipCfg = deriveIpConfigPda(ip.ipPda, kollect.programId);
      const ipTrs = deriveIpTreasuryPda(ip.ipPda, kollect.programId);

      await kollect.methods
        .onboardIp(null)
        .accounts({
          entity: entity.entityPda,
          ipAccount: ip.ipPda,
          currencyMint: mint,
        })
        .rpc();

      const ipTrsAta = getAssociatedTokenAddressSync(mint, ipTrs, true);

      // Venue with 1x multiplier
      const feeVenueId = 9104;
      const feeVenuePda = deriveVenuePda(feeVenueId, kollect.programId);

      await kollect.methods
        .registerVenue(new anchor.BN(feeVenueId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmFeeCheckVenue"),
          multiplierBps: 10_000,
        })
        .rpc();

      // Submit 1 day (100 plays)
      const dayTs = dayTimestampDaysAgo(14);
      const cPda = derivePlaybackPda(feeVenuePda, dayTs, kollect.programId);

      await kollect.methods
        .submitPlayback(new anchor.BN(dayTs), randomHash(), new anchor.BN(100))
        .accountsPartial({ venue: feeVenuePda })
        .rpc();

      // distribution.amount = 200_000 * 100 = 20_000_000
      const distAmount = 20_000_000;
      const config = await kollect.account.platformConfig.fetch(
        derivePlatformConfigPda(kollect.programId),
      );
      const expectedFee = Math.floor(
        (distAmount * config.platformFeeBps) / 10_000,
      );

      // Capture balances before
      const platBefore = await provider.connection.getTokenAccountBalance(
        platformTreasuryTokenAccount,
      );
      const ipBefore = await provider.connection.getTokenAccountBalance(
        ipTrsAta,
      );

      const sat = Math.floor(Date.now() / 1000);
      const sPda = deriveSettlementPda(
        feeVenuePda,
        dayTs,
        sat,
        kollect.programId,
      );

      await mintTo(
        provider.connection,
        authority.payer,
        mint,
        venueTokenAccount,
        authority.publicKey,
        500_000_000,
      );

      await kollect.methods
        .settlePeriod(new anchor.BN(dayTs), new anchor.BN(sat), [
          {
            ipAccount: ip.ipPda,
            amount: new anchor.BN(distAmount),
            plays: new anchor.BN(100),
          },
        ])
        .accountsPartial({
          venueAuthority: authority.publicKey,
          venue: feeVenuePda,
          settlement: sPda,
          venueTokenAccount,
          platformTreasuryTokenAccount,
        })
        .remainingAccounts([
          { pubkey: cPda, isSigner: false, isWritable: true },
          { pubkey: ipCfg, isSigner: false, isWritable: false },
          { pubkey: ipTrs, isSigner: false, isWritable: true },
          { pubkey: ipTrsAta, isSigner: false, isWritable: true },
        ])
        .rpc();

      const platAfter = await provider.connection.getTokenAccountBalance(
        platformTreasuryTokenAccount,
      );
      const ipAfter = await provider.connection.getTokenAccountBalance(
        ipTrsAta,
      );

      const platDelta =
        Number(platAfter.value.amount) - Number(platBefore.value.amount);
      const ipDelta =
        Number(ipAfter.value.amount) - Number(ipBefore.value.amount);

      expect(platDelta).to.equal(expectedFee, "Platform fee mismatch");
      expect(ipDelta).to.equal(distAmount, "IP treasury net mismatch");
    });

    // ─── T7: Play Count Mismatch ───────────────────────────────────────────

    it("fails with play count mismatch in distributions", async () => {
      const mismatchVenueId = 9105;
      const mismatchVenuePda = deriveVenuePda(
        mismatchVenueId,
        kollect.programId,
      );

      await kollect.methods
        .registerVenue(new anchor.BN(mismatchVenueId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmMismatchVenue"),
          multiplierBps: 10_000,
        })
        .rpc();

      const dayTs = dayTimestampDaysAgo(14);
      const cPda = derivePlaybackPda(
        mismatchVenuePda,
        dayTs,
        kollect.programId,
      );

      await kollect.methods
        .submitPlayback(new anchor.BN(dayTs), randomHash(), new anchor.BN(100))
        .accountsPartial({ venue: mismatchVenuePda })
        .rpc();

      const sat = Math.floor(Date.now() / 1000);
      const sPda = deriveSettlementPda(
        mismatchVenuePda,
        dayTs,
        sat,
        kollect.programId,
      );

      try {
        await kollect.methods
          .settlePeriod(new anchor.BN(dayTs), new anchor.BN(sat), [
            {
              ipAccount: anchor.web3.Keypair.generate().publicKey,
              amount: new anchor.BN(10_000_000),
              plays: new anchor.BN(50), // commitment has 100
            },
          ])
          .accountsPartial({
            venueAuthority: authority.publicKey,
            venue: mismatchVenuePda,
            settlement: sPda,
            venueTokenAccount,
            platformTreasuryTokenAccount,
          })
          .remainingAccounts([
            { pubkey: cPda, isSigner: false, isWritable: true },
          ])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("PlayCountMismatch");
      }
    });

    // ─── T8: Distribution Amount Mismatch ──────────────────────────────────

    it("fails with distribution amount mismatch", async () => {
      const entity = await createTestEntity("amt_mismatch_ent");

      await kollect.methods
        .initializeEntityTreasury(authority.publicKey)
        .accounts({ entity: entity.entityPda, currencyMint: mint })
        .rpc();

      const ip = await createTestIp(entity.entityPda);

      await kollect.methods
        .onboardIp(null)
        .accounts({
          entity: entity.entityPda,
          ipAccount: ip.ipPda,
          currencyMint: mint,
        })
        .rpc();

      const ipCfg = deriveIpConfigPda(ip.ipPda, kollect.programId);
      const ipTrs = deriveIpTreasuryPda(ip.ipPda, kollect.programId);
      const ipTrsAta = getAssociatedTokenAddressSync(mint, ipTrs, true);

      const amtVenueId = 9106;
      const amtVenuePda = deriveVenuePda(amtVenueId, kollect.programId);

      await kollect.methods
        .registerVenue(new anchor.BN(amtVenueId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmAmtMismatchVenue"),
          multiplierBps: 10_000,
        })
        .rpc();

      const dayTs = dayTimestampDaysAgo(14);
      const cPda = derivePlaybackPda(amtVenuePda, dayTs, kollect.programId);

      await kollect.methods
        .submitPlayback(new anchor.BN(dayTs), randomHash(), new anchor.BN(100))
        .accountsPartial({ venue: amtVenuePda })
        .rpc();

      const sat = Math.floor(Date.now() / 1000);
      const sPda = deriveSettlementPda(
        amtVenuePda,
        dayTs,
        sat,
        kollect.programId,
      );

      try {
        // Correct amount would be 200_000 * 100 = 20_000_000, passing 25_000_000
        await kollect.methods
          .settlePeriod(new anchor.BN(dayTs), new anchor.BN(sat), [
            {
              ipAccount: ip.ipPda,
              amount: new anchor.BN(25_000_000),
              plays: new anchor.BN(100),
            },
          ])
          .accountsPartial({
            venueAuthority: authority.publicKey,
            venue: amtVenuePda,
            settlement: sPda,
            venueTokenAccount,
            platformTreasuryTokenAccount,
          })
          .remainingAccounts([
            { pubkey: cPda, isSigner: false, isWritable: true },
            { pubkey: ipCfg, isSigner: false, isWritable: false },
            { pubkey: ipTrs, isSigner: false, isWritable: true },
            { pubkey: ipTrsAta, isSigner: false, isWritable: true },
          ])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("DistributionAmountMismatch");
      }
    });
  });
});
