import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IpCore } from "../target/types/ip_core";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
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

      await program.methods.createEntity(handle).rpc();

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
      const hash = randomHash();
      const cid = padBytes("QmEntityMetadata1", 96);

      // Fetch current revision from chain and derive the next PDA
      const entityState = await program.account.entity.fetch(entityPda);
      const nextRevision = entityState.currentMetadataRevision.addn(1);
      const revisionBytes = nextRevision.toArrayLike(Buffer, "le", 8);

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
        .createEntityMetadata(hash, cid)
        .accounts({
          metadata: metadataPda,
          entity: entityPda,
          schema: schemaPda,
          controller: creator.publicKey,
        })
        .rpc();

      const metadata = await program.account.metadataAccount.fetch(metadataPda);
      expect(metadata.revision.toNumber()).to.equal(nextRevision.toNumber());
      expect(metadata.parent.toString()).to.equal(entityPda.toString());
    });
  });

  describe("create_ip_metadata", () => {
    let entityPda: PublicKey;
    let ipPda: PublicKey;
    let schemaPda: PublicKey;

    before(async () => {
      // --- token infrastructure (idempotent) ---
      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        program.programId,
      );
      const [treasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("treasury")],
        program.programId,
      );

      let mint: PublicKey;
      let configExists = false;
      try {
        const existingConfig = await program.account.protocolConfig.fetch(
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
        await program.methods
          .initializeConfig(treasuryPda, mint, new anchor.BN(1_000_000))
          .rpc();
      }

      let treasuryExists = false;
      try {
        await program.account.protocolTreasury.fetch(treasuryPda);
        treasuryExists = true;
      } catch {
        // not yet initialized
      }
      if (!treasuryExists) {
        await program.methods.initializeTreasury().rpc();
      }

      const treasuryAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        creator.payer,
        mint,
        treasuryPda,
        true,
      );

      const payerAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        creator.payer,
        mint,
        creator.publicKey,
      );

      const balance = await provider.connection.getTokenAccountBalance(
        payerAta.address,
      );
      if (balance.value.uiAmount === null || balance.value.uiAmount < 10) {
        await mintTo(
          provider.connection,
          creator.payer,
          mint,
          payerAta.address,
          creator.publicKey,
          100_000_000,
        );
      }

      // --- entity ---
      const handle = padBytes("ip_meta_entity", 32);
      [entityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(handle),
        ],
        program.programId,
      );

      try {
        await program.methods.createEntity(handle).rpc();
      } catch {
        // already exists
      }

      // --- IP ---
      const contentHash = Array.from(Keypair.generate().publicKey.toBytes());
      [ipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
        program.programId,
      );

      await program.methods
        .createIp(contentHash)
        .accounts({
          registrantEntity: entityPda,
          controller: creator.publicKey,
          treasuryTokenAccount: treasuryAta.address,
          payerTokenAccount: payerAta.address,
        })
        .rpc();

      // --- schema (reuse ipSchemaJson schema already on-chain) ---
      const schemaId = padBytes(ipSchemaJson.schema.schema_id, 32);
      const version = padBytes(ipSchemaJson.schema.version, 16);
      [schemaPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata_schema"),
          Buffer.from(schemaId),
          Buffer.from(version),
        ],
        program.programId,
      );
    });

    it("creates IP metadata", async () => {
      const hash = Array.from(Keypair.generate().publicKey.toBytes());
      const cid = padBytes("QmIpMetadata1", 96);

      const ipState = await program.account.ipAccount.fetch(ipPda);
      const nextRevision = ipState.currentMetadataRevision.addn(1);
      const revisionBytes = nextRevision.toArrayLike(Buffer, "le", 8);

      const [metadataPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          Buffer.from("ip"),
          ipPda.toBuffer(),
          revisionBytes,
        ],
        program.programId,
      );

      await program.methods
        .createIpMetadata(hash, cid)
        .accounts({
          metadata: metadataPda,
          ip: ipPda,
          ownerEntity: entityPda,
          schema: schemaPda,
          controller: creator.publicKey,
        })
        .rpc();

      const metadata = await program.account.metadataAccount.fetch(metadataPda);
      expect(metadata.revision.toNumber()).to.equal(nextRevision.toNumber());
      expect(metadata.parent.toString()).to.equal(ipPda.toString());
      expect(metadata.schema.toString()).to.equal(schemaPda.toString());
    });

    it("fails with empty CID", async () => {
      const hash = Array.from(Keypair.generate().publicKey.toBytes());
      const cid = Array(96).fill(0);

      const ipState = await program.account.ipAccount.fetch(ipPda);
      const nextRevision = ipState.currentMetadataRevision.addn(1);
      const revisionBytes = nextRevision.toArrayLike(Buffer, "le", 8);

      const [metadataPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          Buffer.from("ip"),
          ipPda.toBuffer(),
          revisionBytes,
        ],
        program.programId,
      );

      try {
        await program.methods
          .createIpMetadata(hash, cid)
          .accounts({
            metadata: metadataPda,
            ip: ipPda,
            ownerEntity: entityPda,
            schema: schemaPda,
            controller: creator.publicKey,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("EmptyCid");
      }
    });
  });

  describe("combined transaction: create + metadata in one tx", () => {
    let schemaPda: PublicKey;

    before(async () => {
      // Reuse ipSchemaJson schema already on-chain from earlier tests
      const schemaId = padBytes(ipSchemaJson.schema.schema_id, 32);
      const version = padBytes(ipSchemaJson.schema.version, 16);
      [schemaPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata_schema"),
          Buffer.from(schemaId),
          Buffer.from(version),
        ],
        program.programId,
      );
    });

    it("creates entity + entity metadata in one transaction", async () => {
      const handle = padBytes("combo_entity", 32);
      const metadataHash = randomHash();
      const metadataCid = padBytes("QmComboEntityMeta", 96);

      // Derive entity PDA
      const [entityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(handle),
        ],
        program.programId,
      );

      // Entity starts with current_metadata_revision = 0,
      // so first metadata revision = 1
      const revisionBytes = new anchor.BN(1).toArrayLike(Buffer, "le", 8);
      const [metadataPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          Buffer.from("entity"),
          entityPda.toBuffer(),
          revisionBytes,
        ],
        program.programId,
      );

      // Build both instructions
      const createEntityIx = await program.methods
        .createEntity(handle)
        .instruction();

      const createMetadataIx = await program.methods
        .createEntityMetadata(metadataHash, metadataCid)
        .accounts({
          metadata: metadataPda,
          entity: entityPda,
          schema: schemaPda,
          controller: creator.publicKey,
        })
        .instruction();

      // Send as a single transaction
      const tx = new Transaction().add(createEntityIx, createMetadataIx);
      await provider.sendAndConfirm(tx);

      // Verify entity was created
      const entity = await program.account.entity.fetch(entityPda);
      expect(entity.currentMetadataRevision.toNumber()).to.equal(1);

      // Verify metadata was created
      const metadata = await program.account.metadataAccount.fetch(metadataPda);
      expect(metadata.revision.toNumber()).to.equal(1);
      expect(metadata.parent.toString()).to.equal(entityPda.toString());
      expect(metadata.schema.toString()).to.equal(schemaPda.toString());
    });

    it("creates IP + IP metadata in one transaction", async () => {
      // --- token infrastructure (idempotent) ---
      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        program.programId,
      );
      const [treasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("treasury")],
        program.programId,
      );

      const existingConfig = await program.account.protocolConfig.fetch(
        configPda,
      );
      const mint = existingConfig.registrationCurrency;

      const treasuryAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        creator.payer,
        mint,
        treasuryPda,
        true,
      );

      const payerAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        creator.payer,
        mint,
        creator.publicKey,
      );

      // Ensure payer has funds
      const balance = await provider.connection.getTokenAccountBalance(
        payerAta.address,
      );
      if (balance.value.uiAmount === null || balance.value.uiAmount < 10) {
        await mintTo(
          provider.connection,
          creator.payer,
          mint,
          payerAta.address,
          creator.publicKey,
          100_000_000,
        );
      }

      // --- entity (reuse or create) ---
      const handle = padBytes("combo_ip_entity", 32);
      const [entityPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("entity"),
          creator.publicKey.toBuffer(),
          Buffer.from(handle),
        ],
        program.programId,
      );

      try {
        await program.methods.createEntity(handle).rpc();
      } catch {
        // already exists
      }

      // --- Build IP + IP metadata in 1 tx ---
      const contentHash = Array.from(Keypair.generate().publicKey.toBytes());
      const [ipPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ip"), entityPda.toBuffer(), Buffer.from(contentHash)],
        program.programId,
      );

      // IP starts with current_metadata_revision = 0,
      // so first metadata revision = 1
      const revisionBytes = new anchor.BN(1).toArrayLike(Buffer, "le", 8);
      const [metadataPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          Buffer.from("ip"),
          ipPda.toBuffer(),
          revisionBytes,
        ],
        program.programId,
      );

      const metadataHash = randomHash();
      const metadataCid = padBytes("QmComboIpMeta", 96);

      const createIpIx = await program.methods
        .createIp(contentHash)
        .accounts({
          registrantEntity: entityPda,
          controller: creator.publicKey,
          treasuryTokenAccount: treasuryAta.address,
          payerTokenAccount: payerAta.address,
        })
        .instruction();

      const createIpMetadataIx = await program.methods
        .createIpMetadata(metadataHash, metadataCid)
        .accounts({
          metadata: metadataPda,
          ip: ipPda,
          ownerEntity: entityPda,
          schema: schemaPda,
          controller: creator.publicKey,
        })
        .instruction();

      // Send as a single transaction
      const tx = new Transaction().add(createIpIx, createIpMetadataIx);
      await provider.sendAndConfirm(tx);

      // Verify IP was created
      const ip = await program.account.ipAccount.fetch(ipPda);
      expect(ip.currentMetadataRevision.toNumber()).to.equal(1);

      // Verify metadata was created
      const metadata = await program.account.metadataAccount.fetch(metadataPda);
      expect(metadata.revision.toNumber()).to.equal(1);
      expect(metadata.parent.toString()).to.equal(ipPda.toString());
      expect(metadata.schema.toString()).to.equal(schemaPda.toString());
    });
  });
});
