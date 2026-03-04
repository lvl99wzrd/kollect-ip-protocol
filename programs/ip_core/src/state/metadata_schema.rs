//! Metadata schema account.
//!
//! PDA Seeds: `["metadata_schema", schema_id, version]`
//!
//! Invariants:
//! - Immutable after initialization
//! - id + version must be unique
//! - CID must not be empty

use anchor_lang::prelude::*;

use crate::constants::{MAX_CID_LENGTH, MAX_SCHEMA_ID_LENGTH, MAX_VERSION_LENGTH};

/// Space calculation for MetadataSchema:
/// - 8 bytes: discriminator
/// - 32 bytes: id
/// - 16 bytes: version
/// - 32 bytes: hash
/// - 96 bytes: cid
/// - 32 bytes: creator
/// - 8 bytes: created_at
/// - 1 byte: bump
///
/// Total: 225 bytes
pub const METADATA_SCHEMA_SIZE: usize = 8 + 32 + 16 + 32 + 96 + 32 + 8 + 1;

/// Metadata schema definition.
///
/// Defines the structure and validation rules for metadata attached to entities or IPs.
#[account]
#[derive(Debug)]
pub struct MetadataSchema {
    /// Unique identifier for this schema.
    pub id: [u8; MAX_SCHEMA_ID_LENGTH],

    /// Version string for this schema.
    pub version: [u8; MAX_VERSION_LENGTH],

    /// SHA-256 hash of the schema definition.
    pub hash: [u8; 32],

    /// IPFS CID pointing to the schema definition.
    pub cid: [u8; MAX_CID_LENGTH],

    /// Creator of this schema.
    pub creator: Pubkey,

    /// Unix timestamp when this schema was created.
    pub created_at: i64,

    /// PDA bump seed.
    pub bump: u8,
}

impl MetadataSchema {
    /// Returns the PDA seed prefix for this account type.
    pub fn seed_prefix() -> &'static [u8] {
        b"metadata_schema"
    }
}
