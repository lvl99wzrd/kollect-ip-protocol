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

describe("ip_core ip", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IpCore as Program<IpCore>;
  const creator = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let configPda: PublicKey;
  let treasuryPda: PublicKey;
  let treasuryTokenAccount: PublicKey;
  let payerTokenAccount: PublicKey;
  let entityPda: PublicKey;

  // Helper to pad bytes
  const padHandle = (handle: string): number[] => {
    const bytes = Buffer.from(handle);
    const padded = Buffer.alloc(32);
    bytes.copy(padded);
    return Array.from(padded);
  };

  const randomHash = (): number[] =>
    Array.from(Keypair.generate().publicKey.toBytes());

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
    let configExists = false;
    try {
      const existingConfig = await program.account.protocolConfig.fetch(
        configPda,
      );
      mint = existingConfig.registrationCurrency;
      configExists = true;
    } catch {
      // Config doesn't exist, create a new mint
      mint = await createMint(
        provider.connection,
        creator.payer,
        creator.publicKey,
        null,
        6,
      );
    }

    // Initialize config (if not already done)
    if (!configExists) {
      await program.methods
        .initializeConfig(treasuryPda, mint, new anchor.BN(1_000_000))
        .rpc();
    }

    // Initialize treasury (if not already done)
    let treasuryExists = false;
    try {
      await program.account.protocolTreasury.fetch(treasuryPda);
      treasuryExists = true;
    } catch {
      // Treasury doesn't exist
    }

    if (!treasuryExists) {
      await program.methods.initializeTreasury().rpc();
    }

    // Create treasury token account
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      creator.payer,
      mint,
      treasuryPda,
      true,
    );
    treasuryTokenAccount = treasuryAta.address;

    // Create payer token account and mint tokens
    const payerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      creator.payer,
      mint,
      creator.publicKey,
    );
    payerTokenAccount = payerAta.address;

    // Only mint if balance is low
    const balance = await provider.connection.getTokenAccountBalance(
      payerTokenAccount,
    );
    if (balance.value.uiAmount === null || balance.value.uiAmount < 10) {
      await mintTo(
        provider.connection,
        creator.payer,
        mint,
        payerTokenAccount,
        creator.publicKey,
        100_000_000,
      );
    }

    // Create entity
    const handle = padHandle("ipowner");
    [entityPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("entity"),
        creator.publicKey.toBuffer(),
        Buffer.from(handle),
      ],
      program.programId,
    );

    let entityExists = false;
    try {
      await program.account.entity.fetch(entityPda);
      entityExists = true;
    } catch {
      // Entity doesn't exist
    }

    if (!entityExists) {
      await program.methods.createEntity(handle, [], 1).rpc();
    }
  });

  describe("create_ip", () => {
    it("creates an IP with payment", async () => {
      const contentHash = randomHash();

      const [ipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
        program.programId,
      );

      const balanceBefore = (
        await provider.connection.getTokenAccountBalance(treasuryTokenAccount)
      ).value.uiAmount;

      await program.methods
        .createIp(contentHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      const ip = await program.account.ipAccount.fetch(ipPda);
      expect(ip.registrantEntity.toString()).to.equal(entityPda.toString());
      expect(ip.currentOwnerEntity.toString()).to.equal(entityPda.toString());
      expect(ip.currentMetadataRevision.toNumber()).to.equal(0);

      const balanceAfter = (
        await provider.connection.getTokenAccountBalance(treasuryTokenAccount)
      ).value.uiAmount;

      // Check that fee was deducted (balance increased by 1 token)
      expect(balanceAfter! > balanceBefore!).to.be.true;
    });

    it("derives deterministic PDA from entity and hash", async () => {
      const contentHash = randomHash();

      const [ipPda1] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
        program.programId,
      );

      const [ipPda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
        program.programId,
      );

      expect(ipPda1.toString()).to.equal(ipPda2.toString());
    });
  });

  describe("transfer_ip", () => {
    let ipPda: PublicKey;
    let newOwnerEntityPda: PublicKey;

    before(async () => {
      // Create IP
      const contentHash = randomHash();
      [ipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
        program.programId,
      );

      await program.methods
        .createIp(contentHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      // Create new owner entity
      const newHandle = padHandle("newowner");
      [newOwnerEntityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(newHandle),
        ],
        program.programId,
      );

      try {
        await program.methods.createEntity(newHandle, [], 1).rpc();
      } catch {
        // Already exists
      }
    });

    it("transfers IP ownership", async () => {
      const ipBefore = await program.account.ipAccount.fetch(ipPda);
      expect(ipBefore.currentOwnerEntity.toString()).to.equal(
        entityPda.toString(),
      );

      await program.methods
        .transferIp()
        .accounts({
          ip: ipPda,
          currentOwnerEntity: entityPda,
          newOwnerEntity: newOwnerEntityPda,
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      const ipAfter = await program.account.ipAccount.fetch(ipPda);
      expect(ipAfter.currentOwnerEntity.toString()).to.equal(
        newOwnerEntityPda.toString(),
      );
      // Immutable fields unchanged
      expect(ipAfter.registrantEntity.toString()).to.equal(
        ipBefore.registrantEntity.toString(),
      );
      expect(ipAfter.createdAt.toString()).to.equal(
        ipBefore.createdAt.toString(),
      );
    });
  });
});
