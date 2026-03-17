import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
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
  signerMeta,
} from "./setup";

describe("kollect ip onboarding", () => {
  const provider = getProvider();
  const { kollect, ipCore } = getPrograms();
  const authority = provider.wallet as anchor.Wallet;

  let entityPda: PublicKey;
  let entityTreasuryPda: PublicKey;
  let ipPda: PublicKey;
  let ipConfigPda: PublicKey;
  let ipTreasuryPda: PublicKey;

  before(async () => {
    await initializeIpCorePrerequisites();

    // Ensure platform is initialized
    const configPda = derivePlatformConfigPda(kollect.programId);
    await kollect.account.platformConfig.fetch(configPda);

    // Create entity and entity treasury
    const entity = await createTestEntity("ip_onboard_entity");
    entityPda = entity.entityPda;
    entityTreasuryPda = deriveEntityTreasuryPda(entityPda, kollect.programId);

    // Initialize entity treasury (idempotent)
    try {
      await kollect.account.entityTreasury.fetch(entityTreasuryPda);
    } catch {
      await kollect.methods
        .initializeEntityTreasury(authority.publicKey)
        .accounts({ entity: entityPda })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();
    }
  });

  describe("onboard_ip", () => {
    it("onboards an IP without price override", async () => {
      const ip = await createTestIp(entityPda);
      ipPda = ip.ipPda;
      ipConfigPda = deriveIpConfigPda(ipPda, kollect.programId);
      ipTreasuryPda = deriveIpTreasuryPda(ipPda, kollect.programId);

      await kollect.methods
        .onboardIp(null, false)
        .accounts({
          entity: entityPda,
          ipAccount: ipPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const ipConfig = await kollect.account.ipConfig.fetch(ipConfigPda);
      expect(ipConfig.ipAccount.toString()).to.equal(ipPda.toString());
      expect(ipConfig.ownerEntity.toString()).to.equal(entityPda.toString());
      expect(ipConfig.pricePerPlayOverride).to.be.null;
      expect(ipConfig.isActive).to.be.true;
      expect(ipConfig.onboardedAt.toNumber()).to.be.greaterThan(0);

      const ipTreasury = await kollect.account.ipTreasury.fetch(ipTreasuryPda);
      expect(ipTreasury.ipAccount.toString()).to.equal(ipPda.toString());
      expect(ipTreasury.ipConfig.toString()).to.equal(ipConfigPda.toString());
      expect(ipTreasury.entityTreasury.toString()).to.equal(
        entityTreasuryPda.toString(),
      );
      expect(ipTreasury.totalEarned.toNumber()).to.equal(0);
      expect(ipTreasury.totalSettled.toNumber()).to.equal(0);
    });

    it("onboards an IP with price override", async () => {
      const ip = await createTestIp(entityPda);
      const configPda = deriveIpConfigPda(ip.ipPda, kollect.programId);

      await kollect.methods
        .onboardIp(new anchor.BN(500_000), false)
        .accounts({
          entity: entityPda,
          ipAccount: ip.ipPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const ipConfig = await kollect.account.ipConfig.fetch(configPda);
      expect(ipConfig.pricePerPlayOverride.toNumber()).to.equal(500_000);
    });

    it("fails if IP already onboarded (PDA collision)", async () => {
      try {
        await kollect.methods
          .onboardIp(null, false)
          .accounts({
            entity: entityPda,
            ipAccount: ipPda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err).to.exist;
      }
    });

    it("fails with entity that does not own the IP", async () => {
      // Create a different entity
      const otherEntity = await createTestEntity("other_ip_owner");
      const otherEntityTreasuryPda = deriveEntityTreasuryPda(
        otherEntity.entityPda,
        kollect.programId,
      );

      // Initialize the other entity's treasury
      try {
        await kollect.account.entityTreasury.fetch(otherEntityTreasuryPda);
      } catch {
        await kollect.methods
          .initializeEntityTreasury(authority.publicKey)
          .accounts({ entity: otherEntity.entityPda })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
      }

      // Create an IP owned by the original entity
      const ip = await createTestIp(entityPda);

      try {
        // Try to onboard it with the wrong entity
        await kollect.methods
          .onboardIp(null, false)
          .accounts({
            entity: otherEntity.entityPda,
            ipAccount: ip.ipPda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("IpOwnerMismatch");
      }
    });

    it("fails without entity treasury initialized", async () => {
      // Create entity without treasury
      const noTreasuryEntity = await createTestEntity("no_treasury_ent");
      const ip = await createTestIp(noTreasuryEntity.entityPda);

      try {
        await kollect.methods
          .onboardIp(null, false)
          .accounts({
            entity: noTreasuryEntity.entityPda,
            ipAccount: ip.ipPda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        // EntityTreasury PDA doesn't exist, Anchor will fail on account resolution
        expect(err).to.exist;
      }
    });

    it("fails with insufficient multisig signatures", async () => {
      const controller2 = Keypair.generate();
      const multisigEntity = await createTestEntity(
        "multi_ip_onboard",
        [controller2.publicKey],
        2,
      );
      const multisigTreasuryPda = deriveEntityTreasuryPda(
        multisigEntity.entityPda,
        kollect.programId,
      );

      // Fund controller2 for signing
      const sig = await provider.connection.requestAirdrop(
        controller2.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(sig);

      // Init entity treasury with both signers
      try {
        await kollect.account.entityTreasury.fetch(multisigTreasuryPda);
      } catch {
        await kollect.methods
          .initializeEntityTreasury(authority.publicKey)
          .accounts({ entity: multisigEntity.entityPda })
          .remainingAccounts([
            signerMeta(authority.publicKey),
            signerMeta(controller2.publicKey),
          ])
          .signers([controller2])
          .rpc();
      }

      const ip = await createTestIp(multisigEntity.entityPda, [controller2]);

      try {
        // Only 1 signer for threshold=2
        await kollect.methods
          .onboardIp(null, false)
          .accounts({
            entity: multisigEntity.entityPda,
            ipAccount: ip.ipPda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InsufficientSignatures");
      }
    });
  });

  describe("update_ip_config", () => {
    it("updates price_per_play_override to a new value", async () => {
      await kollect.methods
        .updateIpConfig(new anchor.BN(750_000))
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const config = await kollect.account.ipConfig.fetch(ipConfigPda);
      expect(config.pricePerPlayOverride.toNumber()).to.equal(750_000);
    });

    it("preserves price_per_play_override when null (no-op)", async () => {
      // Option<Option<u64>>: outer None means "don't update"
      // Anchor TS cannot express Some(None) for nested Option, so null = no-op
      const before = await kollect.account.ipConfig.fetch(ipConfigPda);

      await kollect.methods
        .updateIpConfig(null)
        .accountsPartial({
          entity: entityPda,
          ipConfig: ipConfigPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const after = await kollect.account.ipConfig.fetch(ipConfigPda);
      expect(after.pricePerPlayOverride.toNumber()).to.equal(
        before.pricePerPlayOverride.toNumber(),
      );
    });

    it("fails with non-owner entity", async () => {
      const otherEntity = await createTestEntity("wrong_ip_updater");

      try {
        await kollect.methods
          .updateIpConfig(new anchor.BN(999))
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
  });

  describe("deactivate_ip", () => {
    let deactIpPda: PublicKey;
    let deactIpConfigPda: PublicKey;

    before(async () => {
      const ip = await createTestIp(entityPda);
      deactIpPda = ip.ipPda;
      deactIpConfigPda = deriveIpConfigPda(deactIpPda, kollect.programId);

      await kollect.methods
        .onboardIp(null, false)
        .accounts({
          entity: entityPda,
          ipAccount: deactIpPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();
    });

    it("deactivates an IP", async () => {
      const before = await kollect.account.ipConfig.fetch(deactIpConfigPda);
      expect(before.isActive).to.be.true;

      await kollect.methods
        .deactivateIp()
        .accountsPartial({
          entity: entityPda,
          ipConfig: deactIpConfigPda,
        })
        .remainingAccounts([signerMeta(authority.publicKey)])
        .rpc();

      const after = await kollect.account.ipConfig.fetch(deactIpConfigPda);
      expect(after.isActive).to.be.false;
    });

    it("fails if already deactivated", async () => {
      try {
        await kollect.methods
          .deactivateIp()
          .accountsPartial({
            entity: entityPda,
            ipConfig: deactIpConfigPda,
          })
          .remainingAccounts([signerMeta(authority.publicKey)])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("IpNotActive");
      }
    });
  });
});
