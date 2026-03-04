import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../target/types/ip_core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";

describe("ip_core entity", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IpCore as Program<IpCore>;
  const creator = provider.wallet as anchor.Wallet;

  // Helper to pad handle to 32 bytes
  const padHandle = (handle: string): number[] => {
    const bytes = Buffer.from(handle);
    const padded = Buffer.alloc(32);
    bytes.copy(padded);
    return Array.from(padded);
  };

  describe("create_entity", () => {
    it("creates an entity with valid handle", async () => {
      const handle = padHandle("testentity");

      const [entityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(handle),
        ],
        program.programId,
      );

      await program.methods.createEntity(handle, [], 1).rpc();

      const entity = await program.account.entity.fetch(entityPda);
      expect(entity.creator.toString()).to.equal(creator.publicKey.toString());
      expect(entity.controllers.length).to.equal(1);
      expect(entity.controllers[0].toString()).to.equal(
        creator.publicKey.toString(),
      );
      expect(entity.signatureThreshold).to.equal(1);
      expect(entity.currentMetadataRevision.toNumber()).to.equal(0);
    });

    it("creates an entity with multiple controllers", async () => {
      const handle = padHandle("multisigentity");
      const controller2 = Keypair.generate();
      const controller3 = Keypair.generate();

      const [entityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(handle),
        ],
        program.programId,
      );

      await program.methods
        .createEntity(handle, [controller2.publicKey, controller3.publicKey], 2)
        .rpc();

      const entity = await program.account.entity.fetch(entityPda);
      expect(entity.controllers.length).to.equal(3);
      expect(entity.signatureThreshold).to.equal(2);
    });

    it("fails with invalid handle (uppercase)", async () => {
      const handle = padHandle("InvalidHandle");

      const [entityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(handle),
        ],
        program.programId,
      );

      try {
        await program.methods.createEntity(handle, [], 1).rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidHandle");
      }
    });

    it("fails with invalid threshold", async () => {
      const handle = padHandle("badthreshold");

      const [entityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(handle),
        ],
        program.programId,
      );

      try {
        await program.methods
          .createEntity(handle, [], 5) // threshold > controllers
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidThreshold");
      }
    });

    it("fails with too many controllers", async () => {
      const handle = padHandle("toomany");

      const [entityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(handle),
        ],
        program.programId,
      );

      // Create 5 additional controllers (6 total with creator)
      const extraControllers = Array.from(
        { length: 5 },
        () => Keypair.generate().publicKey,
      );

      try {
        await program.methods.createEntity(handle, extraControllers, 1).rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("ControllerLimitExceeded");
      }
    });
  });

  describe("update_entity_controllers", () => {
    let entityPda: PublicKey;
    const handle = padHandle("updateentity");

    before(async () => {
      [entityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(handle),
        ],
        program.programId,
      );

      await program.methods.createEntity(handle, [], 1).rpc();
    });

    it("adds a controller", async () => {
      const newController = Keypair.generate();

      await program.methods
        .updateEntityControllers({ add: {} }, newController.publicKey, null)
        .accounts({
          entity: entityPda,
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      const entity = await program.account.entity.fetch(entityPda);
      expect(entity.controllers.length).to.equal(2);
      expect(
        entity.controllers.some(
          (c) => c.toString() === newController.publicKey.toString(),
        ),
      ).to.be.true;
    });

    it("fails to remove last controller", async () => {
      // First remove the extra controller we added in previous test
      const entity = await program.account.entity.fetch(entityPda);
      const extraController = entity.controllers.find(
        (c) => c.toString() !== creator.publicKey.toString(),
      );

      if (extraController) {
        await program.methods
          .updateEntityControllers({ remove: {} }, extraController, null)
          .accounts({
            entity: entityPda,
          })
          .remainingAccounts([
            { pubkey: creator.publicKey, isSigner: true, isWritable: false },
          ])
          .rpc();
      }

      // Now try to remove the last (and only) controller
      try {
        await program.methods
          .updateEntityControllers({ remove: {} }, creator.publicKey, null)
          .accounts({
            entity: entityPda,
          })
          .remainingAccounts([
            { pubkey: creator.publicKey, isSigner: true, isWritable: false },
          ])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("CannotRemoveLastController");
      }
    });

    it("successfully removes creator when other controllers exist", async () => {
      // Add a new controller first
      const newController = Keypair.generate();

      await program.methods
        .updateEntityControllers({ add: {} }, newController.publicKey, null)
        .accounts({
          entity: entityPda,
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      // Now remove the creator (should succeed since there's another controller)
      await program.methods
        .updateEntityControllers({ remove: {} }, creator.publicKey, null)
        .accounts({
          entity: entityPda,
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      const entity = await program.account.entity.fetch(entityPda);
      expect(entity.controllers.length).to.equal(1);
      expect(
        entity.controllers.some(
          (c) => c.toString() === newController.publicKey.toString(),
        ),
      ).to.be.true;
      expect(
        entity.controllers.some(
          (c) => c.toString() === creator.publicKey.toString(),
        ),
      ).to.be.false;
    });
  });
});
