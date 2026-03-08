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
import { padBytes } from "../utils/helper";

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
    const handle = padBytes("lic_owner", 32);
    [entityPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("entity"),
        creator.publicKey.toBuffer(),
        Buffer.from(handle),
      ],
      ipCoreProgram.programId,
    );

    try {
      await ipCoreProgram.methods.createEntity(handle, [], 1).rpc();
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
      })
      .remainingAccounts([
        { pubkey: creator.publicKey, isSigner: true, isWritable: false },
      ])
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
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
          })
          .remainingAccounts([
            { pubkey: creator.publicKey, isSigner: true, isWritable: false },
          ])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        // Account already exists error from Anchor
        expect(err.toString()).to.include("Error");
      }
    });

    it("fails without multisig approval", async () => {
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      // Try to create license without passing signers in remaining accounts
      try {
        await licenseProgram.methods
          .createLicense(true, ipCoreProgram.programId)
          .accounts({
            originIp: newIpPda,
            ownerEntity: entityPda,
            derivativeCheck: null,
          })
          .remainingAccounts([]) // No signers!
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InsufficientSignatures");
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();
    });

    it("fails without multisig approval", async () => {
      try {
        await licenseProgram.methods
          .updateLicense(false, ipCoreProgram.programId)
          .accountsPartial({
            license: licensePda,
            authorityEntity: entityPda,
          })
          .remainingAccounts([]) // No signers!
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InsufficientSignatures");
      }
    });

    it("fails with wrong authority", async () => {
      // Create another entity
      const otherHandle = padBytes("other_lic", 32);
      const [otherEntityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(otherHandle),
        ],
        ipCoreProgram.programId,
      );

      try {
        await ipCoreProgram.methods.createEntity(otherHandle, [], 1).rpc();
      } catch {
        // Already exists
      }

      try {
        await licenseProgram.methods
          .updateLicense(false, ipCoreProgram.programId)
          .accountsPartial({
            license: licensePda,
            authorityEntity: otherEntityPda, // Wrong authority!
          })
          .remainingAccounts([
            { pubkey: creator.publicKey, isSigner: true, isWritable: false },
          ])
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
      const granteeHandle = padBytes("grantee", 32);
      [granteeEntityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(granteeHandle),
        ],
        ipCoreProgram.programId,
      );

      try {
        await ipCoreProgram.methods.createEntity(granteeHandle, [], 1).rpc();
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
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
      const granteeHandle2 = padBytes("grantee2", 32);
      const [granteeEntity2Pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(granteeHandle2),
        ],
        ipCoreProgram.programId,
      );

      try {
        await ipCoreProgram.methods.createEntity(granteeHandle2, [], 1).rpc();
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
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
          })
          .remainingAccounts([
            { pubkey: creator.publicKey, isSigner: true, isWritable: false },
          ])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        // Account already exists error from Anchor
        expect(err.toString()).to.include("Error");
      }
    });

    it("fails without multisig approval", async () => {
      // Create another grantee
      const granteeHandle3 = padBytes("grantee3", 32);
      const [granteeEntity3Pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(granteeHandle3),
        ],
        ipCoreProgram.programId,
      );

      try {
        await ipCoreProgram.methods.createEntity(granteeHandle3, [], 1).rpc();
      } catch {
        // Already exists
      }

      try {
        await licenseProgram.methods
          .createLicenseGrant(new anchor.BN(0), ipCoreProgram.programId)
          .accountsPartial({
            license: licensePda,
            authorityEntity: entityPda,
            granteeEntity: granteeEntity3Pda,
          })
          .remainingAccounts([]) // No signers!
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InsufficientSignatures");
      }
    });
  });

  describe("revoke_license_grant", () => {
    let revokeGranteeEntityPda: PublicKey;
    let revokeLicenseGrantPda: PublicKey;

    before(async () => {
      // Create a grantee specifically for revocation test
      const revokeGranteeHandle = padBytes("revoke_grant", 32);
      [revokeGranteeEntityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(revokeGranteeHandle),
        ],
        ipCoreProgram.programId,
      );

      try {
        await ipCoreProgram.methods
          .createEntity(revokeGranteeHandle, [], 1)
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      // Verify grant no longer exists
      try {
        await licenseProgram.account.licenseGrant.fetch(revokeLicenseGrantPda);
        expect.fail("Account should be closed");
      } catch (err) {
        expect(err.toString()).to.include("Account does not exist");
      }
    });

    it("fails without multisig approval", async () => {
      // Create another grant to revoke
      const revokeHandle2 = padBytes("revoke2", 32);
      const [revokeEntity2Pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(revokeHandle2),
        ],
        ipCoreProgram.programId,
      );

      try {
        await ipCoreProgram.methods.createEntity(revokeHandle2, [], 1).rpc();
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      try {
        await licenseProgram.methods
          .revokeLicenseGrant(ipCoreProgram.programId)
          .accountsPartial({
            licenseGrant: revokeGrant2Pda,
            license: licensePda,
            authorityEntity: entityPda,
            rentDestination: creator.publicKey,
          })
          .remainingAccounts([]) // No signers!
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InsufficientSignatures");
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      // Verify license no longer exists
      try {
        await licenseProgram.account.license.fetch(revokeLicensePda);
        expect.fail("Account should be closed");
      } catch (err) {
        expect(err.toString()).to.include("Account does not exist");
      }
    });

    it("fails without multisig approval", async () => {
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
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
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      try {
        await licenseProgram.methods
          .revokeLicense(ipCoreProgram.programId)
          .accountsPartial({
            license: testLicensePda,
            authorityEntity: entityPda,
            rentDestination: creator.publicKey,
          })
          .remainingAccounts([]) // No signers!
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InsufficientSignatures");
      }
    });
  });
});
