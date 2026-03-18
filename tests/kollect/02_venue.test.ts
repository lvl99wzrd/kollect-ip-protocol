import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect } from "chai";
import {
  getProvider,
  getPrograms,
  derivePlatformConfigPda,
  deriveVenuePda,
  venueName,
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
    it("registers a venue with valid params", async () => {
      const venueId = nextVenueId();
      const venueAuthority = Keypair.generate();
      const venuePda = deriveVenuePda(venueId, kollect.programId);
      const name = venueName("Test Club Alpha");

      await kollect.methods
        .registerVenue(new anchor.BN(venueId), {
          venueAuthority: venueAuthority.publicKey,
          name,
          venueType: 1,
          capacity: 500,
          operatingHours: 12,
          multiplierBps: 10_000,
        })
        .rpc();

      const venue = await kollect.account.venueAccount.fetch(venuePda);
      expect(venue.venueId.toNumber()).to.equal(venueId);
      expect(venue.authority.toString()).to.equal(
        venueAuthority.publicKey.toString(),
      );
      expect(venue.venueType).to.equal(1);
      expect(venue.capacity).to.equal(500);
      expect(venue.operatingHours).to.equal(12);
      expect(venue.multiplierBps).to.equal(10_000);
      expect(venue.isActive).to.be.true;
      expect(venue.totalCommitments.toNumber()).to.equal(0);
    });

    it("registers venues with all valid venue types (0-5)", async () => {
      for (let vt = 0; vt <= 5; vt++) {
        const venueId = nextVenueId();
        const venuePda = deriveVenuePda(venueId, kollect.programId);

        await kollect.methods
          .registerVenue(new anchor.BN(venueId), {
            venueAuthority: authority.publicKey,
            name: venueName(`Venue Type ${vt}`),
            venueType: vt,
            capacity: 100,
            operatingHours: 8,
            multiplierBps: 5_000,
          })
          .rpc();

        const venue = await kollect.account.venueAccount.fetch(venuePda);
        expect(venue.venueType).to.equal(vt);
      }
    });

    it("fails with invalid venue_type (> 5)", async () => {
      const venueId = nextVenueId();

      try {
        await kollect.methods
          .registerVenue(new anchor.BN(venueId), {
            venueAuthority: authority.publicKey,
            name: venueName("Bad Type"),
            venueType: 6,
            capacity: 100,
            operatingHours: 8,
            multiplierBps: 5_000,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidVenueType");
      }
    });

    it("fails with capacity = 0", async () => {
      const venueId = nextVenueId();

      try {
        await kollect.methods
          .registerVenue(new anchor.BN(venueId), {
            venueAuthority: authority.publicKey,
            name: venueName("Zero Cap"),
            venueType: 1,
            capacity: 0,
            operatingHours: 8,
            multiplierBps: 5_000,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidCapacity");
      }
    });

    it("fails with operating_hours = 0", async () => {
      const venueId = nextVenueId();

      try {
        await kollect.methods
          .registerVenue(new anchor.BN(venueId), {
            venueAuthority: authority.publicKey,
            name: venueName("Zero Hours"),
            venueType: 1,
            capacity: 100,
            operatingHours: 0,
            multiplierBps: 5_000,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidOperatingHours");
      }
    });

    it("fails with operating_hours > 24", async () => {
      const venueId = nextVenueId();

      try {
        await kollect.methods
          .registerVenue(new anchor.BN(venueId), {
            venueAuthority: authority.publicKey,
            name: venueName("Too Many Hours"),
            venueType: 1,
            capacity: 100,
            operatingHours: 25,
            multiplierBps: 5_000,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("InvalidOperatingHours");
      }
    });

    it("fails with multiplier_bps = 0", async () => {
      const venueId = nextVenueId();

      try {
        await kollect.methods
          .registerVenue(new anchor.BN(venueId), {
            venueAuthority: authority.publicKey,
            name: venueName("Zero Mult"),
            venueType: 1,
            capacity: 100,
            operatingHours: 8,
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
            name: venueName("Unauthorized"),
            venueType: 1,
            capacity: 100,
            operatingHours: 8,
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
          name: venueName("Original"),
          venueType: 1,
          capacity: 100,
          operatingHours: 8,
          multiplierBps: 5_000,
        })
        .rpc();

      try {
        await kollect.methods
          .registerVenue(
            new anchor.BN(venueId), // same ID
            {
              venueAuthority: authority.publicKey,
              name: venueName("Duplicate"),
              venueType: 1,
              capacity: 100,
              operatingHours: 8,
              multiplierBps: 5_000,
            },
          )
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
    let venueAuth: Keypair;

    before(async () => {
      venueId = nextVenueId();
      venueAuth = Keypair.generate();
      venuePda = deriveVenuePda(venueId, kollect.programId);

      // Use the wallet (platform authority) as venue authority for signing ease
      await kollect.methods
        .registerVenue(new anchor.BN(venueId), {
          venueAuthority: authority.publicKey,
          name: venueName("Updateable Venue"),
          venueType: 1,
          capacity: 200,
          operatingHours: 10,
          multiplierBps: 5_000,
        })
        .rpc();
    });

    it("updates venue capacity", async () => {
      await kollect.methods
        .updateVenue({
          newAuthority: null,
          newVenueType: null,
          newCapacity: 300,
          newOperatingHours: null,
        })
        .accountsPartial({ venue: venuePda })
        .rpc();

      const venue = await kollect.account.venueAccount.fetch(venuePda);
      expect(venue.capacity).to.equal(300);
      // Other fields unchanged
      expect(venue.venueType).to.equal(1);
      expect(venue.operatingHours).to.equal(10);
    });

    it("updates venue type", async () => {
      await kollect.methods
        .updateVenue({
          newAuthority: null,
          newVenueType: 3,
          newCapacity: null,
          newOperatingHours: null,
        })
        .accountsPartial({ venue: venuePda })
        .rpc();

      const venue = await kollect.account.venueAccount.fetch(venuePda);
      expect(venue.venueType).to.equal(3);
    });

    it("updates operating hours", async () => {
      await kollect.methods
        .updateVenue({
          newAuthority: null,
          newVenueType: null,
          newCapacity: null,
          newOperatingHours: 18,
        })
        .accountsPartial({ venue: venuePda })
        .rpc();

      const venue = await kollect.account.venueAccount.fetch(venuePda);
      expect(venue.operatingHours).to.equal(18);
    });

    it("fails with wrong authority (non-venue-authority)", async () => {
      const fakeAuth = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fakeAuth.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(sig);

      try {
        await kollect.methods
          .updateVenue({
            newAuthority: null,
            newVenueType: null,
            newCapacity: 999,
            newOperatingHours: null,
          })
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

    it("fails on deactivated venue", async () => {
      // Create a venue, deactivate it, then try to update
      const deactVenueId = nextVenueId();
      const deactVenuePda = deriveVenuePda(deactVenueId, kollect.programId);

      await kollect.methods
        .registerVenue(new anchor.BN(deactVenueId), {
          venueAuthority: authority.publicKey,
          name: venueName("Deact Venue"),
          venueType: 1,
          capacity: 100,
          operatingHours: 8,
          multiplierBps: 5_000,
        })
        .rpc();

      await kollect.methods
        .deactivateVenue()
        .accountsPartial({ venue: deactVenuePda })
        .rpc();

      try {
        await kollect.methods
          .updateVenue({
            newAuthority: null,
            newVenueType: null,
            newCapacity: 999,
            newOperatingHours: null,
          })
          .accountsPartial({ venue: deactVenuePda })
          .rpc();
        expect.fail("Should have failed");
      } catch (err) {
        expect(err.toString()).to.include("VenueNotActive");
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
          name: venueName("Multiplier Venue"),
          venueType: 2,
          capacity: 150,
          operatingHours: 12,
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
          name: venueName("Deactivation Target"),
          venueType: 1,
          capacity: 100,
          operatingHours: 8,
          multiplierBps: 5_000,
        })
        .rpc();
    });

    it("deactivates a venue", async () => {
      const venueBefore = await kollect.account.venueAccount.fetch(venuePda);
      expect(venueBefore.isActive).to.be.true;

      await kollect.methods
        .deactivateVenue()
        .accountsPartial({ venue: venuePda })
        .rpc();

      const venueAfter = await kollect.account.venueAccount.fetch(venuePda);
      expect(venueAfter.isActive).to.be.false;
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

    it("fails with non-platform authority", async () => {
      const activeVenueId = nextVenueId();
      const activeVenuePda = deriveVenuePda(activeVenueId, kollect.programId);

      await kollect.methods
        .registerVenue(new anchor.BN(activeVenueId), {
          venueAuthority: authority.publicKey,
          name: venueName("Auth Test Venue"),
          venueType: 1,
          capacity: 100,
          operatingHours: 8,
          multiplierBps: 5_000,
        })
        .rpc();

      const fakeAuth = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        fakeAuth.publicKey,
        1_000_000_000,
      );
      await provider.connection.confirmTransaction(sig);

      try {
        await kollect.methods
          .deactivateVenue()
          .accountsPartial({
            authority: fakeAuth.publicKey,
            venue: activeVenuePda,
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
