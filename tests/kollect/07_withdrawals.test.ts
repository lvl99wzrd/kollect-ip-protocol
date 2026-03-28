import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
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
  signerMeta,
  venueCid,
} from "./setup";

const SECONDS_PER_DAY = 86400;

function dayTimestampDaysAgo(days: number): number {
  const now = Math.floor(Date.now() / 1000);
  const dayAligned = now - (now % SECONDS_PER_DAY);
  return dayAligned - days * SECONDS_PER_DAY;
}

describe("kollect withdrawals", () => {
  const provider = getProvider();
  const { kollect } = getPrograms();
  const authority = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let entityPda: PublicKey;
  let entityTreasuryPda: PublicKey;
  let ipPda: PublicKey;
  let ipConfigPda: PublicKey;
  let ipTreasuryPda: PublicKey;
  let ipTreasuryAta: PublicKey;
  let entityTreasuryAta: PublicKey;
  let destinationAta: PublicKey;

  // IpTreasury earns this amount from settlement
  // 200_000 base × 10_000/10_000 multiplier × 700 plays
  const DISTRIBUTION_AMOUNT = 140_000_000;

  before(async () => {
    const state = await initializeIpCorePrerequisites();
    mint = state.mint;

    const configPda = derivePlatformConfigPda(kollect.programId);
    await kollect.account.platformConfig.fetch(configPda);

    // Create entity + treasury
    const entity = await createTestEntity("withdrawal_entity");
    entityPda = entity.entityPda;
    entityTreasuryPda = deriveEntityTreasuryPda(entityPda, kollect.programId);

    await kollect.methods
      .initializeEntityTreasury(authority.publicKey)
      .accounts({ entity: entityPda, currencyMint: mint })
      .remainingAccounts([signerMeta(authority.publicKey)])
      .rpc();

    // Create + onboard IP
    const ip = await createTestIp(entityPda);
    ipPda = ip.ipPda;
    ipConfigPda = deriveIpConfigPda(ipPda, kollect.programId);
    ipTreasuryPda = deriveIpTreasuryPda(ipPda, kollect.programId);

    await kollect.methods
      .onboardIp(null)
      .accounts({ entity: entityPda, ipAccount: ipPda, currencyMint: mint })
      .rpc();

    ipTreasuryAta = getAssociatedTokenAddressSync(mint, ipTreasuryPda, true);
    entityTreasuryAta = getAssociatedTokenAddressSync(
      mint,
      entityTreasuryPda,
      true,
    );

    const destAcct = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      mint,
      authority.publicKey,
    );
    destinationAta = destAcct.address;

    // Register venue
    const venueId = 9300;
    const venuePda = deriveVenuePda(venueId, kollect.programId);

    await kollect.methods
      .registerVenue(new anchor.BN(venueId), {
        venueAuthority: authority.publicKey,
        cid: venueCid("QmWithdrawalVenue"),
        multiplierBps: 10_000,
      })
      .rpc();

    // Submit 7 days of playback (100 plays/day = 700 total)
    const periodStart = dayTimestampDaysAgo(14);
    const commitmentPdas: PublicKey[] = [];

    for (let i = 0; i < 7; i++) {
      const dayTs = periodStart + i * SECONDS_PER_DAY;
      commitmentPdas.push(
        derivePlaybackPda(venuePda, dayTs, kollect.programId),
      );

      await kollect.methods
        .submitPlayback(new anchor.BN(dayTs), randomHash(), new anchor.BN(100))
        .accountsPartial({ venue: venuePda })
        .rpc();
    }

    // Fund venue token account (authority is also venue authority)
    await mintTo(
      provider.connection,
      authority.payer,
      mint,
      destAcct.address,
      authority.publicKey,
      1_000_000_000,
    );

    // Platform treasury ATA
    const platformTreasuryPda = derivePlatformTreasuryPda(kollect.programId);
    const platformAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      mint,
      platformTreasuryPda,
      true,
    );

    // Settle period
    const settledAt = Math.floor(Date.now() / 1000);
    const settlementPda = deriveSettlementPda(
      venuePda,
      periodStart,
      settledAt,
      kollect.programId,
    );

    await kollect.methods
      .settlePeriod(new anchor.BN(periodStart), new anchor.BN(settledAt), [
        {
          ipAccount: ipPda,
          amount: new anchor.BN(DISTRIBUTION_AMOUNT),
          plays: new anchor.BN(700),
        },
      ])
      .accountsPartial({
        venueAuthority: authority.publicKey,
        venue: venuePda,
        settlement: settlementPda,
        venueTokenAccount: destAcct.address,
        platformTreasuryTokenAccount: platformAta.address,
      })
      .remainingAccounts([
        ...commitmentPdas.map((pda) => ({
          pubkey: pda,
          isSigner: false,
          isWritable: true,
        })),
        { pubkey: ipConfigPda, isSigner: false, isWritable: false },
        { pubkey: ipTreasuryPda, isSigner: false, isWritable: true },
        { pubkey: ipTreasuryAta, isSigner: false, isWritable: true },
      ])
      .rpc();

    // Verify IpTreasury earned the expected amount
    const ipTreasury = await kollect.account.ipTreasury.fetch(ipTreasuryPda);
    expect(ipTreasury.totalEarned.toNumber()).to.equal(DISTRIBUTION_AMOUNT);
  });

  // ─── Withdraw IP Treasury ─────────────────────────────────────────────────

  describe("withdraw_ip_treasury", () => {
    const WITHDRAW_AMOUNT = 50_000_000;

    it("withdraws from IP treasury to entity treasury", async () => {
      await kollect.methods
        .withdrawIpTreasury(new anchor.BN(WITHDRAW_AMOUNT))
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          ipTreasury: ipTreasuryPda,
          entityTreasury: entityTreasuryPda,
          ipTreasuryTokenAccount: ipTreasuryAta,
          entityTreasuryTokenAccount: entityTreasuryAta,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const ipTreasury = await kollect.account.ipTreasury.fetch(ipTreasuryPda);
      expect(ipTreasury.totalSettled.toNumber()).to.equal(WITHDRAW_AMOUNT);

      const entityTreasury = await kollect.account.entityTreasury.fetch(
        entityTreasuryPda,
      );
      expect(entityTreasury.totalEarned.toNumber()).to.equal(WITHDRAW_AMOUNT);

      // Verify token balances
      const ipBalance = await provider.connection.getTokenAccountBalance(
        ipTreasuryAta,
      );
      expect(Number(ipBalance.value.amount)).to.equal(
        DISTRIBUTION_AMOUNT - WITHDRAW_AMOUNT,
      );

      const entityBalance = await provider.connection.getTokenAccountBalance(
        entityTreasuryAta,
      );
      expect(Number(entityBalance.value.amount)).to.equal(WITHDRAW_AMOUNT);
    });

    it("fails when amount exceeds available balance", async () => {
      // Available = DISTRIBUTION_AMOUNT - WITHDRAW_AMOUNT = 90_000_000
      const overAmount = DISTRIBUTION_AMOUNT - 50_000_000 + 1;

      try {
        await kollect.methods
          .withdrawIpTreasury(new anchor.BN(overAmount))
          .accountsPartial({
            entity: entityPda,
            ipConfig: ipConfigPda,
            ipTreasury: ipTreasuryPda,
            entityTreasury: entityTreasuryPda,
            ipTreasuryTokenAccount: ipTreasuryAta,
            entityTreasuryTokenAccount: entityTreasuryAta,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InsufficientPayment");
      }
    });
  });

  // ─── Withdraw Entity Earnings ──────────────────────────────────────────────

  describe("withdraw_entity_earnings", () => {
    it("withdraws entity earnings within available balance", async () => {
      // EntityTreasury.total_earned = 50_000_000 (from withdraw_ip_treasury)
      // EntityTreasury.total_withdrawn = 0
      const withdrawAmount = 10_000_000;

      const balanceBefore = await provider.connection.getTokenAccountBalance(
        destinationAta,
      );

      await kollect.methods
        .withdrawEntityEarnings(new anchor.BN(withdrawAmount))
        .accountsPartial({
          entityTreasury: entityTreasuryPda,
          treasuryTokenAccount: entityTreasuryAta,
          destination: destinationAta,
        })
        .rpc();

      const balanceAfter = await provider.connection.getTokenAccountBalance(
        destinationAta,
      );
      expect(
        Number(balanceAfter.value.amount) - Number(balanceBefore.value.amount),
      ).to.equal(withdrawAmount);

      const treasury = await kollect.account.entityTreasury.fetch(
        entityTreasuryPda,
      );
      expect(treasury.totalWithdrawn.toNumber()).to.equal(withdrawAmount);
    });

    it("fails when amount exceeds available balance", async () => {
      // EntityTreasury.total_earned = 50_000_000
      // EntityTreasury.total_withdrawn = 10_000_000 (from previous test)
      // Available = 40_000_000
      const overAmount = 40_000_001;

      try {
        await kollect.methods
          .withdrawEntityEarnings(new anchor.BN(overAmount))
          .accountsPartial({
            entityTreasury: entityTreasuryPda,
            treasuryTokenAccount: entityTreasuryAta,
            destination: destinationAta,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InsufficientPayment");
      }
    });
  });
});
