import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../target/types/ip_core";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

describe("ip_core protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IpCore as Program<IpCore>;
  const authority = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let configPda: PublicKey;
  let treasuryPda: PublicKey;
  let treasuryTokenAccount: PublicKey;

  before(async () => {
    // Derive PDAs
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId,
    );

    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId,
    );

    // Check if config already exists and get the mint from it
    try {
      const existingConfig = await program.account.protocolConfig.fetch(
        configPda,
      );
      mint = existingConfig.registrationCurrency;
    } catch {
      // Config doesn't exist, create a new mint
      mint = await createMint(
        provider.connection,
        authority.payer,
        authority.publicKey,
        null,
        6, // 6 decimals
      );
    }
  });

  describe("initialize_config", () => {
    it("initializes the protocol config", async function () {
      // Check if already initialized by other tests
      let configExists = false;
      try {
        await program.account.protocolConfig.fetch(configPda);
        configExists = true;
      } catch {
        // Config doesn't exist
      }

      if (configExists) {
        // Verify existing config is valid
        const config = await program.account.protocolConfig.fetch(configPda);
        expect(config.authority.toString()).to.equal(
          authority.publicKey.toString(),
        );
        expect(config.treasury.toString()).to.equal(treasuryPda.toString());
        // Use the existing mint for subsequent tests
        mint = config.registrationCurrency;
        return;
      }

      const registrationFee = new anchor.BN(1_000_000); // 1 token

      await program.methods
        .initializeConfig(treasuryPda, mint, registrationFee)
        .rpc();

      const config = await program.account.protocolConfig.fetch(configPda);
      expect(config.authority.toString()).to.equal(
        authority.publicKey.toString(),
      );
      expect(config.treasury.toString()).to.equal(treasuryPda.toString());
      expect(config.registrationCurrency.toString()).to.equal(mint.toString());
      expect(config.registrationFee.toNumber()).to.equal(1_000_000);
    });

    it("fails if config already initialized", async () => {
      try {
        await program.methods
          .initializeConfig(treasuryPda, mint, new anchor.BN(1_000_000))
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        // Expected: account already initialized
        expect(err).to.exist;
      }
    });
  });

  describe("update_config", () => {
    it("updates the registration fee", async () => {
      const newFee = new anchor.BN(2_000_000);

      await program.methods
        .updateConfig({
          newAuthority: null,
          newTreasury: null,
          newRegistrationCurrency: null,
          newRegistrationFee: newFee,
        })
        .rpc();

      const config = await program.account.protocolConfig.fetch(configPda);
      expect(config.registrationFee.toNumber()).to.equal(2_000_000);
    });

    it("fails with invalid authority", async () => {
      const fakeAuthority = Keypair.generate();

      try {
        await program.methods
          .updateConfig({
            newAuthority: null,
            newTreasury: null,
            newRegistrationCurrency: null,
            newRegistrationFee: new anchor.BN(3_000_000),
          })
          .accounts({
            authority: fakeAuthority.publicKey,
          })
          .signers([fakeAuthority])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAuthority");
      }
    });
  });

  describe("initialize_treasury", () => {
    it("initializes the protocol treasury", async function () {
      // Check if already initialized by other tests
      let treasuryExists = false;
      try {
        await program.account.protocolTreasury.fetch(treasuryPda);
        treasuryExists = true;
      } catch {
        // Treasury doesn't exist
      }

      if (treasuryExists) {
        // Verify existing treasury is valid
        const treasury = await program.account.protocolTreasury.fetch(
          treasuryPda,
        );
        expect(treasury.authority.toString()).to.equal(
          authority.publicKey.toString(),
        );
        expect(treasury.config.toString()).to.equal(configPda.toString());
        return;
      }

      await program.methods.initializeTreasury().rpc();

      const treasury = await program.account.protocolTreasury.fetch(
        treasuryPda,
      );
      expect(treasury.authority.toString()).to.equal(
        authority.publicKey.toString(),
      );
      expect(treasury.config.toString()).to.equal(configPda.toString());
    });
  });

  describe("withdraw_treasury", () => {
    before(async () => {
      // Create treasury token account with treasury PDA as owner
      const treasuryAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        treasuryPda,
        true, // allowOwnerOffCurve for PDA
      );
      treasuryTokenAccount = treasuryAta.address;

      // Mint some tokens to the treasury
      await mintTo(
        provider.connection,
        authority.payer,
        mint,
        treasuryTokenAccount,
        authority.publicKey,
        10_000_000,
      );
    });

    it("withdraws tokens from treasury", async () => {
      const destinationAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        authority.publicKey,
      );

      const balanceBefore = (
        await provider.connection.getTokenAccountBalance(destinationAta.address)
      ).value.uiAmount;

      await program.methods
        .withdrawTreasury(new anchor.BN(1_000_000))
        .accounts({
          treasuryTokenAccount: treasuryTokenAccount,
          destinationTokenAccount: destinationAta.address,
        })
        .rpc();

      const balanceAfter = (
        await provider.connection.getTokenAccountBalance(destinationAta.address)
      ).value.uiAmount;

      expect(balanceAfter! - balanceBefore!).to.equal(1);
    });
  });
});
