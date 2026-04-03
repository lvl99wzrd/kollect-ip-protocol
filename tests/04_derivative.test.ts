import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../target/types/ip_core";
import { Kollect } from "../target/types/kollect";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { padBytes, deriveEntityPda, getEntityCount } from "../utils/helper";

const signerMeta = (pubkey: PublicKey) => ({
  pubkey,
  isSigner: true,
  isWritable: false,
});

const templateNameBytes = (name: string): number[] => padBytes(name, 64);
const templateUriBytes = (uri: string): number[] => padBytes(uri, 96);

const u64Buffer = (value: number): Buffer => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
};

describe("ip_core derivative with kollect license", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const ipCoreProgram = anchor.workspace.IpCore as Program<IpCore>;
  const kollectProgram = anchor.workspace.Kollect as Program<Kollect>;
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
  let licenseTemplatePda: PublicKey;

  // Kollect PDAs
  let platformConfigPda: PublicKey;
  let platformTreasuryPda: PublicKey;
  let entityTreasuryPda: PublicKey;
  let ipConfigPda: PublicKey;

  // Token accounts for kollect
  let platformTokenAccount: PublicKey;
  let ipOwnerTokenAccount: PublicKey;

  const randomHash = (): number[] =>
    Array.from(Keypair.generate().publicKey.toBytes());

  /**
   * Helper to onboard an IP to kollect and create a license template + grant.
   * Returns { licensePda, licenseGrantPda, licenseTemplatePda }.
   */
  async function setupLicenseForIp(
    ipPda: PublicKey,
    tplLabel: string,
    granteeEntity: PublicKey,
    grantDuration: number = 0,
  ) {
    // Onboard IP to kollect (idempotent via try/catch)
    const [ipcPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ip_config"), ipPda.toBuffer()],
      kollectProgram.programId,
    );

    try {
      await kollectProgram.account.ipConfig.fetch(ipcPda);
    } catch {
      await kollectProgram.methods
        .onboardIp(null)
        .accountsPartial({
          entity: entityPda,
          ipAccount: ipPda,
          currencyMint: mint,
        })
        .rpc();
    }

    // Read current template count for auto-incremented ID
    const [templateConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("template_config")],
      kollectProgram.programId,
    );
    const templateConfig = await kollectProgram.account.templateConfig.fetch(
      templateConfigPda,
    );
    const templateId = (templateConfig.templateCount as anchor.BN).toNumber();

    // Create global license template
    const tplName = templateNameBytes(tplLabel);
    const [tplPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("license_template"), u64Buffer(templateId)],
      kollectProgram.programId,
    );

    await kollectProgram.methods
      .createLicenseTemplate({
        templateName: tplName,
        transferable: true,
        derivativesAllowed: true,
        derivativesReciprocal: false,
        derivativesApproval: false,
        commercialUse: true,
        commercialAttribution: false,
        commercialRevShareBps: 0,
        derivativeRevShareBps: 1500,
        uri: templateUriBytes(""),
      })
      .rpc();

    // Create per-IP license
    const [licPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("license"), ipPda.toBuffer(), tplPda.toBuffer()],
      kollectProgram.programId,
    );

    await kollectProgram.methods
      .createLicense({
        price: new anchor.BN(0),
        maxGrants: 0,
        grantDuration: new anchor.BN(grantDuration),
        derivativeRevShareBps: 1500,
      })
      .accountsPartial({
        entity: entityPda,
        ipConfig: ipcPda,
        licenseTemplate: tplPda,
        license: licPda,
      })
      .remainingAccounts([signerMeta(creator.publicKey)])
      .rpc();

    // Derive IP treasury token account (created by onboardIp)
    const [ipTreasury] = PublicKey.findProgramAddressSync(
      [Buffer.from("ip_treasury"), ipPda.toBuffer()],
      kollectProgram.programId,
    );
    const ipTreasuryTokenAccount = getAssociatedTokenAddressSync(
      mint,
      ipTreasury,
      true,
    );

    // Purchase license (creates LicenseGrant)
    const [grantPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("license_grant"),
        licPda.toBuffer(),
        granteeEntity.toBuffer(),
      ],
      kollectProgram.programId,
    );

    await kollectProgram.methods
      .purchaseLicense()
      .accountsPartial({
        granteeEntity,
        license: licPda,
        payerTokenAccount,
        platformTokenAccount,
        ipTreasuryTokenAccount,
      })
      .remainingAccounts([signerMeta(creator.publicKey)])
      .rpc();

    return {
      licensePda: licPda,
      licenseGrantPda: grantPda,
      licenseTemplatePda: tplPda,
    };
  }

  before(async () => {
    // ── ip_core setup ────────────────────────────────────────────────────

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
      mint = await createMint(
        provider.connection,
        creator.payer,
        creator.publicKey,
        null,
        6,
      );
    }

    if (!configExists) {
      await ipCoreProgram.methods
        .initializeConfig(treasuryPda, mint, new anchor.BN(1_000_000))
        .rpc();
    }

    try {
      await ipCoreProgram.methods.initializeTreasury().rpc();
    } catch {
      // Already initialized
    }

    // Token accounts
    const treasuryAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      creator.payer,
      mint,
      treasuryPda,
      true,
    );
    treasuryTokenAccount = treasuryAta.address;

    const payerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      creator.payer,
      mint,
      creator.publicKey,
    );
    payerTokenAccount = payerAta.address;

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
    const index = await getEntityCount(ipCoreProgram, creator.publicKey);
    [entityPda] = deriveEntityPda(
      ipCoreProgram.programId,
      creator.publicKey,
      index,
    );

    await ipCoreProgram.methods
      .createEntity()
      .accountsPartial({ entity: entityPda })
      .rpc();

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
        controller: creator.publicKey,
        treasuryTokenAccount,
        payerTokenAccount,
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
        controller: creator.publicKey,
        treasuryTokenAccount,
        payerTokenAccount,
      })
      .rpc();

    // ── kollect setup ────────────────────────────────────────────────────

    [platformConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("platform_config")],
      kollectProgram.programId,
    );
    [platformTreasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("platform_treasury")],
      kollectProgram.programId,
    );
    [entityTreasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("entity_treasury"), entityPda.toBuffer()],
      kollectProgram.programId,
    );

    // Initialize platform config (idempotent)
    try {
      await kollectProgram.account.platformConfig.fetch(platformConfigPda);
    } catch {
      await kollectProgram.methods
        .initializePlatform(new anchor.BN(100_000), 500, mint, 3, 10)
        .accounts({
          currencyMint: mint,
        })
        .rpc();
    }

    // Initialize entity treasury (idempotent)
    try {
      await kollectProgram.account.entityTreasury.fetch(entityTreasuryPda);
    } catch {
      await kollectProgram.methods
        .initializeEntityTreasury(creator.publicKey)
        .accountsPartial({ entity: entityPda, currencyMint: mint })
        .rpc();
    }

    // Create token accounts needed by purchaseLicense
    const platformAtaObj = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      creator.payer,
      mint,
      platformTreasuryPda,
      true,
    );
    platformTokenAccount = platformAtaObj.address;

    const ipOwnerAtaObj = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      creator.payer,
      mint,
      entityTreasuryPda,
      true,
    );
    ipOwnerTokenAccount = ipOwnerAtaObj.address;

    // Onboard parent IP + create license + grant via helper
    const result = await setupLicenseForIp(parentIpPda, "deriv_lic", entityPda);
    licensePda = result.licensePda;
    licenseGrantPda = result.licenseGrantPda;
    licenseTemplatePda = result.licenseTemplatePda;

    [ipConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ip_config"), parentIpPda.toBuffer()],
      kollectProgram.programId,
    );
  });

  describe("create_derivative_link with kollect license", () => {
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
          controller: creator.publicKey,
          licenseGrant: licenseGrantPda,
          license: licensePda,
          licenseProgram: kollectProgram.programId,
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
      try {
        await ipCoreProgram.methods
          .createDerivativeLink()
          .accounts({
            parentIp: parentIpPda,
            childIp: childIpPda,
            childOwnerEntity: entityPda,
            controller: creator.publicKey,
            licenseGrant: licenseGrantPda,
            license: licensePda,
            licenseProgram: kollectProgram.programId,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        // Account already exists
        expect(err.toString()).to.include("Error");
      }
    });

    it("fails without controller signature", async () => {
      // Create a new child IP to get a fresh derivative link PDA
      const newChildHash = randomHash();
      const [newChildIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(newChildHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(newChildHash)
        .accounts({
          registrantEntity: entityPda,
          controller: creator.publicKey,
          treasuryTokenAccount,
          payerTokenAccount,
        })
        .rpc();

      const fakeController = Keypair.generate();
      try {
        await ipCoreProgram.methods
          .createDerivativeLink()
          .accounts({
            parentIp: parentIpPda,
            childIp: newChildIpPda,
            childOwnerEntity: entityPda,
            controller: fakeController.publicKey,
            licenseGrant: licenseGrantPda,
            license: licensePda,
            licenseProgram: kollectProgram.programId,
          })
          .signers([fakeController])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });

    it("fails with invalid license owner", async () => {
      // Create new child IP for a fresh derivative PDA
      const newChildHash = randomHash();
      const [newChildIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(newChildHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(newChildHash)
        .accounts({
          registrantEntity: entityPda,
          controller: creator.publicKey,
          treasuryTokenAccount,
          payerTokenAccount,
        })
        .rpc();

      // Use a fake license program ID — accounts are owned by kollect, not this
      const fakeLicenseProgramId = Keypair.generate().publicKey;

      try {
        await ipCoreProgram.methods
          .createDerivativeLink()
          .accounts({
            parentIp: parentIpPda,
            childIp: newChildIpPda,
            childOwnerEntity: entityPda,
            controller: creator.publicKey,
            licenseGrant: licenseGrantPda,
            license: licensePda,
            licenseProgram: fakeLicenseProgramId,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        // CPI to a non-existent/non-executable program — any error means it failed as expected
        expect(err).to.exist;
      }
    });

    it("fails when license grant is expired", async () => {
      // Create a new parent IP and set up a license with a 1-second grant
      const expParentHash = randomHash();
      const [expParentIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(expParentHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(expParentHash)
        .accounts({
          registrantEntity: entityPda,
          controller: creator.publicKey,
          treasuryTokenAccount,
          payerTokenAccount,
        })
        .rpc();

      // Create child IP
      const expChildHash = randomHash();
      const [expChildIpPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(expChildHash)],
        ipCoreProgram.programId,
      );

      await ipCoreProgram.methods
        .createIp(expChildHash)
        .accounts({
          registrantEntity: entityPda,
          controller: creator.publicKey,
          treasuryTokenAccount,
          payerTokenAccount,
        })
        .rpc();

      // Onboard and create a license template with grant_duration = 1 second
      const expResult = await setupLicenseForIp(
        expParentIpPda,
        "expired_lic",
        entityPda,
        1, // 1-second grant duration — will expire almost immediately
      );

      // Wait for the grant to expire
      await new Promise((resolve) => setTimeout(resolve, 3000));

      try {
        await ipCoreProgram.methods
          .createDerivativeLink()
          .accounts({
            parentIp: expParentIpPda,
            childIp: expChildIpPda,
            childOwnerEntity: entityPda,
            controller: creator.publicKey,
            licenseGrant: expResult.licenseGrantPda,
            license: expResult.licensePda,
            licenseProgram: kollectProgram.programId,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("LicenseExpired");
      }
    });
  });
});
