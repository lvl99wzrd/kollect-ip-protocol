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
  derivePlatformConfigPda,
  derivePlatformTreasuryPda,
} from "./setup";

describe("kollect platform", () => {
  const provider = getProvider();
  const { kollect } = getPrograms();
  const authority = provider.wallet as anchor.Wallet;

  let configPda: PublicKey;
  let treasuryPda: PublicKey;
  let settlementMint: PublicKey;

  before(async () => {
    configPda = derivePlatformConfigPda(kollect.programId);
    treasuryPda = derivePlatformTreasuryPda(kollect.programId);

    // Create a mint for settlement currency
    settlementMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      6,
    );
  });

  describe("initialize_platform", () => {
    it("initializes platform config and treasury", async () => {
      // Check if already initialized
      let exists = false;
      try {
        await kollect.account.platformConfig.fetch(configPda);
        exists = true;
      } catch {}

      if (exists) {
        const config = await kollect.account.platformConfig.fetch(configPda);
        expect(config.authority.toString()).to.equal(
          authority.publicKey.toString(),
        );
        settlementMint = config.currency;
        return;
      }

      const basePricePerPlay = new anchor.BN(100_000);
      const platformFeeBps = 500; // 5%
      const maxDerivativesDepth = 3;
      const maxLicenseTypes = 10;

      await kollect.methods
        .initializePlatform(
          basePricePerPlay,
          platformFeeBps,
          settlementMint,
          maxDerivativesDepth,
          maxLicenseTypes,
        )
        .accounts({
          currencyMint: settlementMint,
        })
        .rpc();

      const config = await kollect.account.platformConfig.fetch(configPda);
      expect(config.authority.toString()).to.equal(
        authority.publicKey.toString(),
      );
      expect(config.platformFeeBps).to.equal(platformFeeBps);
      expect(config.basePricePerPlay.toNumber()).to.equal(100_000);
      expect(config.currency.toString()).to.equal(settlementMint.toString());
      expect(config.maxDerivativesDepth).to.equal(maxDerivativesDepth);
      expect(config.maxLicenseTypes).to.equal(maxLicenseTypes);
      expect(config.treasury.toString()).to.equal(treasuryPda.toString());

      const treasury = await kollect.account.platformTreasury.fetch(
        treasuryPda,
      );
      expect(treasury.authority.toString()).to.equal(
        authority.publicKey.toString(),
      );
      expect(treasury.config.toString()).to.equal(configPda.toString());
    });

    it("fails if already initialized (PDA collision)", async () => {
      try {
        await kollect.methods
          .initializePlatform(
            new anchor.BN(100_000),
            500,
            settlementMint,
            3,
            10,
          )
          .accounts({
            currencyMint: settlementMint,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err).to.exist;
      }
    });
  });

  describe("update_platform_config", () => {
    it("updates base_price_per_play", async () => {
      const config = await kollect.account.platformConfig.fetch(configPda);
      settlementMint = config.currency;

      await kollect.methods
        .updatePlatformConfig({
          newAuthority: null,
          newBasePricePerPlay: new anchor.BN(200_000),
          newPlatformFeeBps: null,
          newMaxDerivativesDepth: null,
          newMaxLicenseTypes: null,
        })
        .rpc();

      const updated = await kollect.account.platformConfig.fetch(configPda);
      expect(updated.basePricePerPlay.toNumber()).to.equal(200_000);
      // Other fields unchanged
      expect(updated.platformFeeBps).to.equal(config.platformFeeBps);
      expect(updated.currency.toString()).to.equal(config.currency.toString());
    });

    it("updates platform_fee_bps", async () => {
      await kollect.methods
        .updatePlatformConfig({
          newAuthority: null,
          newBasePricePerPlay: null,
          newPlatformFeeBps: 1000, // 10%
          newMaxDerivativesDepth: null,
          newMaxLicenseTypes: null,
        })
        .rpc();

      const updated = await kollect.account.platformConfig.fetch(configPda);
      expect(updated.platformFeeBps).to.equal(1000);
    });

    it("updates max_derivatives_depth", async () => {
      await kollect.methods
        .updatePlatformConfig({
          newAuthority: null,
          newBasePricePerPlay: null,
          newPlatformFeeBps: null,
          newMaxDerivativesDepth: 2,
          newMaxLicenseTypes: null,
        })
        .rpc();

      const updated = await kollect.account.platformConfig.fetch(configPda);
      expect(updated.maxDerivativesDepth).to.equal(2);
    });

    it("fails with wrong authority", async () => {
      const fakeAuthority = Keypair.generate();

      // Airdrop to fake authority for tx fees
      const sig = await provider.connection.requestAirdrop(
        fakeAuthority.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(sig);

      try {
        await kollect.methods
          .updatePlatformConfig({
            newAuthority: null,
            newBasePricePerPlay: new anchor.BN(999),
            newPlatformFeeBps: null,
            newMaxDerivativesDepth: null,
            newMaxLicenseTypes: null,
          })
          .accounts({ authority: fakeAuthority.publicKey })
          .signers([fakeAuthority])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAuthority");
      }
    });
  });

  describe("withdraw_platform_fees", () => {
    let treasuryTokenAccount: PublicKey;
    let destinationTokenAccount: PublicKey;

    before(async () => {
      const config = await kollect.account.platformConfig.fetch(configPda);
      settlementMint = config.currency;

      // Create treasury token account (owned by PlatformTreasury PDA)
      const treasuryAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        settlementMint,
        treasuryPda,
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

    it("withdraws platform fees to destination", async () => {
      const beforeDest = await getAccount(
        provider.connection,
        destinationTokenAccount,
      );
      const beforeTreasury = await getAccount(
        provider.connection,
        treasuryTokenAccount,
      );

      const withdrawAmount = new anchor.BN(1_000_000);

      await kollect.methods
        .withdrawPlatformFees(withdrawAmount)
        .accounts({
          treasuryTokenAccount,
          destination: destinationTokenAccount,
        })
        .rpc();

      const afterDest = await getAccount(
        provider.connection,
        destinationTokenAccount,
      );
      const afterTreasury = await getAccount(
        provider.connection,
        treasuryTokenAccount,
      );

      expect(Number(afterDest.amount - beforeDest.amount)).to.equal(1_000_000);
      expect(Number(beforeTreasury.amount - afterTreasury.amount)).to.equal(
        1_000_000,
      );
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
          .withdrawPlatformFees(new anchor.BN(100))
          .accounts({
            authority: fakeAuthority.publicKey,
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
