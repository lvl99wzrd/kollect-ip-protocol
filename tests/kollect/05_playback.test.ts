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
  derivePlatformConfigPda,
  deriveVenuePda,
  derivePlaybackPda,
  deriveSettlementPda,
  randomHash,
  signerMeta,
  venueIdBuffer,
} from "./setup";

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
          name: Array.from(
            Buffer.from("Playback Venue".padEnd(64, "\0")),
          ) as number[],
          venueType: 0,
          capacity: 500,
          operatingHours: 18,
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
            name: Array.from(
              Buffer.from("DeactVenue".padEnd(64, "\0")),
            ) as number[],
            venueType: 1,
            capacity: 100,
            operatingHours: 12,
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
            name: Array.from(
              Buffer.from("SettleVenue".padEnd(64, "\0")),
            ) as number[],
            venueType: 2,
            capacity: 300,
            operatingHours: 20,
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
          .accounts({ entity: entity.entityPda })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
      }

      const ip = await createTestIp(entity.entityPda);
      const ipConfigPda = deriveIpConfigPda(ip.ipPda, kollect.programId);
      try {
        await kollect.account.ipConfig.fetch(ipConfigPda);
      } catch {
        await kollect.methods
          .onboardIp(null, false)
          .accounts({ entity: entity.entityPda, ipAccount: ip.ipPda })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
      }

      const settlementPda = deriveSettlementPda(
        settlementVenuePda,
        periodStart,
        kollect.programId,
      );

      const distributions = [
        {
          ipAccount: ip.ipPda,
          amount: new anchor.BN(5000),
          plays: new anchor.BN(700),
        },
      ];

      // Pass commitment accounts as remainingAccounts
      const remainingAccounts = commitmentPdas.map((pda) => ({
        pubkey: pda,
        isSigner: false,
        isWritable: true,
      }));

      await kollect.methods
        .settlePeriod(new anchor.BN(periodStart), distributions)
        .accountsPartial({
          venue: settlementVenuePda,
          settlement: settlementPda,
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
      expect(record.totalPlays.toNumber()).to.be.greaterThan(0);
      expect(record.commitmentCount).to.equal(7);
      expect(record.ipCount).to.equal(1);
      expect(record.settledAt.toNumber()).to.be.greaterThan(0);

      // Verify commitments are marked as settled
      for (const pda of commitmentPdas) {
        const commitment = await kollect.account.playbackCommitment.fetch(pda);
        expect(commitment.settled).to.be.true;
      }
    });

    it("fails with period not yet ended", async () => {
      // Use a period_start of today (period_end = 7 days from now)
      const futurePeriodStart = dayTimestampDaysAgo(0);
      const futureSettlementPda = deriveSettlementPda(
        settlementVenuePda,
        futurePeriodStart,
        kollect.programId,
      );

      try {
        await kollect.methods
          .settlePeriod(new anchor.BN(futurePeriodStart), [])
          .accountsPartial({
            venue: settlementVenuePda,
            settlement: futureSettlementPda,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("SettlementPeriodNotEnded");
      }
    });

    it("fails with duplicate settlement period (PDA collision)", async () => {
      const settlementPda = deriveSettlementPda(
        settlementVenuePda,
        periodStart,
        kollect.programId,
      );

      try {
        await kollect.methods
          .settlePeriod(new anchor.BN(periodStart), [])
          .accountsPartial({
            venue: settlementVenuePda,
            settlement: settlementPda,
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
      const emptySettlementPda = deriveSettlementPda(
        settlementVenuePda,
        emptyPeriodStart,
        kollect.programId,
      );

      try {
        await kollect.methods
          .settlePeriod(new anchor.BN(emptyPeriodStart), [])
          .accountsPartial({
            venue: settlementVenuePda,
            settlement: emptySettlementPda,
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
      const otherSettlementPda = deriveSettlementPda(
        settlementVenuePda,
        otherPeriodStart,
        kollect.programId,
      );

      try {
        await kollect.methods
          .settlePeriod(new anchor.BN(otherPeriodStart), [])
          .accountsPartial({
            authority: fakeAuth.publicKey,
            venue: settlementVenuePda,
            settlement: otherSettlementPda,
          })
          .signers([fakeAuth])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAuthority");
      }
    });
  });
});
