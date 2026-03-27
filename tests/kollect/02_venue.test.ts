import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  getProvider,
  getPrograms,
  derivePlatformConfigPda,
  deriveVenuePda,
  venueCid,
} from "./setup";

describe("kollect venue", () => {
  const provider = getProvider();
  const { kollect } = getPrograms();
  const authority = provider.wallet as anchor.Wallet;

  let configPda: PublicKey;
  let venueIdCounter = 100; // Start high to avoid collisions with other tests

  const nextVenueId = () => venueIdCounter++;

  before(async () => {
    configPda = derivePlatformConfigPda(kollect.programId);
    // Ensure platform is initialized
    await kollect.account.platformConfig.fetch(configPda);
  });

  describe("register_venue", () => {
    it("registers a venue with valid CID", async () => {
      const venueId = nextVenueId();
      const venueAuthority = Keypair.generate();
      const venuePda = deriveVenuePda(venueId, kollect.programId);
      const cid = venueCid("QmTestClubAlpha123");

      await kollect.methods
        .registerVenue(new anchor.BN(venueId), {
          venueAuthority: venueAuthority.publicKey,
          cid,
          multiplierBps: 10_000,
        })
        .rpc();

      const venue = await kollect.account.venueAccount.fetch(venuePda);
      expect(venue.venueId.toNumber()).to.equal(venueId);
      expect(venue.authority.toString()).to.equal(
        venueAuthority.publicKey.toString(),
      );
      expect(Buffer.from(venue.cid).slice(0, 18).toString()).to.include(
        "QmTestClubAlpha123",
      );
      expect(venue.multiplierBps).to.equal(10_000);
      expect(venue.isActive).to.be.true;
      expect(venue.totalCommitments.toNumber()).to.equal(0);
    });

    it("fails with empty CID (all zeros)", async () => {
      const venueId = nextVenueId();

      try {
        await kollect.methods
          .registerVenue(new anchor.BN(venueId), {
            venueAuthority: authority.publicKey,
            cid: new Array(96).fill(0),
            multiplierBps: 10_000,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidCid");
      }
    });

    it("fails with multiplier_bps = 0", async () => {
      const venueId = nextVenueId();

      try {
        await kollect.methods
          .registerVenue(new anchor.BN(venueId), {
            venueAuthority: authority.publicKey,
            cid: venueCid("QmValidCid"),
            multiplierBps: 0,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidMultiplier");
      }
    });

    it("fails with non-platform authority", async () => {
      const fakeAuthority = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fakeAuthority.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(sig);

      const venueId = nextVenueId();

      try {
        await kollect.methods
          .registerVenue(new anchor.BN(venueId), {
            venueAuthority: authority.publicKey,
            cid: venueCid("QmUnauthorized"),
            multiplierBps: 5_000,
          })
          .accounts({ authority: fakeAuthority.publicKey })
          .signers([fakeAuthority])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAuthority");
      }
    });

    it("fails with duplicate venue_id (PDA collision)", async () => {
      const venueId = nextVenueId();

      await kollect.methods
        .registerVenue(new anchor.BN(venueId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmOriginal"),
          multiplierBps: 5_000,
        })
        .rpc();

      try {
        await kollect.methods
          .registerVenue(new anchor.BN(venueId), {
            venueAuthority: authority.publicKey,
            cid: venueCid("QmDuplicate"),
            multiplierBps: 5_000,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err).to.exist;
      }
    });
  });

  describe("update_venue", () => {
    let venueId: number;
    let venuePda: PublicKey;

    before(async () => {
      venueId = nextVenueId();
      venuePda = deriveVenuePda(venueId, kollect.programId);

      await kollect.methods
        .registerVenue(new anchor.BN(venueId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmUpdateableVenue"),
          multiplierBps: 5_000,
        })
        .rpc();
    });

    it("updates venue CID", async () => {
      const newCid = venueCid("QmNewVenueCid456");

      await kollect.methods
        .updateVenue({
          newAuthority: null,
          newCid,
        })
        .accountsPartial({ venue: venuePda })
        .rpc();

      const venue = await kollect.account.venueAccount.fetch(venuePda);
      expect(Buffer.from(venue.cid).slice(0, 16).toString()).to.include(
        "QmNewVenueCid456",
      );
    });

    it("no-op update (null params) preserves state", async () => {
      const before = await kollect.account.venueAccount.fetch(venuePda);

      await kollect.methods
        .updateVenue({ newAuthority: null, newCid: null })
        .accountsPartial({ venue: venuePda })
        .rpc();

      const after = await kollect.account.venueAccount.fetch(venuePda);
      expect(Buffer.from(after.cid)).to.deep.equal(Buffer.from(before.cid));
    });

    it("fails with wrong venue authority", async () => {
      const fakeAuth = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fakeAuth.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(sig);

      try {
        await kollect.methods
          .updateVenue({ newAuthority: null, newCid: null })
          .accountsPartial({
            authority: fakeAuth.publicKey,
            venue: venuePda,
          })
          .signers([fakeAuth])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAuthority");
      }
    });
  });

  describe("update_venue_multiplier", () => {
    let venueId: number;
    let venuePda: PublicKey;

    before(async () => {
      venueId = nextVenueId();
      venuePda = deriveVenuePda(venueId, kollect.programId);

      await kollect.methods
        .registerVenue(new anchor.BN(venueId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmMultiplierVenue"),
          multiplierBps: 5_000,
        })
        .rpc();
    });

    it("platform authority updates multiplier", async () => {
      const venueBefore = await kollect.account.venueAccount.fetch(venuePda);
      expect(venueBefore.multiplierBps).to.equal(5_000);

      await kollect.methods
        .updateVenueMultiplier(8_000)
        .accountsPartial({ venue: venuePda })
        .rpc();

      const venueAfter = await kollect.account.venueAccount.fetch(venuePda);
      expect(venueAfter.multiplierBps).to.equal(8_000);
    });

    it("fails with non-platform authority", async () => {
      const fakeAuth = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fakeAuth.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(sig);

      try {
        await kollect.methods
          .updateVenueMultiplier(9_000)
          .accountsPartial({
            authority: fakeAuth.publicKey,
            venue: venuePda,
          })
          .signers([fakeAuth])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAuthority");
      }
    });
  });

  describe("deactivate_venue", () => {
    let venueId: number;
    let venuePda: PublicKey;

    before(async () => {
      venueId = nextVenueId();
      venuePda = deriveVenuePda(venueId, kollect.programId);

      await kollect.methods
        .registerVenue(new anchor.BN(venueId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmDeacTarget"),
          multiplierBps: 5_000,
        })
        .rpc();
    });

    it("deactivates a venue", async () => {
      const before = await kollect.account.venueAccount.fetch(venuePda);
      expect(before.isActive).to.be.true;

      await kollect.methods
        .deactivateVenue()
        .accountsPartial({ venue: venuePda })
        .rpc();

      const after = await kollect.account.venueAccount.fetch(venuePda);
      expect(after.isActive).to.be.false;
    });

    it("fails if already deactivated", async () => {
      try {
        await kollect.methods
          .deactivateVenue()
          .accountsPartial({ venue: venuePda })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("VenueNotActive");
      }
    });
  });

  describe("reactivate_venue", () => {
    let venueId: number;
    let venuePda: PublicKey;

    before(async () => {
      venueId = nextVenueId();
      venuePda = deriveVenuePda(venueId, kollect.programId);

      await kollect.methods
        .registerVenue(new anchor.BN(venueId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmReactivateTarget"),
          multiplierBps: 5_000,
        })
        .rpc();

      await kollect.methods
        .deactivateVenue()
        .accountsPartial({ venue: venuePda })
        .rpc();
    });

    it("reactivates an inactive venue", async () => {
      const before = await kollect.account.venueAccount.fetch(venuePda);
      expect(before.isActive).to.be.false;

      await kollect.methods
        .reactivateVenue()
        .accountsPartial({ venue: venuePda })
        .rpc();

      const after = await kollect.account.venueAccount.fetch(venuePda);
      expect(after.isActive).to.be.true;
    });

    it("fails if venue is already active", async () => {
      try {
        await kollect.methods
          .reactivateVenue()
          .accountsPartial({ venue: venuePda })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("VenueAlreadyActive");
      }
    });

    it("fails with non-platform authority", async () => {
      const inactiveId = nextVenueId();
      const inactivePda = deriveVenuePda(inactiveId, kollect.programId);

      await kollect.methods
        .registerVenue(new anchor.BN(inactiveId), {
          venueAuthority: authority.publicKey,
          cid: venueCid("QmAuthTestReact"),
          multiplierBps: 5_000,
        })
        .rpc();

      await kollect.methods
        .deactivateVenue()
        .accountsPartial({ venue: inactivePda })
        .rpc();

      const fakeAuth = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fakeAuth.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(sig);

      try {
        await kollect.methods
          .reactivateVenue()
          .accountsPartial({
            authority: fakeAuth.publicKey,
            venue: inactivePda,
          })
          .signers([fakeAuth])
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidAuthority");
      }
    });
  });
});
