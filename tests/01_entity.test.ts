import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../target/types/ip_core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import { padBytes } from "../utils/helper";

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

      await program.methods.createEntity(handle).rpc();

      const entity = await program.account.entity.fetch(entityPda);
      expect(entity.creator.toString()).to.equal(creator.publicKey.toString());
      expect(entity.controller.toString()).to.equal(
        creator.publicKey.toString(),
      );
      expect(entity.currentMetadataRevision.toNumber()).to.equal(0);
    });

    it("fails with invalid handle (uppercase)", async () => {
      const handle = padBytes("@InvalidHandle", 32);

      try {
        await program.methods.createEntity(handle).rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidHandle");
      }
    });
  });

  describe("transfer_entity_control", () => {
    let entityPda: PublicKey;
    const handle = padBytes("transfer_ctrl", 32);

    before(async () => {
      [entityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(handle),
        ],
        program.programId,
      );

      await program.methods.createEntity(handle).rpc();
    });

    it("transfers control to a new controller", async () => {
      const newController = Keypair.generate();

      await program.methods
        .transferEntityControl(newController.publicKey)
        .accounts({
          entity: entityPda,
          controller: creator.publicKey,
        })
        .rpc();

      const entity = await program.account.entity.fetch(entityPda);
      expect(entity.controller.toString()).to.equal(
        newController.publicKey.toString(),
      );
    });

    it("fails when non-controller tries to transfer", async () => {
      const fakeController = Keypair.generate();

      try {
        await program.methods
          .transferEntityControl(fakeController.publicKey)
          .accounts({
            entity: entityPda,
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
