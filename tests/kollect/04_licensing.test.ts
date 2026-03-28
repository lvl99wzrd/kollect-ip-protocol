import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
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
  deriveLicenseTemplatePda,
  deriveLicensePda,
  deriveLicenseGrantPda,
  deriveTemplateConfigPda,
  getTemplateCount,
  templateName,
  templateUri,
  signerMeta,
} from "./setup";

describe("kollect licensing", () => {
  const provider = getProvider();
  const { kollect } = getPrograms();
  const authority = provider.wallet as anchor.Wallet;

  let entityPda: PublicKey;
  let ipPda: PublicKey;
  let ipConfigPda: PublicKey;
  let mint: PublicKey;

  // Shared template + license references
  let templateId: number;
  let licenseTemplatePda: PublicKey;
  let licensePda: PublicKey;

  before(async () => {
    const state = await initializeIpCorePrerequisites();
    mint = state.mint;

    // Ensure platform is initialized
    const configPda = derivePlatformConfigPda(kollect.programId);
    await kollect.account.platformConfig.fetch(configPda);

    // Create entity + entity treasury
    const entity = await createTestEntity("licensing_entity");
    entityPda = entity.entityPda;

    const entityTreasuryPda = deriveEntityTreasuryPda(
      entityPda,
      kollect.programId,
    );
    try {
      await kollect.account.entityTreasury.fetch(entityTreasuryPda);
    } catch {
      await kollect.methods
        .initializeEntityTreasury(authority.publicKey)
        .accounts({ entity: entityPda, currencyMint: mint })
        .rpc();
    }

    // Create + onboard IP
    const ip = await createTestIp(entityPda);
    ipPda = ip.ipPda;
    ipConfigPda = deriveIpConfigPda(ipPda, kollect.programId);

    try {
      await kollect.account.ipConfig.fetch(ipConfigPda);
    } catch {
      await kollect.methods
        .onboardIp(null)
        .accounts({ entity: entityPda, ipAccount: ipPda, currencyMint: mint })
        .rpc();
    }
  });

  // --- License Template (Global PIL) ---

  describe("create_license_template", () => {
    it("creates a global license template with auto-incremented ID", async () => {
      templateId = await getTemplateCount(kollect);
      licenseTemplatePda = deriveLicenseTemplatePda(
        templateId,
        kollect.programId,
      );

      await kollect.methods
        .createLicenseTemplate({
          templateName: templateName("standard_license"),
          transferable: true,
          derivativesAllowed: true,
          derivativesReciprocal: false,
          derivativesApproval: false,
          commercialUse: true,
          commercialAttribution: false,
          commercialRevShareBps: 500,
          derivativeRevShareBps: 1500,
          uri: templateUri("ipfs://QmTest"),
        })
        .rpc();

      const tpl = await kollect.account.licenseTemplate.fetch(
        licenseTemplatePda,
      );
      expect(tpl.templateId.toNumber()).to.equal(templateId);
      expect(tpl.creator.toString()).to.equal(authority.publicKey.toString());
      expect(tpl.transferable).to.be.true;
      expect(tpl.derivativesAllowed).to.be.true;
      expect(tpl.commercialUse).to.be.true;
      expect(tpl.commercialRevShareBps).to.equal(500);
      expect(tpl.derivativeRevShareBps).to.equal(1500);
      expect(tpl.isActive).to.be.true;

      // Verify template config counter incremented
      const nextId = await getTemplateCount(kollect);
      expect(nextId).to.equal(templateId + 1);
    });

    it("auto-increments template IDs", async () => {
      const secondId = await getTemplateCount(kollect);
      const secondPda = deriveLicenseTemplatePda(secondId, kollect.programId);

      await kollect.methods
        .createLicenseTemplate({
          templateName: templateName("second_template"),
          transferable: false,
          derivativesAllowed: false,
          derivativesReciprocal: false,
          derivativesApproval: false,
          commercialUse: false,
          commercialAttribution: true,
          commercialRevShareBps: 0,
          derivativeRevShareBps: 0,
          uri: templateUri(""),
        })
        .rpc();

      const tpl = await kollect.account.licenseTemplate.fetch(secondPda);
      expect(tpl.templateId.toNumber()).to.equal(secondId);
      expect(secondId).to.equal(templateId + 1);
    });
  });

  // --- Update License Template ---

  describe("update_license_template", () => {
    it("deactivates template via update", async () => {
      await kollect.methods
        .updateLicenseTemplate({ newIsActive: false })
        .accountsPartial({ licenseTemplate: licenseTemplatePda })
        .rpc();

      const tpl = await kollect.account.licenseTemplate.fetch(
        licenseTemplatePda,
      );
      expect(tpl.isActive).to.be.false;

      // Re-activate for later tests
      await kollect.methods
        .updateLicenseTemplate({ newIsActive: true })
        .accountsPartial({ licenseTemplate: licenseTemplatePda })
        .rpc();
    });

    it("fails with wrong authority", async () => {
      const impostor = Keypair.generate();
      try {
        await kollect.methods
          .updateLicenseTemplate({ newIsActive: false })
          .accountsPartial({
            licenseTemplate: licenseTemplatePda,
            authority: impostor.publicKey,
          })
          .signers([impostor])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.match(
          /InvalidAuthority|ConstraintSeeds|unknown signer/,
        );
      }
    });
  });

  // --- Create License (Per-IP) ---

  describe("create_license", () => {
    it("creates a per-IP license attached to a template", async () => {
      licensePda = deriveLicensePda(
        ipPda,
        licenseTemplatePda,
        kollect.programId,
      );

      await kollect.methods
        .createLicense({
          price: new anchor.BN(1_000_000),
          maxGrants: 100,
          grantDuration: new anchor.BN(0),
          derivativeRevShareBps: 1500,
        })
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          licenseTemplate: licenseTemplatePda,
          license: licensePda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const lic = await kollect.account.license.fetch(licensePda);
      expect(lic.ipAccount.toString()).to.equal(ipPda.toString());
      expect(lic.licenseTemplate.toString()).to.equal(
        licenseTemplatePda.toString(),
      );
      expect(lic.ownerEntity.toString()).to.equal(entityPda.toString());
      expect(lic.price.toNumber()).to.equal(1_000_000);
      expect(lic.maxGrants).to.equal(100);
      expect(lic.currentGrants).to.equal(0);
      expect(lic.derivativeRevShareBps).to.equal(1500);
      expect(lic.isActive).to.be.true;
    });

    it("fails with bps below template minimum", async () => {
      // Template has derivativeRevShareBps = 1500 as floor
      const dupLicPda = deriveLicensePda(
        ipPda,
        licenseTemplatePda,
        kollect.programId,
      );
      try {
        await kollect.methods
          .createLicense({
            price: new anchor.BN(0),
            maxGrants: 0,
            grantDuration: new anchor.BN(0),
            derivativeRevShareBps: 100, // below 1500 floor
          })
          .accountsPartial({
            entity: entityPda,
            ipConfig: ipConfigPda,
            licenseTemplate: licenseTemplatePda,
            license: dupLicPda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.match(
          /DerivativeRevShareTooLow|already in use/,
        );
      }
    });
  });

  // --- Update License ---

  describe("update_license", () => {
    it("updates price and deactivates", async () => {
      await kollect.methods
        .updateLicense({
          newPrice: new anchor.BN(2_000_000),
          newGrantDuration: null,
          newIsActive: false,
          newDerivativeRevShareBps: null,
        })
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          licenseTemplate: licenseTemplatePda,
          license: licensePda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const lic = await kollect.account.license.fetch(licensePda);
      expect(lic.price.toNumber()).to.equal(2_000_000);
      expect(lic.isActive).to.be.false;

      // Re-activate and reset price for later tests
      await kollect.methods
        .updateLicense({
          newPrice: new anchor.BN(1_000_000),
          newGrantDuration: null,
          newIsActive: true,
          newDerivativeRevShareBps: null,
        })
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          licenseTemplate: licenseTemplatePda,
          license: licensePda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();
    });

    it("fails to set bps below template floor", async () => {
      try {
        await kollect.methods
          .updateLicense({
            newPrice: null,
            newGrantDuration: null,
            newIsActive: null,
            newDerivativeRevShareBps: 100, // below 1500 floor
          })
          .accountsPartial({
            entity: entityPda,
            ipConfig: ipConfigPda,
            licenseTemplate: licenseTemplatePda,
            license: licensePda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("DerivativeRevShareTooLow");
      }
    });
  });

  // --- Purchase License ---

  describe("purchase_license", () => {
    let granteeEntityPda: PublicKey;
    let platformTreasuryTokenAccount: PublicKey;

    before(async () => {
      // Create a separate grantee entity
      const grantee = await createTestEntity("lic_grantee");
      granteeEntityPda = grantee.entityPda;

      // Ensure grantee has an entity treasury
      const granteeETreasury = deriveEntityTreasuryPda(
        granteeEntityPda,
        kollect.programId,
      );
      try {
        await kollect.account.entityTreasury.fetch(granteeETreasury);
      } catch {
        await kollect.methods
          .initializeEntityTreasury(authority.publicKey)
          .accounts({ entity: granteeEntityPda, currencyMint: mint })
          .rpc();
      }

      // Ensure platform treasury ATA
      const platformTreasuryPda = derivePlatformTreasuryPda(kollect.programId);
      const ata = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        platformTreasuryPda,
        true,
      );
      platformTreasuryTokenAccount = ata.address;
    });

    it("purchases a perpetual license and records price_paid", async () => {
      const licenseGrantPda = deriveLicenseGrantPda(
        licensePda,
        granteeEntityPda,
        kollect.programId,
      );

      const ipTreasuryPda = deriveIpTreasuryPda(ipPda, kollect.programId);
      const ipTreasuryAta = getAssociatedTokenAddressSync(
        mint,
        ipTreasuryPda,
        true,
      );

      // Fund buyer
      const payerAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        authority.publicKey,
      );
      await mintTo(
        provider.connection,
        authority.payer,
        mint,
        payerAta.address,
        authority.publicKey,
        10_000_000,
      );

      await kollect.methods
        .purchaseLicense()
        .accountsPartial({
          granteeEntity: granteeEntityPda,
          license: licensePda,
          licenseGrant: licenseGrantPda,
          payerTokenAccount: payerAta.address,
          platformTokenAccount: platformTreasuryTokenAccount,
          ipTreasuryTokenAccount: ipTreasuryAta,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const grant = await kollect.account.licenseGrant.fetch(licenseGrantPda);
      expect(grant.license.toString()).to.equal(licensePda.toString());
      expect(grant.grantee.toString()).to.equal(granteeEntityPda.toString());
      expect(grant.pricePaid.toNumber()).to.equal(1_000_000);
      expect(grant.expiration.toNumber()).to.equal(0); // perpetual

      // Verify current_grants incremented
      const lic = await kollect.account.license.fetch(licensePda);
      expect(lic.currentGrants).to.equal(1);
    });

    it("fails when license is not active", async () => {
      // Deactivate the license
      await kollect.methods
        .updateLicense({
          newPrice: null,
          newGrantDuration: null,
          newIsActive: false,
          newDerivativeRevShareBps: null,
        })
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          licenseTemplate: licenseTemplatePda,
          license: licensePda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const otherGrantee = await createTestEntity("lic_blocked");
      const otherGETreasury = deriveEntityTreasuryPda(
        otherGrantee.entityPda,
        kollect.programId,
      );
      try {
        await kollect.account.entityTreasury.fetch(otherGETreasury);
      } catch {
        await kollect.methods
          .initializeEntityTreasury(authority.publicKey)
          .accounts({ entity: otherGrantee.entityPda, currencyMint: mint })
          .rpc();
      }

      const otherGrantPda = deriveLicenseGrantPda(
        licensePda,
        otherGrantee.entityPda,
        kollect.programId,
      );
      const ipTreasuryPda = deriveIpTreasuryPda(ipPda, kollect.programId);
      const ipTreasuryAta = getAssociatedTokenAddressSync(
        mint,
        ipTreasuryPda,
        true,
      );
      const payerAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        authority.publicKey,
      );

      try {
        await kollect.methods
          .purchaseLicense()
          .accountsPartial({
            granteeEntity: otherGrantee.entityPda,
            license: licensePda,
            licenseGrant: otherGrantPda,
            payerTokenAccount: payerAta.address,
            platformTokenAccount: platformTreasuryTokenAccount,
            ipTreasuryTokenAccount: ipTreasuryAta,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("LicenseNotActive");
      }

      // Re-activate for other tests
      await kollect.methods
        .updateLicense({
          newPrice: null,
          newGrantDuration: null,
          newIsActive: true,
          newDerivativeRevShareBps: null,
        })
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          licenseTemplate: licenseTemplatePda,
          license: licensePda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();
    });
  });
});
