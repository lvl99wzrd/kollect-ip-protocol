import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  getProvider,
  getPrograms,
  initializeIpCorePrerequisites,
  createTestEntity,
  deriveEntityTreasuryPda,
  derivePlatformConfigPda,
  signerMeta,
  padBytes,
} from "./setup";

describe("kollect entity treasury", () => {
  const provider = getProvider();
  const { kollect, ipCore } = getPrograms();
  const authority = provider.wallet as anchor.Wallet;

  let entityPda: PublicKey;
  let entityTreasuryPda: PublicKey;
  let configPda: PublicKey;
  let settlementMint: PublicKey;

  before(async () => {
    await initializeIpCorePrerequisites();
    configPda = derivePlatformConfigPda(kollect.programId);

    // Ensure platform is initialized (depends on 00_platform running first)
    const config = await kollect.account.platformConfig.fetch(configPda);
    settlementMint = config.currency;

    // Create a test entity
    const entity = await createTestEntity("entity_treasury_test");
    entityPda = entity.entityPda;
    entityTreasuryPda = deriveEntityTreasuryPda(entityPda, kollect.programId);
  });

  describe("initialize_entity_treasury", () => {
    it("creates an entity treasury", async () => {
      await kollect.methods
        .initializeEntityTreasury(authority.publicKey)
        .accounts({
          entity: entityPda,
          currencyMint: settlementMint,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const treasury = await kollect.account.entityTreasury.fetch(
        entityTreasuryPda,
      );
      expect(treasury.entity.toString()).to.equal(entityPda.toString());
      expect(treasury.authority.toString()).to.equal(
        authority.publicKey.toString(),
      );
      expect(treasury.totalEarned.toNumber()).to.equal(0);
      expect(treasury.totalWithdrawn.toNumber()).to.equal(0);
    });

    it("fails if already initialized (PDA collision)", async () => {
      try {
        await kollect.methods
          .initializeEntityTreasury(authority.publicKey)
          .accounts({
            entity: entityPda,
            currencyMint: settlementMint,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err).to.exist;
      }
    });

    it("fails with non-controller signer", async () => {
      // Create a new entity
      const testEntity = await createTestEntity("ctrl_treasury_test");
      const testTreasuryPda = deriveEntityTreasuryPda(
        testEntity.entityPda,
        kollect.programId,
      );

      const fakeController = Keypair.generate();

      try {
        // Pass a non-controller signer
        await kollect.methods
          .initializeEntityTreasury(authority.publicKey)
          .accounts({
            entity: testEntity.entityPda,
            currencyMint: settlementMint,
          })
          .remainingAccounts([signerMeta(fakeController.publicKey)])
          .signers([fakeController])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InsufficientSignatures");
      }
    });
  });

  describe("withdraw_entity_earnings", () => {
    let treasuryTokenAccount: PublicKey;
    let destinationTokenAccount: PublicKey;

    before(async () => {
      // Create a token account owned by the entity treasury PDA
      const treasuryAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        settlementMint,
        entityTreasuryPda,
        true,
      );
      treasuryTokenAccount = treasuryAta.address;

      // Fund the treasury token account
      await mintTo(
        provider.connection,
        authority.payer,
        settlementMint,
        treasuryTokenAccount,
        authority.publicKey,
        10_000_000,
      );

      // Create destination token account
      const destAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        settlementMint,
        authority.publicKey,
      );
      destinationTokenAccount = destAta.address;
    });

    it("fails to withdraw more than earned", async () => {
      // Entity treasury has tokens (via mintTo) but total_earned=0.
      // The bounds check prevents withdrawal beyond tracked earnings.
      try {
        await kollect.methods
          .withdrawEntityEarnings(new anchor.BN(500_000))
          .accountsPartial({
            entityTreasury: entityTreasuryPda,
            treasuryTokenAccount,
            destination: destinationTokenAccount,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InsufficientPayment");
      }
    });

    it("fails with wrong authority", async () => {
      const fakeAuthority = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fakeAuthority.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(sig);

      try {
        await kollect.methods
          .withdrawEntityEarnings(new anchor.BN(100))
          .accountsPartial({
            authority: fakeAuthority.publicKey,
            entityTreasury: entityTreasuryPda,
            treasuryTokenAccount,
            destination: destinationTokenAccount,
          })
          .signers([fakeAuthority])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAuthority");
      }
    });
  });
});
