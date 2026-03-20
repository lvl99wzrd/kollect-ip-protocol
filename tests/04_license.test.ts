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

describe("license", () => {
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
  let ipPda: PublicKey;
  let licensePda: PublicKey;

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

    // Create IP
    const contentHash = randomHash();
    [ipPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
      ipCoreProgram.programId,
    );

    await ipCoreProgram.methods
      .createIp(contentHash)
      .accounts({
        registrantEntity: entityPda,
        treasuryTokenAccount: treasuryTokenAccount,
        payerTokenAccount: payerTokenAccount,
        controller: creator.publicKey,
      })
      .rpc();

    // Derive license PDA
    [licensePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("license"), ipPda.toBuffer()],
      licenseProgram.programId,
    );
  });

  describe("create_license", () => {
    it("creates a license with derivatives allowed", async () => {
      await licenseProgram.methods
        .createLicense(true, ipCoreProgram.programId)
        .accounts({
          originIp: ipPda,
          ownerEntity: entityPda,
          derivativeCheck: null,
          controller: creator.publicKey,
        })
        .rpc();

      const license = await licenseProgram.account.license.fetch(licensePda);
      expect(license.originIp.toString()).to.equal(ipPda.toString());
      expect(license.authority.toString()).to.equal(entityPda.toString());
      expect(license.derivativesAllowed).to.be.true;
    });

    it("derives deterministic PDA from origin_ip", () => {
      const [derivedPda1] = PublicKey.findProgramAddressSync(
        [Buffer.from("license"), ipPda.toBuffer()],
        licenseProgram.programId,
      );

      const [derivedPda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("license"), ipPda.toBuffer()],
        licenseProgram.programId,
      );

      expect(derivedPda1.toString()).to.equal(derivedPda2.toString());
      expect(derivedPda1.toString()).to.equal(licensePda.toString());
    });

    it("fails when license already exists", async () => {
      // Try to create another license for the same IP
      try {
        await licenseProgram.methods
          .createLicense(false, ipCoreProgram.programId)
          .accounts({
            originIp: ipPda,
            ownerEntity: entityPda,
            derivativeCheck: null,
            controller: creator.publicKey,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        // Account already exists error from Anchor
        expect(err.toString()).to.include("Error");
      }
    });

    it("fails without controller signature", async () => {
      // Create a new IP for this test
      const contentHash = randomHash();
      const [newIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(contentHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
          controller: creator.publicKey,
        })
        .rpc();

      // Try to create license without controller signature
      const fakeController = Keypair.generate();
      try {
        await licenseProgram.methods
          .createLicense(true, ipCoreProgram.programId)
          .accounts({
            originIp: newIpPda,
            ownerEntity: entityPda,
            derivativeCheck: null,
            controller: fakeController.publicKey,
          })
          .signers([fakeController])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });
  });

  describe("update_license", () => {
    it("updates derivatives_allowed", async () => {
      const licenseBefore = await licenseProgram.account.license.fetch(
        licensePda,
      );
      expect(licenseBefore.derivativesAllowed).to.be.true;

      await licenseProgram.methods
        .updateLicense(false, ipCoreProgram.programId)
        .accountsPartial({
          license: licensePda,
          authorityEntity: entityPda,
          controller: creator.publicKey,
        })
        .rpc();

      const licenseAfter = await licenseProgram.account.license.fetch(
        licensePda,
      );
      expect(licenseAfter.derivativesAllowed).to.be.false;

      // Immutable fields unchanged
      expect(licenseAfter.originIp.toString()).to.equal(
        licenseBefore.originIp.toString(),
      );
      expect(licenseAfter.authority.toString()).to.equal(
        licenseBefore.authority.toString(),
      );
      expect(licenseAfter.createdAt.toString()).to.equal(
        licenseBefore.createdAt.toString(),
      );

      // Revert back for other tests
      await licenseProgram.methods
        .updateLicense(true, ipCoreProgram.programId)
        .accountsPartial({
          license: licensePda,
          authorityEntity: entityPda,
          controller: creator.publicKey,
        })
        .rpc();
    });

    it("fails without controller signature", async () => {
      // Try to update license without controller signature
      const fakeController = Keypair.generate();
      try {
        await licenseProgram.methods
          .updateLicense(false, ipCoreProgram.programId)
          .accountsPartial({
            license: licensePda,
            authorityEntity: entityPda,
            controller: fakeController.publicKey,
          })
          .signers([fakeController])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });

    it("fails with wrong authority", async () => {
      // Create another entity
      const otherIndex = await getEntityCount(ipCoreProgram, creator.publicKey);
      const [otherEntityPda] = deriveEntityPda(
        ipCoreProgram.programId,
        creator.publicKey,
        otherIndex,
      );

      try {
        await ipCoreProgram.methods
          .createEntity()
          .accountsPartial({ entity: otherEntityPda })
          .rpc();
      } catch {
        // Already exists
      }

      try {
        await licenseProgram.methods
          .updateLicense(false, ipCoreProgram.programId)
          .accountsPartial({
            license: licensePda,
            authorityEntity: otherEntityPda, // Wrong authority!
            controller: creator.publicKey,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAuthority");
      }
    });
  });

  describe("create_license_grant", () => {
    let granteeEntityPda: PublicKey;
    let licenseGrantPda: PublicKey;

    before(async () => {
      // Create grantee entity
      const granteeIndex = await getEntityCount(
        ipCoreProgram,
        creator.publicKey,
      );
      [granteeEntityPda] = deriveEntityPda(
        ipCoreProgram.programId,
        creator.publicKey,
        granteeIndex,
      );

      try {
        await ipCoreProgram.methods
          .createEntity()
          .accountsPartial({ entity: granteeEntityPda })
          .rpc();
      } catch {
        // Already exists
      }

      // Derive license grant PDA
      [licenseGrantPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("license_grant"),
          licensePda.toBuffer(),
          granteeEntityPda.toBuffer(),
        ],
        licenseProgram.programId,
      );
    });

    it("creates a license grant with no expiration", async () => {
      await licenseProgram.methods
        .createLicenseGrant(new anchor.BN(0), ipCoreProgram.programId)
        .accountsPartial({
          license: licensePda,
          authorityEntity: entityPda,
          granteeEntity: granteeEntityPda,
          controller: creator.publicKey,
        })
        .rpc();

      const grant = await licenseProgram.account.licenseGrant.fetch(
        licenseGrantPda,
      );
      expect(grant.license.toString()).to.equal(licensePda.toString());
      expect(grant.grantee.toString()).to.equal(granteeEntityPda.toString());
      expect(grant.expiration.toNumber()).to.equal(0);
    });

    it("derives deterministic PDA from license and grantee", () => {
      const [derivedPda1] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("license_grant"),
          licensePda.toBuffer(),
          granteeEntityPda.toBuffer(),
        ],
        licenseProgram.programId,
      );

      const [derivedPda2] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("license_grant"),
          licensePda.toBuffer(),
          granteeEntityPda.toBuffer(),
        ],
        licenseProgram.programId,
      );

      expect(derivedPda1.toString()).to.equal(derivedPda2.toString());
      expect(derivedPda1.toString()).to.equal(licenseGrantPda.toString());
    });

    it("creates a license grant with expiration", async () => {
      // Create another grantee for this test
      const granteeIndex2 = await getEntityCount(
        ipCoreProgram,
        creator.publicKey,
      );
      const [granteeEntity2Pda] = deriveEntityPda(
        ipCoreProgram.programId,
        creator.publicKey,
        granteeIndex2,
      );

      try {
        await ipCoreProgram.methods
          .createEntity()
          .accountsPartial({ entity: granteeEntity2Pda })
          .rpc();
      } catch {
        // Already exists
      }

      const [licenseGrant2Pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("license_grant"),
          licensePda.toBuffer(),
          granteeEntity2Pda.toBuffer(),
        ],
        licenseProgram.programId,
      );

      // Set expiration to 1 year from now
      const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

      await licenseProgram.methods
        .createLicenseGrant(
          new anchor.BN(oneYearFromNow),
          ipCoreProgram.programId,
        )
        .accountsPartial({
          license: licensePda,
          authorityEntity: entityPda,
          granteeEntity: granteeEntity2Pda,
          controller: creator.publicKey,
        })
        .rpc();

      const grant = await licenseProgram.account.licenseGrant.fetch(
        licenseGrant2Pda,
      );
      expect(grant.expiration.toNumber()).to.equal(oneYearFromNow);
    });

    it("fails when grant already exists", async () => {
      try {
        await licenseProgram.methods
          .createLicenseGrant(new anchor.BN(0), ipCoreProgram.programId)
          .accountsPartial({
            license: licensePda,
            authorityEntity: entityPda,
            granteeEntity: granteeEntityPda,
            controller: creator.publicKey,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        // Account already exists error from Anchor
        expect(err.toString()).to.include("Error");
      }
    });

    it("fails without controller signature", async () => {
      // Create another grantee
      const granteeIndex3 = await getEntityCount(
        ipCoreProgram,
        creator.publicKey,
      );
      const [granteeEntity3Pda] = deriveEntityPda(
        ipCoreProgram.programId,
        creator.publicKey,
        granteeIndex3,
      );

      try {
        await ipCoreProgram.methods
          .createEntity()
          .accountsPartial({ entity: granteeEntity3Pda })
          .rpc();
      } catch {
        // Already exists
      }

      // Try to create license grant without controller signature
      const fakeController = Keypair.generate();
      try {
        await licenseProgram.methods
          .createLicenseGrant(new anchor.BN(0), ipCoreProgram.programId)
          .accountsPartial({
            license: licensePda,
            authorityEntity: entityPda,
            granteeEntity: granteeEntity3Pda,
            controller: fakeController.publicKey,
          })
          .signers([fakeController])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });
  });

  describe("revoke_license_grant", () => {
    let revokeGranteeEntityPda: PublicKey;
    let revokeLicenseGrantPda: PublicKey;

    before(async () => {
      // Create a grantee specifically for revocation test
      const revokeIndex = await getEntityCount(
        ipCoreProgram,
        creator.publicKey,
      );
      [revokeGranteeEntityPda] = deriveEntityPda(
        ipCoreProgram.programId,
        creator.publicKey,
        revokeIndex,
      );

      try {
        await ipCoreProgram.methods
          .createEntity()
          .accountsPartial({ entity: revokeGranteeEntityPda })
          .rpc();
      } catch {
        // Already exists
      }

      [revokeLicenseGrantPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("license_grant"),
          licensePda.toBuffer(),
          revokeGranteeEntityPda.toBuffer(),
        ],
        licenseProgram.programId,
      );

      // Create the grant
      await licenseProgram.methods
        .createLicenseGrant(new anchor.BN(0), ipCoreProgram.programId)
        .accountsPartial({
          license: licensePda,
          authorityEntity: entityPda,
          granteeEntity: revokeGranteeEntityPda,
          controller: creator.publicKey,
        })
        .rpc();
    });

    it("revokes a license grant", async () => {
      // Verify grant exists
      const grantBefore = await licenseProgram.account.licenseGrant.fetch(
        revokeLicenseGrantPda,
      );
      expect(grantBefore).to.not.be.null;

      await licenseProgram.methods
        .revokeLicenseGrant(ipCoreProgram.programId)
        .accountsPartial({
          licenseGrant: revokeLicenseGrantPda,
          license: licensePda,
          authorityEntity: entityPda,
          rentDestination: creator.publicKey,
          controller: creator.publicKey,
        })
        .rpc();

      // Verify grant no longer exists
      try {
        await licenseProgram.account.licenseGrant.fetch(revokeLicenseGrantPda);
        expect.fail("Account should be closed");
      } catch (err) {
        expect(err.toString()).to.include("Account does not exist");
      }
    });

    it("fails without controller signature", async () => {
      const fakeController = Keypair.generate();
      // Create another grant to revoke
      const revokeIndex2 = await getEntityCount(
        ipCoreProgram,
        creator.publicKey,
      );
      const [revokeEntity2Pda] = deriveEntityPda(
        ipCoreProgram.programId,
        creator.publicKey,
        revokeIndex2,
      );

      try {
        await ipCoreProgram.methods
          .createEntity()
          .accountsPartial({ entity: revokeEntity2Pda })
          .rpc();
      } catch {
        // Already exists
      }

      const [revokeGrant2Pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("license_grant"),
          licensePda.toBuffer(),
          revokeEntity2Pda.toBuffer(),
        ],
        licenseProgram.programId,
      );

      await licenseProgram.methods
        .createLicenseGrant(new anchor.BN(0), ipCoreProgram.programId)
        .accountsPartial({
          license: licensePda,
          authorityEntity: entityPda,
          granteeEntity: revokeEntity2Pda,
          controller: creator.publicKey,
        })
        .rpc();

      try {
        await licenseProgram.methods
          .revokeLicenseGrant(ipCoreProgram.programId)
          .accountsPartial({
            licenseGrant: revokeGrant2Pda,
            license: licensePda,
            authorityEntity: entityPda,
            rentDestination: creator.publicKey,
            controller: fakeController.publicKey,
          })
          .signers([fakeController])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });
  });

  describe("revoke_license", () => {
    let revokeLicenseIpPda: PublicKey;
    let revokeLicensePda: PublicKey;

    before(async () => {
      // Create a new IP specifically for revocation test
      const contentHash = randomHash();
      [revokeLicenseIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(contentHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
          controller: creator.publicKey,
        })
        .rpc();

      // Create license for this IP
      [revokeLicensePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("license"), revokeLicenseIpPda.toBuffer()],
        licenseProgram.programId,
      );

      await licenseProgram.methods
        .createLicense(true, ipCoreProgram.programId)
        .accounts({
          originIp: revokeLicenseIpPda,
          ownerEntity: entityPda,
          derivativeCheck: null,
          controller: creator.publicKey,
        })
        .rpc();
    });

    it("revokes a license", async () => {
      // Verify license exists
      const licenseBefore = await licenseProgram.account.license.fetch(
        revokeLicensePda,
      );
      expect(licenseBefore).to.not.be.null;

      await licenseProgram.methods
        .revokeLicense(ipCoreProgram.programId)
        .accountsPartial({
          license: revokeLicensePda,
          authorityEntity: entityPda,
          rentDestination: creator.publicKey,
          controller: creator.publicKey,
        })
        .rpc();

      // Verify license no longer exists
      try {
        await licenseProgram.account.license.fetch(revokeLicensePda);
        expect.fail("Account should be closed");
      } catch (err) {
        expect(err.toString()).to.include("Account does not exist");
      }
    });

    it("fails without controller signature", async () => {
      const fakeController = Keypair.generate();
      // Create another IP and license to test this
      const contentHash = randomHash();
      const [testIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(contentHash)
        .accounts({
          registrantEntity: entityPda,
          treasuryTokenAccount: treasuryTokenAccount,
          payerTokenAccount: payerTokenAccount,
          controller: creator.publicKey,
        })
        .rpc();

      const [testLicensePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("license"), testIpPda.toBuffer()],
        licenseProgram.programId,
      );

      await licenseProgram.methods
        .createLicense(true, ipCoreProgram.programId)
        .accounts({
          originIp: testIpPda,
          ownerEntity: entityPda,
          derivativeCheck: null,
          controller: creator.publicKey,
        })
        .rpc();

      try {
        await licenseProgram.methods
          .revokeLicense(ipCoreProgram.programId)
          .accountsPartial({
            license: testLicensePda,
            authorityEntity: entityPda,
            rentDestination: creator.publicKey,
            controller: fakeController.publicKey,
          })
          .signers([fakeController])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });
  });
});
