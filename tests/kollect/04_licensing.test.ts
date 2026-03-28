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
  deriveRoyaltyPolicyPda,
  templateName,
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
  let tplNameBytes: number[];
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
        .remainingAccounts([signerMeta(authority.publicKey)])
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

  // ─── License Template ──────────────────────────────────────────────────────

  describe("create_license_template", () => {
    it("creates a license template and thin license account", async () => {
      tplNameBytes = templateName("standard_license");
      licenseTemplatePda = deriveLicenseTemplatePda(
        ipPda,
        tplNameBytes,
        kollect.programId,
      );
      licensePda = deriveLicensePda(licenseTemplatePda, kollect.programId);

      await kollect.methods
        .createLicenseTemplate(
          tplNameBytes,
          new anchor.BN(1_000_000), // price
          100, // max_grants
          new anchor.BN(0), // grant_duration (0 = perpetual)
        )
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const tpl = await kollect.account.licenseTemplate.fetch(
        licenseTemplatePda,
      );
      expect(tpl.ipAccount.toString()).to.equal(ipPda.toString());
      expect(tpl.ipConfig.toString()).to.equal(ipConfigPda.toString());
      expect(tpl.creatorEntity.toString()).to.equal(entityPda.toString());
      expect(tpl.price.toNumber()).to.equal(1_000_000);
      expect(tpl.maxGrants).to.equal(100);
      expect(tpl.currentGrants).to.equal(0);
      expect(tpl.grantDuration.toNumber()).to.equal(0);
      expect(tpl.isActive).to.be.true;

      const license = await kollect.account.license.fetch(licensePda);
      expect(license.originIp.toString()).to.equal(ipPda.toString());
      expect(license.authority.toString()).to.equal(entityPda.toString());
      expect(license.derivativesAllowed).to.be.true;
    });

    it("fails with duplicate template name (PDA collision)", async () => {
      try {
        await kollect.methods
          .createLicenseTemplate(
            tplNameBytes,
            new anchor.BN(500_000),
            50,
            new anchor.BN(0),
          )
          .accountsPartial({
            entity: entityPda,
            ipConfig: ipConfigPda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err).to.exist;
      }
    });

    it("fails with non-owner entity", async () => {
      const otherEntity = await createTestEntity("lic_nonowner");
      const nameBytes = templateName("should_fail_tpl");

      try {
        await kollect.methods
          .createLicenseTemplate(
            nameBytes,
            new anchor.BN(100),
            10,
            new anchor.BN(0),
          )
          .accountsPartial({
            entity: otherEntity.entityPda,
            ipConfig: ipConfigPda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("IpOwnerMismatch");
      }
    });

    it("fails on deactivated IP", async () => {
      // Create a separate IP and deactivate it
      const ip2 = await createTestIp(entityPda);
      const ip2ConfigPda = deriveIpConfigPda(ip2.ipPda, kollect.programId);

      await kollect.methods
        .onboardIp(null)
        .accounts({
          entity: entityPda,
          ipAccount: ip2.ipPda,
          currencyMint: mint,
        })
        .rpc();

      await kollect.methods
        .deactivateIp()
        .accountsPartial({ ipConfig: ip2ConfigPda })
        .rpc();

      const nameBytes = templateName("deact_ip_tpl");

      try {
        await kollect.methods
          .createLicenseTemplate(
            nameBytes,
            new anchor.BN(100),
            10,
            new anchor.BN(0),
          )
          .accountsPartial({
            entity: entityPda,
            ipConfig: ip2ConfigPda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("IpNotActive");
      }
    });
  });

  // ─── Update License Template ───────────────────────────────────────────────

  describe("update_license_template", () => {
    it("updates price and max_grants", async () => {
      await kollect.methods
        .updateLicenseTemplate({
          newPrice: new anchor.BN(2_000_000),
          newGrantDuration: null,
          newIsActive: null,
        })
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          licenseTemplate: licenseTemplatePda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const tpl = await kollect.account.licenseTemplate.fetch(
        licenseTemplatePda,
      );
      expect(tpl.price.toNumber()).to.equal(2_000_000);
      expect(tpl.maxGrants).to.equal(100);
    });

    it("deactivates template via update", async () => {
      await kollect.methods
        .updateLicenseTemplate({
          newPrice: null,
          newGrantDuration: null,
          newIsActive: false,
        })
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          licenseTemplate: licenseTemplatePda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const tpl = await kollect.account.licenseTemplate.fetch(
        licenseTemplatePda,
      );
      expect(tpl.isActive).to.be.false;

      // Re-activate for subsequent tests
      await kollect.methods
        .updateLicenseTemplate({
          newPrice: null,
          newGrantDuration: null,
          newIsActive: true,
        })
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          licenseTemplate: licenseTemplatePda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();
    });

    it("fails with wrong authority", async () => {
      const otherEntity = await createTestEntity("lic_wrong_auth");

      try {
        await kollect.methods
          .updateLicenseTemplate({
            newPrice: new anchor.BN(999),
            newGrantDuration: null,
            newIsActive: null,
          })
          .accountsPartial({
            entity: otherEntity.entityPda,
            ipConfig: ipConfigPda,
            licenseTemplate: licenseTemplatePda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("IpOwnerMismatch");
      }
    });
  });

  // ─── Royalty Policy ────────────────────────────────────────────────────────

  describe("create_royalty_policy", () => {
    let royaltyPolicyPda: PublicKey;

    it("creates a royalty policy for a template", async () => {
      royaltyPolicyPda = deriveRoyaltyPolicyPda(
        licenseTemplatePda,
        kollect.programId,
      );

      await kollect.methods
        .createRoyaltyPolicy(
          1500, // derivative_share_bps (15%)
          true, // allow_remix
          true, // allow_cover
          false, // allow_sample
          true, // attribution_required
          true, // commercial_use
        )
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          licenseTemplate: licenseTemplatePda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const policy = await kollect.account.royaltyPolicy.fetch(
        royaltyPolicyPda,
      );
      expect(policy.licenseTemplate.toString()).to.equal(
        licenseTemplatePda.toString(),
      );
      expect(policy.derivativeShareBps).to.equal(1500);
      expect(policy.allowRemix).to.be.true;
      expect(policy.allowCover).to.be.true;
      expect(policy.allowSample).to.be.false;
      expect(policy.attributionRequired).to.be.true;
      expect(policy.commercialUse).to.be.true;
    });

    it("fails with duplicate policy (PDA collision)", async () => {
      try {
        await kollect.methods
          .createRoyaltyPolicy(500, false, false, false, false, false)
          .accountsPartial({
            entity: entityPda,
            ipConfig: ipConfigPda,
            licenseTemplate: licenseTemplatePda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err).to.exist;
      }
    });
  });

  // ─── Update Royalty Policy ─────────────────────────────────────────────────

  describe("update_royalty_policy", () => {
    it("updates derivative share and flags", async () => {
      const royaltyPolicyPda = deriveRoyaltyPolicyPda(
        licenseTemplatePda,
        kollect.programId,
      );

      await kollect.methods
        .updateRoyaltyPolicy({
          newDerivativeShareBps: 2000,
          newAllowRemix: null,
          newAllowCover: false,
          newAllowSample: true,
          newAttributionRequired: null,
          newCommercialUse: null,
        })
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          licenseTemplate: licenseTemplatePda,
          royaltyPolicy: royaltyPolicyPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const policy = await kollect.account.royaltyPolicy.fetch(
        royaltyPolicyPda,
      );
      expect(policy.derivativeShareBps).to.equal(2000);
      expect(policy.allowRemix).to.be.true; // unchanged
      expect(policy.allowCover).to.be.false; // updated
      expect(policy.allowSample).to.be.true; // updated
    });

    it("fails with non-owner entity", async () => {
      const otherEntity = await createTestEntity("rp_nonowner");
      const royaltyPolicyPda = deriveRoyaltyPolicyPda(
        licenseTemplatePda,
        kollect.programId,
      );

      try {
        await kollect.methods
          .updateRoyaltyPolicy({
            newDerivativeShareBps: 500,
            newAllowRemix: null,
            newAllowCover: null,
            newAllowSample: null,
            newAttributionRequired: null,
            newCommercialUse: null,
          })
          .accountsPartial({
            entity: otherEntity.entityPda,
            ipConfig: ipConfigPda,
            licenseTemplate: licenseTemplatePda,
            royaltyPolicy: royaltyPolicyPda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("IpOwnerMismatch");
      }
    });
  });

  // ─── Purchase License ──────────────────────────────────────────────────────

  describe("purchase_license", () => {
    let granteeEntityPda: PublicKey;
    let payerAta: PublicKey;
    let platformAta: PublicKey;
    let ipTreasuryAta: PublicKey;
    let activeTplPda: PublicKey;
    let activeLicensePda: PublicKey;

    before(async () => {
      // Use a fresh template with known price for purchase tests
      const purchaseTplName = templateName("purchase_tpl");
      activeTplPda = deriveLicenseTemplatePda(
        ipPda,
        purchaseTplName,
        kollect.programId,
      );
      activeLicensePda = deriveLicensePda(activeTplPda, kollect.programId);

      await kollect.methods
        .createLicenseTemplate(
          purchaseTplName,
          new anchor.BN(1_000_000), // 1 token (6 decimals)
          10, // max_grants
          new anchor.BN(0), // perpetual
        )
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      // Create grantee entity
      const grantee = await createTestEntity("grantee_entity");
      granteeEntityPda = grantee.entityPda;

      // Set up token accounts
      const platformTreasuryPda = derivePlatformTreasuryPda(kollect.programId);

      const payerAtaAcct = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        authority.publicKey,
      );
      payerAta = payerAtaAcct.address;

      const platformAtaAcct = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority.payer,
        mint,
        platformTreasuryPda,
        true,
      );
      platformAta = platformAtaAcct.address;

      // Derive IP treasury token account (created by onboardIp)
      const ipTreasuryPda = deriveIpTreasuryPda(ipPda, kollect.programId);
      ipTreasuryAta = getAssociatedTokenAddressSync(mint, ipTreasuryPda, true);

      // Ensure payer has enough tokens
      await mintTo(
        provider.connection,
        authority.payer,
        mint,
        payerAta,
        authority.publicKey,
        100_000_000,
      );
    });

    it("purchases a perpetual license", async () => {
      const grantPda = deriveLicenseGrantPda(
        activeLicensePda,
        granteeEntityPda,
        kollect.programId,
      );

      const payerBalanceBefore =
        await provider.connection.getTokenAccountBalance(payerAta);

      await kollect.methods
        .purchaseLicense()
        .accountsPartial({
          granteeEntity: granteeEntityPda,
          licenseTemplate: activeTplPda,
          license: activeLicensePda,
          licenseGrant: grantPda,
          payerTokenAccount: payerAta,
          platformTokenAccount: platformAta,
          ipTreasuryTokenAccount: ipTreasuryAta,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const grant = await kollect.account.licenseGrant.fetch(grantPda);
      expect(grant.license.toString()).to.equal(activeLicensePda.toString());
      expect(grant.grantee.toString()).to.equal(granteeEntityPda.toString());
      expect(grant.grantedAt.toNumber()).to.be.greaterThan(0);
      expect(grant.expiration.toNumber()).to.equal(0); // perpetual

      // Verify template grants incremented
      const tpl = await kollect.account.licenseTemplate.fetch(activeTplPda);
      expect(tpl.currentGrants).to.equal(1);
    });

    it("fails with duplicate license grant (PDA collision)", async () => {
      const grantPda = deriveLicenseGrantPda(
        activeLicensePda,
        granteeEntityPda,
        kollect.programId,
      );

      try {
        await kollect.methods
          .purchaseLicense()
          .accountsPartial({
            granteeEntity: granteeEntityPda,
            licenseTemplate: activeTplPda,
            license: activeLicensePda,
            licenseGrant: grantPda,
            payerTokenAccount: payerAta,
            platformTokenAccount: platformAta,
            ipTreasuryTokenAccount: ipTreasuryAta,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err).to.exist;
      }
    });

    it("fails when template is not active", async () => {
      // Deactivate the main template
      await kollect.methods
        .updateLicenseTemplate({
          newPrice: null,
          newGrantDuration: null,
          newIsActive: false,
        })
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
          licenseTemplate: activeTplPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const anotherGrantee = await createTestEntity("inactive_grantee");
      const grantPda = deriveLicenseGrantPda(
        activeLicensePda,
        anotherGrantee.entityPda,
        kollect.programId,
      );

      try {
        await kollect.methods
          .purchaseLicense()
          .accountsPartial({
            granteeEntity: anotherGrantee.entityPda,
            licenseTemplate: activeTplPda,
            license: activeLicensePda,
            licenseGrant: grantPda,
            payerTokenAccount: payerAta,
            platformTokenAccount: platformAta,
            ipTreasuryTokenAccount: ipTreasuryAta,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("LicenseTemplateNotActive");
      } finally {
        // Re-activate for subsequent tests
        await kollect.methods
          .updateLicenseTemplate({
            newPrice: null,
            newGrantDuration: null,
            newIsActive: true,
          })
          .accountsPartial({
            entity: entityPda,
            ipConfig: ipConfigPda,
            licenseTemplate: activeTplPda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
      }
    });

    it("fails when max_grants reached", async () => {
      // Create a new template with max_grants = 1
      const limitedName = templateName("limited_tpl");
      const limitedTplPda = deriveLicenseTemplatePda(
        ipPda,
        limitedName,
        kollect.programId,
      );
      const limitedLicensePda = deriveLicensePda(
        limitedTplPda,
        kollect.programId,
      );

      await kollect.methods
        .createLicenseTemplate(
          limitedName,
          new anchor.BN(0), // free
          1, // max_grants = 1
          new anchor.BN(0),
        )
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      // First purchase — should succeed
      const grantee1 = await createTestEntity("limit_grantee1");
      const grant1Pda = deriveLicenseGrantPda(
        limitedLicensePda,
        grantee1.entityPda,
        kollect.programId,
      );

      await kollect.methods
        .purchaseLicense()
        .accountsPartial({
          granteeEntity: grantee1.entityPda,
          licenseTemplate: limitedTplPda,
          license: limitedLicensePda,
          licenseGrant: grant1Pda,
          payerTokenAccount: payerAta,
          platformTokenAccount: platformAta,
          ipTreasuryTokenAccount: ipTreasuryAta,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      // Second purchase — should fail
      const grantee2 = await createTestEntity("limit_grantee2");
      const grant2Pda = deriveLicenseGrantPda(
        limitedLicensePda,
        grantee2.entityPda,
        kollect.programId,
      );

      try {
        await kollect.methods
          .purchaseLicense()
          .accountsPartial({
            granteeEntity: grantee2.entityPda,
            licenseTemplate: limitedTplPda,
            license: limitedLicensePda,
            licenseGrant: grant2Pda,
            payerTokenAccount: payerAta,
            platformTokenAccount: platformAta,
            ipTreasuryTokenAccount: ipTreasuryAta,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("MaxGrantsReached");
      }
    });

    // ─── T9: Fee Split Verification ──────────────────────────────────────

    it("splits payment between platform and IP treasury correctly", async () => {
      const config = await kollect.account.platformConfig.fetch(
        derivePlatformConfigPda(kollect.programId),
      );
      const platformFeeBps = config.platformFeeBps;

      const tpl = await kollect.account.licenseTemplate.fetch(activeTplPda);
      const price = tpl.price.toNumber();

      const expectedPlatformFee = Math.floor((price * platformFeeBps) / 10_000);
      const expectedNetToIp = price - expectedPlatformFee;

      // Capture balances before
      const platBefore = await provider.connection.getTokenAccountBalance(
        platformAta,
      );
      const ipBefore = await provider.connection.getTokenAccountBalance(
        ipTreasuryAta,
      );

      const feeSplitGrantee = await createTestEntity("fee_split_grantee");
      const feeSplitGrantPda = deriveLicenseGrantPda(
        activeLicensePda,
        feeSplitGrantee.entityPda,
        kollect.programId,
      );

      await kollect.methods
        .purchaseLicense()
        .accountsPartial({
          granteeEntity: feeSplitGrantee.entityPda,
          licenseTemplate: activeTplPda,
          license: activeLicensePda,
          licenseGrant: feeSplitGrantPda,
          payerTokenAccount: payerAta,
          platformTokenAccount: platformAta,
          ipTreasuryTokenAccount: ipTreasuryAta,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const platAfter = await provider.connection.getTokenAccountBalance(
        platformAta,
      );
      const ipAfter = await provider.connection.getTokenAccountBalance(
        ipTreasuryAta,
      );

      const platDelta =
        Number(platAfter.value.amount) - Number(platBefore.value.amount);
      const ipDelta =
        Number(ipAfter.value.amount) - Number(ipBefore.value.amount);

      expect(platDelta).to.equal(expectedPlatformFee, "Platform fee mismatch");
      expect(ipDelta).to.equal(expectedNetToIp, "IP treasury net mismatch");
    });

    // ─── T10: Free License (price=0) ─────────────────────────────────────

    it("purchases a free license with no token transfers", async () => {
      const freeName = templateName("free_tpl");
      const freeTplPda = deriveLicenseTemplatePda(
        ipPda,
        freeName,
        kollect.programId,
      );
      const freeLicensePda = deriveLicensePda(freeTplPda, kollect.programId);

      await kollect.methods
        .createLicenseTemplate(
          freeName,
          new anchor.BN(0), // free
          0, // unlimited
          new anchor.BN(0), // perpetual
        )
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const freeGrantee = await createTestEntity("free_grantee");
      const freeGrantPda = deriveLicenseGrantPda(
        freeLicensePda,
        freeGrantee.entityPda,
        kollect.programId,
      );

      // Capture balances
      const platBefore = await provider.connection.getTokenAccountBalance(
        platformAta,
      );
      const ipBefore = await provider.connection.getTokenAccountBalance(
        ipTreasuryAta,
      );

      await kollect.methods
        .purchaseLicense()
        .accountsPartial({
          granteeEntity: freeGrantee.entityPda,
          licenseTemplate: freeTplPda,
          license: freeLicensePda,
          licenseGrant: freeGrantPda,
          payerTokenAccount: payerAta,
          platformTokenAccount: platformAta,
          ipTreasuryTokenAccount: ipTreasuryAta,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      // Verify grant created
      const grant = await kollect.account.licenseGrant.fetch(freeGrantPda);
      expect(grant.license.toString()).to.equal(freeLicensePda.toString());

      // Verify template grants incremented
      const tpl = await kollect.account.licenseTemplate.fetch(freeTplPda);
      expect(tpl.currentGrants).to.equal(1);

      // Verify no token movement
      const platAfter = await provider.connection.getTokenAccountBalance(
        platformAta,
      );
      const ipAfter = await provider.connection.getTokenAccountBalance(
        ipTreasuryAta,
      );
      expect(Number(platAfter.value.amount)).to.equal(
        Number(platBefore.value.amount),
      );
      expect(Number(ipAfter.value.amount)).to.equal(
        Number(ipBefore.value.amount),
      );
    });

    // ─── T11: Grant Duration / Expiration ────────────────────────────────

    it("sets correct expiration with grant_duration", async () => {
      const expName = templateName("expiring_tpl");
      const expTplPda = deriveLicenseTemplatePda(
        ipPda,
        expName,
        kollect.programId,
      );
      const expLicensePda = deriveLicensePda(expTplPda, kollect.programId);

      const grantDuration = 3600; // 1 hour

      await kollect.methods
        .createLicenseTemplate(
          expName,
          new anchor.BN(0), // free
          0, // unlimited
          new anchor.BN(grantDuration),
        )
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const expGrantee = await createTestEntity("expiring_grantee");
      const expGrantPda = deriveLicenseGrantPda(
        expLicensePda,
        expGrantee.entityPda,
        kollect.programId,
      );

      await kollect.methods
        .purchaseLicense()
        .accountsPartial({
          granteeEntity: expGrantee.entityPda,
          licenseTemplate: expTplPda,
          license: expLicensePda,
          licenseGrant: expGrantPda,
          payerTokenAccount: payerAta,
          platformTokenAccount: platformAta,
          ipTreasuryTokenAccount: ipTreasuryAta,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const grant = await kollect.account.licenseGrant.fetch(expGrantPda);
      expect(grant.grantedAt.toNumber()).to.be.greaterThan(0);
      expect(grant.expiration.toNumber()).to.equal(
        grant.grantedAt.toNumber() + grantDuration,
      );
    });
  });
});
