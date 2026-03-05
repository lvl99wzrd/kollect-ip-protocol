import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../target/types/ip_core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { padBytes } from "./utils/helper";

describe("ip_core entity", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IpCore as Program<IpCore>;
  const creator = provider.wallet as anchor.Wallet;

  describe("create_entity", () => {
    it("creates an entity with valid handle", async () => {
      const handle = padBytes("testentity", 32);

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
      const handle = padBytes("multisig_entity", 32);
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
      const handle = padBytes("@InvalidHandle", 32);

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
      const handle = padBytes("bad_threshold", 32);

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
      const handle = padBytes("too_many", 32);

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
    const handle = padBytes("update_entity", 32);

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

    it("replaces controller list with additional controller", async () => {
      const newController = Keypair.generate();

      // Replace with both creator and new controller
      await program.methods
        .updateEntityControllers(
          [creator.publicKey, newController.publicKey],
          1,
        )
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
      expect(
        entity.controllers.some(
          (c) => c.toString() === creator.publicKey.toString(),
        ),
      ).to.be.true;
    });

    it("fails with empty controller list", async () => {
      try {
        await program.methods
          .updateEntityControllers([], 1)
          .accounts({
            entity: entityPda,
          })
          .remainingAccounts([
            { pubkey: creator.publicKey, isSigner: true, isWritable: false },
          ])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("EmptyControllerList");
      }
    });

    it("fails with duplicate controllers", async () => {
      try {
        await program.methods
          .updateEntityControllers([creator.publicKey, creator.publicKey], 1)
          .accounts({
            entity: entityPda,
          })
          .remainingAccounts([
            { pubkey: creator.publicKey, isSigner: true, isWritable: false },
          ])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("DuplicateController");
      }
    });

    it("successfully replaces controllers removing creator", async () => {
      const newController = Keypair.generate();

      // Replace with only the new controller (removing creator)
      await program.methods
        .updateEntityControllers([newController.publicKey], 1)
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
