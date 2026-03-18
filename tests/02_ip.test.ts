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
import * as path from "path";
import { padBytes, hashFile } from "../utils/helper";

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

  // Test file paths for content hashing
  const testFile1 = path.join(
    __dirname,
    "../utils/file-examples/test-img-01.jpeg",
  );
  const testFile2 = path.join(
    __dirname,
    "../utils/file-examples/test-img-02.jpeg",
  );

  // Generate unique hash by combining file hash with random salt
  const uniqueHash = (): number[] => {
    const fileHash = hashFile(testFile1);
    const salt = Keypair.generate().publicKey.toBytes();
    // XOR file hash with salt for uniqueness while maintaining deterministic base
    return fileHash.map((byte, i) => byte ^ salt[i]);
  };

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
    const handle = padBytes("ip_owner", 32);
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
      await program.methods.createEntity(handle).rpc();
    }
  });

  describe("create_ip", () => {
    it("creates an IP with payment", async () => {
      const contentHash = uniqueHash();

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
          controller: creator.publicKey,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
        })
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
      // Use actual file hash to prove determinism
      const contentHash = hashFile(testFile2);

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

    it("fails when same entity creates IP with same content hash", async () => {
      // Create IP with a specific content hash
      const contentHash = uniqueHash();

      await program.methods
        .createIp(contentHash)
        .accounts({
          registrantEntity: entityPda,
          controller: creator.publicKey,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
        })
        .rpc();

      // Attempt to create another IP with the same content hash from same entity should fail
      try {
        await program.methods
          .createIp(contentHash)
          .accounts({
            registrantEntity: entityPda,
            controller: creator.publicKey,
            treasuryTokenAccount: treasuryTokenAccount,
            payerTokenAccount: payerTokenAccount,
          })
          .rpc();

        expect.fail(
          "Expected transaction to fail for duplicate content hash from same entity",
        );
      } catch (error: any) {
        // The account already exists, so initialization should fail
        expect(error.toString()).to.include("already in use");
      }
    });

    it("allows different entity to create IP with same content hash", async () => {
      // Create IP with entity A
      const contentHash = uniqueHash();

      await program.methods
        .createIp(contentHash)
        .accounts({
          registrantEntity: entityPda,
          controller: creator.publicKey,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
        })
        .rpc();

      // Create a different entity
      const differentHandle = padBytes("different_ip", 32);
      const [differentEntityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(differentHandle),
        ],
        program.programId,
      );

      try {
        await program.methods.createEntity(differentHandle).rpc();
      } catch {
        // Already exists
      }

      // Different entity can create IP with the same content hash
      const [ipPdaEntityA] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
        program.programId,
      );

      const [ipPdaEntityB] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("ip"),
          differentEntityPda.toBuffer(),
          Buffer.from(contentHash),
        ],
        program.programId,
      );

      // PDAs should be different for different entities with same content hash
      expect(ipPdaEntityA.toString()).to.not.equal(ipPdaEntityB.toString());

      // Create IP with different entity using same content hash - should succeed
      await program.methods
        .createIp(contentHash)
        .accounts({
          registrantEntity: differentEntityPda,
          controller: creator.publicKey,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
        })
        .rpc();

      // Verify both IPs exist with same content hash but different registrants
      const ipA = await program.account.ipAccount.fetch(ipPdaEntityA);
      const ipB = await program.account.ipAccount.fetch(ipPdaEntityB);

      expect(ipA.registrantEntity.toString()).to.equal(entityPda.toString());
      expect(ipB.registrantEntity.toString()).to.equal(
        differentEntityPda.toString(),
      );
    });
  });

  describe("transfer_ip", () => {
    let ipPda: PublicKey;
    let newOwnerEntityPda: PublicKey;

    before(async () => {
      // Create IP with unique hash
      const contentHash = uniqueHash();
      [ipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
        program.programId,
      );

      await program.methods
        .createIp(contentHash)
        .accounts({
          registrantEntity: entityPda,
          controller: creator.publicKey,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
        })
        .rpc();

      // Create new owner entity
      const newHandle = padBytes("new_owner", 32);
      [newOwnerEntityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(newHandle),
        ],
        program.programId,
      );

      try {
        await program.methods.createEntity(newHandle).rpc();
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
          controller: creator.publicKey,
        })
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
