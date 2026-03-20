import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../target/types/ip_core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  deriveEntityPda,
  deriveCounterPda,
  getEntityCount,
} from "../utils/helper";

describe("ip_core entity", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IpCore as Program<IpCore>;
  const creator = provider.wallet as anchor.Wallet;

  describe("create_entity", () => {
    it("creates an entity with auto-assigned index", async () => {
      const indexBefore = await getEntityCount(program, creator.publicKey);

      const [entityPda] = deriveEntityPda(
        program.programId,
        creator.publicKey,
        indexBefore,
      );

      await program.methods
        .createEntity()
        .accountsPartial({ entity: entityPda })
        .rpc();

      const entity = await program.account.entity.fetch(entityPda);
      expect(entity.creator.toString()).to.equal(creator.publicKey.toString());
      expect(entity.controller.toString()).to.equal(
        creator.publicKey.toString(),
      );
      expect(entity.index.toNumber()).to.equal(indexBefore);
      expect(entity.currentMetadataRevision.toNumber()).to.equal(0);

      // Verify counter incremented
      const indexAfter = await getEntityCount(program, creator.publicKey);
      expect(indexAfter).to.equal(indexBefore + 1);
    });
  });

  describe("transfer_entity_control", () => {
    let entityPda: PublicKey;

    before(async () => {
      const index = await getEntityCount(program, creator.publicKey);
      [entityPda] = deriveEntityPda(
        program.programId,
        creator.publicKey,
        index,
      );

      await program.methods
        .createEntity()
        .accountsPartial({ entity: entityPda })
        .rpc();
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
