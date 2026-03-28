import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../target/types/ip_core";
import { License } from "../target/types/license";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { padBytes, deriveEntityPda, getEntityCount } from "../utils/helper";

describe("ip_core derivative with license", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const ipCoreProgram = anchor.workspace.IpCore as Program<IpCore>;
  const licenseProgram = anchor.workspace.License as Program<License>;
  const creator = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let configPda: PublicKey;
  let treasuryPda: PublicKey;
  let treasuryTokenAccount: PublicKey;
  let payerTokenAccount: PublicKey;
  let entityPda: PublicKey;
  let parentIpPda: PublicKey;
  let childIpPda: PublicKey;
  let licensePda: PublicKey;
  let licenseGrantPda: PublicKey;

  const randomHash = (): number[] =>
    Array.from(Keypair.generate().publicKey.toBytes());

  before(async () => {
    // Derive PDAs
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      ipCoreProgram.programId,
    );

    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      ipCoreProgram.programId,
    );

    // Check if config already exists and get the mint from it
    let configExists = false;
    try {
      const existingConfig = await ipCoreProgram.account.protocolConfig.fetch(
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
      await ipCoreProgram.methods
        .initializeConfig(treasuryPda, mint, new anchor.BN(1_000_000))
        .rpc();
    }

    // Initialize treasury (if not already done)
    try {
      await ipCoreProgram.methods.initializeTreasury().rpc();
    } catch {
      // Already initialized
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
    const entityIndex = await getEntityCount(ipCoreProgram, creator.publicKey);
    [entityPda] = deriveEntityPda(
      ipCoreProgram.programId,
      creator.publicKey,
      entityIndex,
    );

    try {
      await ipCoreProgram.methods
        .createEntity()
        .accountsPartial({ entity: entityPda })
        .rpc();
    } catch {
      // Already created
    }

    // Create parent IP
    const parentHash = randomHash();
    [parentIpPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(parentHash)],
      ipCoreProgram.programId,
    );

    await ipCoreProgram.methods
      .createIp(parentHash)
      .accounts({
        registrantEntity: entityPda,
        treasuryTokenAccount: treasuryTokenAccount,
        payerTokenAccount: payerTokenAccount,
        controller: creator.publicKey,
      })
      .rpc();

    // Create child IP
    const childHash = randomHash();
    [childIpPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(childHash)],
      ipCoreProgram.programId,
    );

    await ipCoreProgram.methods
      .createIp(childHash)
      .accounts({
        registrantEntity: entityPda,
        treasuryTokenAccount: treasuryTokenAccount,
        payerTokenAccount: payerTokenAccount,
        controller: creator.publicKey,
      })
      .rpc();

    // Create license for parent IP
    [licensePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("license"), parentIpPda.toBuffer()],
      licenseProgram.programId,
    );

    await licenseProgram.methods
      .createLicense(true, ipCoreProgram.programId)
      .accounts({
        originIp: parentIpPda,
        ownerEntity: entityPda,
        derivativeCheck: null,
        controller: creator.publicKey,
      })
      .rpc();

    // Create license grant for the entity (so it can create derivatives)
    [licenseGrantPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("license_grant"),
        licensePda.toBuffer(),
        entityPda.toBuffer(),
      ],
      licenseProgram.programId,
    );

    await licenseProgram.methods
      .createLicenseGrant(new anchor.BN(0), ipCoreProgram.programId)
      .accountsPartial({
        license: licensePda,
        authorityEntity: entityPda,
        granteeEntity: entityPda, // Self-grant for testing
        controller: creator.publicKey,
      })
      .rpc();
  });

  describe("create_derivative_link with license program", () => {
    it("derives deterministic PDA from parent and child", () => {
      const [derivativePda1] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("derivative"),
          parentIpPda.toBuffer(),
          childIpPda.toBuffer(),
        ],
        ipCoreProgram.programId,
      );

      const [derivativePda2] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("derivative"),
          parentIpPda.toBuffer(),
          childIpPda.toBuffer(),
        ],
        ipCoreProgram.programId,
      );

      expect(derivativePda1.toString()).to.equal(derivativePda2.toString());
    });

    it("enforces different PDAs for different parent/child pairs", () => {
      const [derivativePda1] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("derivative"),
          parentIpPda.toBuffer(),
          childIpPda.toBuffer(),
        ],
        ipCoreProgram.programId,
      );

      const [derivativePda2] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("derivative"),
          childIpPda.toBuffer(), // Swapped
          parentIpPda.toBuffer(),
        ],
        ipCoreProgram.programId,
      );

      expect(derivativePda1.toString()).to.not.equal(derivativePda2.toString());
    });

    it("creates a derivative link with valid license grant", async () => {
      const [derivativePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("derivative"),
          parentIpPda.toBuffer(),
          childIpPda.toBuffer(),
        ],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createDerivativeLink()
        .accounts({
          parentIp: parentIpPda,
          childIp: childIpPda,
          childOwnerEntity: entityPda,
          licenseGrant: licenseGrantPda,
          license: licensePda,
          licenseProgram: licenseProgram.programId,
          controller: creator.publicKey,
        })
        .rpc();

      const derivativeLink = await ipCoreProgram.account.derivativeLink.fetch(
        derivativePda,
      );
      expect(derivativeLink.parentIp.toString()).to.equal(
        parentIpPda.toString(),
      );
      expect(derivativeLink.childIp.toString()).to.equal(childIpPda.toString());
      expect(derivativeLink.license.toString()).to.equal(
        licenseGrantPda.toString(),
      );
    });

    it("fails when derivative link already exists", async () => {
      const [derivativePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("derivative"),
          parentIpPda.toBuffer(),
          childIpPda.toBuffer(),
        ],
        ipCoreProgram.programId,
      );

      try {
        await ipCoreProgram.methods
          .createDerivativeLink()
          .accounts({
            parentIp: parentIpPda,
            childIp: childIpPda,
            childOwnerEntity: entityPda,
            licenseGrant: licenseGrantPda,
            license: licensePda,
            licenseProgram: licenseProgram.programId,
            controller: creator.publicKey,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        // Account already exists
        expect(err.toString()).to.include("Error");
      }
    });

    it("fails without controller signature", async () => {
      // Create new IPs for this test
      const newParentHash = randomHash();
      const [newParentIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(newParentHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(newParentHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
          controller: creator.publicKey,
        })
        .rpc();

      const newChildHash = randomHash();
      const [newChildIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(newChildHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(newChildHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
          controller: creator.publicKey,
        })
        .rpc();

      // Create license for new parent
      const [newLicensePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("license"), newParentIpPda.toBuffer()],
        licenseProgram.programId,
      );

      await licenseProgram.methods
        .createLicense(true, ipCoreProgram.programId)
        .accounts({
          originIp: newParentIpPda,
          ownerEntity: entityPda,
          derivativeCheck: null,
          controller: creator.publicKey,
        })
        .rpc();

      // Create grant
      const [newGrantPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("license_grant"),
          newLicensePda.toBuffer(),
          entityPda.toBuffer(),
        ],
        licenseProgram.programId,
      );

      await licenseProgram.methods
        .createLicenseGrant(new anchor.BN(0), ipCoreProgram.programId)
        .accountsPartial({
          license: newLicensePda,
          authorityEntity: entityPda,
          granteeEntity: entityPda,
          controller: creator.publicKey,
        })
        .rpc();

      const [newDerivativePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("derivative"),
          newParentIpPda.toBuffer(),
          newChildIpPda.toBuffer(),
        ],
        ipCoreProgram.programId,
      );

      // Single-controller test: fails without controller signature
      const fakeController = Keypair.generate();
      try {
        await ipCoreProgram.methods
          .createDerivativeLink()
          .accounts({
            parentIp: newParentIpPda,
            childIp: newChildIpPda,
            childOwnerEntity: entityPda,
            licenseGrant: newGrantPda,
            license: newLicensePda,
            licenseProgram: licenseProgram.programId,
            controller: fakeController.publicKey,
          })
          .signers([fakeController])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });

    it("fails with invalid license program", async () => {
      // Create new IPs for this test
      const newParentHash = randomHash();
      const [newParentIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(newParentHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(newParentHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
          controller: creator.publicKey,
        })
        .rpc();

      const newChildHash = randomHash();
      const [newChildIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(newChildHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(newChildHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
          controller: creator.publicKey,
        })
        .rpc();

      // Use system program as an invalid license program — it cannot handle the CPI
      try {
        await ipCoreProgram.methods
          .createDerivativeLink()
          .accounts({
            parentIp: newParentIpPda,
            childIp: newChildIpPda,
            childOwnerEntity: entityPda,
            licenseGrant: licenseGrantPda,
            license: licensePda,
            licenseProgram: anchor.web3.SystemProgram.programId,
            controller: creator.publicKey,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        // CPI to wrong program fails
        expect(err.toString()).to.include("Error");
      }
    });

    it("fails when derivatives not allowed", async () => {
      // Create new IPs for this test
      const newParentHash = randomHash();
      const [noDerivParentIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(newParentHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(newParentHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
          controller: creator.publicKey,
        })
        .rpc();

      const newChildHash = randomHash();
      const [noDerivChildIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(newChildHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(newChildHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
          controller: creator.publicKey,
        })
        .rpc();

      // Create license with derivatives_allowed = false
      const [noDerivLicensePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("license"), noDerivParentIpPda.toBuffer()],
        licenseProgram.programId,
      );

      await licenseProgram.methods
        .createLicense(false, ipCoreProgram.programId) // derivatives NOT allowed
        .accounts({
          originIp: noDerivParentIpPda,
          ownerEntity: entityPda,
          derivativeCheck: null,
          controller: creator.publicKey,
        })
        .rpc();

      // Create grant (even with grant, derivatives not allowed by license terms)
      const [noDerivGrantPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("license_grant"),
          noDerivLicensePda.toBuffer(),
          entityPda.toBuffer(),
        ],
        licenseProgram.programId,
      );

      await licenseProgram.methods
        .createLicenseGrant(new anchor.BN(0), ipCoreProgram.programId)
        .accountsPartial({
          license: noDerivLicensePda,
          authorityEntity: entityPda,
          granteeEntity: entityPda,
          controller: creator.publicKey,
        })
        .rpc();

      const [noDerivDerivPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("derivative"),
          noDerivParentIpPda.toBuffer(),
          noDerivChildIpPda.toBuffer(),
        ],
        ipCoreProgram.programId,
      );

      try {
        await ipCoreProgram.methods
          .createDerivativeLink()
          .accounts({
            parentIp: noDerivParentIpPda,
            childIp: noDerivChildIpPda,
            childOwnerEntity: entityPda,
            licenseGrant: noDerivGrantPda,
            license: noDerivLicensePda,
            licenseProgram: licenseProgram.programId,
            controller: creator.publicKey,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("DerivativesNotAllowed");
      }
    });

    it("fails when license grant is expired", async () => {
      // Create new IPs for this test
      const newParentHash = randomHash();
      const [expiredParentIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(newParentHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(newParentHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
          controller: creator.publicKey,
        })
        .rpc();

      const newChildHash = randomHash();
      const [expiredChildIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(newChildHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(newChildHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
          controller: creator.publicKey,
        })
        .rpc();

      // Create license
      const [expiredLicensePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("license"), expiredParentIpPda.toBuffer()],
        licenseProgram.programId,
      );

      await licenseProgram.methods
        .createLicense(true, ipCoreProgram.programId)
        .accounts({
          originIp: expiredParentIpPda,
          ownerEntity: entityPda,
          derivativeCheck: null,
          controller: creator.publicKey,
        })
        .rpc();

      // Create a new entity for expired grant
      const expiredGranteeIndex = await getEntityCount(
        ipCoreProgram,
        creator.publicKey,
      );
      const [expiredGranteeEntityPda] = deriveEntityPda(
        ipCoreProgram.programId,
        creator.publicKey,
        expiredGranteeIndex,
      );

      try {
        await ipCoreProgram.methods
          .createEntity()
          .accountsPartial({ entity: expiredGranteeEntityPda })
          .rpc();
      } catch {
        // Already exists
      }

      // Create grant with past expiration (expired)
      const [expiredGrantPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("license_grant"),
          expiredLicensePda.toBuffer(),
          expiredGranteeEntityPda.toBuffer(),
        ],
        licenseProgram.programId,
      );

      // Set expiration to 1 second ago (in the past)
      const pastTimestamp = Math.floor(Date.now() / 1000) - 1;

      await licenseProgram.methods
        .createLicenseGrant(
          new anchor.BN(pastTimestamp),
          ipCoreProgram.programId,
        )
        .accountsPartial({
          license: expiredLicensePda,
          authorityEntity: entityPda,
          granteeEntity: expiredGranteeEntityPda,
          controller: creator.publicKey,
        })
        .rpc();

      // Transfer child IP to the expired grantee entity
      await ipCoreProgram.methods
        .transferIp()
        .accounts({
          ip: expiredChildIpPda,
          currentOwnerEntity: entityPda,
          newOwnerEntity: expiredGranteeEntityPda,
          controller: creator.publicKey,
        })
        .rpc();

      const [expiredDerivPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("derivative"),
          expiredParentIpPda.toBuffer(),
          expiredChildIpPda.toBuffer(),
        ],
        ipCoreProgram.programId,
      );

      try {
        await ipCoreProgram.methods
          .createDerivativeLink()
          .accounts({
            parentIp: expiredParentIpPda,
            childIp: expiredChildIpPda,
            childOwnerEntity: expiredGranteeEntityPda,
            licenseGrant: expiredGrantPda,
            license: expiredLicensePda,
            licenseProgram: licenseProgram.programId,
            controller: creator.publicKey,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("GrantExpired");
      }
    });
  });
});
