import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../target/types/ip_core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import * as crypto from "crypto";
import entitySchemaJson from "../utils/metadata-schema/entity.metadata.v1.json";
import ipSchemaJson from "../utils/metadata-schema/ip.metadata.v1.json";
import { padBytes } from "../utils/helper";

describe("ip_core metadata", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.IpCore as Program<IpCore>;
  const creator = provider.wallet as anchor.Wallet;

  const randomHash = (): number[] =>
    Array.from(Keypair.generate().publicKey.toBytes());

  // Hash schema JSON using SHA-256
  const hashSchema = (schema: object): number[] => {
    const json = JSON.stringify(schema);
    const hash = crypto.createHash("sha256").update(json).digest();
    return Array.from(hash);
  };

  describe("create_metadata_schema", () => {
    it("creates a metadata schema", async () => {
      const schemaId = padBytes(entitySchemaJson.schema.schema_id, 32);
      const version = padBytes(entitySchemaJson.schema.version, 16);
      const hash = hashSchema(entitySchemaJson.schema);
      const cid = padBytes(entitySchemaJson.cid, 96);

      const [schemaPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata_schema"),
          Buffer.from(schemaId),
          Buffer.from(version),
        ],
        program.programId,
      );

      await program.methods
        .createMetadataSchema(schemaId, version, hash, cid)
        .rpc();

      const schema = await program.account.metadataSchema.fetch(schemaPda);
      expect(schema.creator.toString()).to.equal(creator.publicKey.toString());
      expect(schema.createdAt.toNumber()).to.be.greaterThan(0);
    });

    it("fails with empty CID", async () => {
      const schemaId = padBytes("empty-cid-schema", 32);
      const version = padBytes("1.0.0", 16);
      const hash = randomHash();
      const cid = Array(96).fill(0); // Empty CID

      const [schemaPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata_schema"),
          Buffer.from(schemaId),
          Buffer.from(version),
        ],
        program.programId,
      );

      try {
        await program.methods
          .createMetadataSchema(schemaId, version, hash, cid)
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("EmptyCid");
      }
    });
  });

  describe("create_entity_metadata", () => {
    let entityPda: PublicKey;
    let schemaPda: PublicKey;
    const handle = padBytes("metadata_entity", 32);

    before(async () => {
      // Create entity
      [entityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(handle),
        ],
        program.programId,
      );

      await program.methods.createEntity(handle, [], 1).rpc();

      // Create schema using IP metadata schema
      const schemaId = padBytes(ipSchemaJson.schema.schema_id, 32);
      const version = padBytes(ipSchemaJson.schema.version, 16);
      const hash = hashSchema(ipSchemaJson.schema);
      const cid = padBytes(ipSchemaJson.cid, 96);

      [schemaPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata_schema"),
          Buffer.from(schemaId),
          Buffer.from(version),
        ],
        program.programId,
      );

      await program.methods
        .createMetadataSchema(schemaId, version, hash, cid)
        .rpc();
    });

    it("creates entity metadata", async () => {
      const revision = new anchor.BN(1);
      const hash = randomHash();
      const cid = padBytes("QmEntityMetadata1", 96);

      const revisionBytes = revision.toArrayLike(Buffer, "le", 8);
      const [metadataPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          Buffer.from("entity"),
          entityPda.toBuffer(),
          revisionBytes,
        ],
        program.programId,
      );

      await program.methods
        .createEntityMetadata(revision, hash, cid)
        .accounts({
          entity: entityPda,
          schema: schemaPda,
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: true, isWritable: false },
        ])
        .rpc();

      const metadata = await program.account.metadataAccount.fetch(metadataPda);
      expect(metadata.revision.toNumber()).to.equal(1);
      expect(metadata.parent.toString()).to.equal(entityPda.toString());
    });

    it("fails with invalid revision", async () => {
      const revision = new anchor.BN(5); // Should be 2, not 5
      const hash = randomHash();
      const cid = padBytes("QmInvalidRevision", 96);

      const revisionBytes = revision.toArrayLike(Buffer, "le", 8);
      const [metadataPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          Buffer.from("entity"),
          entityPda.toBuffer(),
          revisionBytes,
        ],
        program.programId,
      );

      try {
        await program.methods
          .createEntityMetadata(revision, hash, cid)
          .accounts({
            entity: entityPda,
            schema: schemaPda,
          })
          .remainingAccounts([
            { pubkey: creator.publicKey, isSigner: true, isWritable: false },
          ])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidMetadataRevision");
      }
    });
  });
});
