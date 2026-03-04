//! Metadata account.
//!
//! PDA Seeds:
//! - Entity: `["metadata", "entity", entity_pubkey, revision]`
//! - IP: `["metadata", "ip", ip_pubkey, revision]`
//!
//! Invariants:
//! - Immutable after creation
//! - Schema must reference a valid MetadataSchema
//! - Revision must equal parent.current_metadata_revision + 1

use anchor_lang::prelude::*;

use crate::constants::MAX_CID_LENGTH;

/// Space calculation for MetadataAccount:
/// - 8 bytes: discriminator
/// - 32 bytes: schema
/// - 32 bytes: hash
/// - 96 bytes: cid
/// - 1 byte: parent_type (enum)
/// - 32 bytes: parent
/// - 8 bytes: revision
/// - 8 bytes: created_at
/// - 1 byte: bump
///
/// Total: 218 bytes
pub const METADATA_ACCOUNT_SIZE: usize = 8 + 32 + 32 + 96 + 1 + 32 + 8 + 8 + 1;

/// Type of parent that this metadata is attached to.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum MetadataParentType {
    /// Metadata attached to an Entity.
    Entity = 0,
    /// Metadata attached to an IP.
    Ip = 1,
}

/// Metadata attached to an entity or IP.
///
/// Contains a reference to a schema and the actual metadata content hash and CID.
#[account]
#[derive(Debug)]
pub struct MetadataAccount {
    /// Reference to the MetadataSchema this metadata conforms to.
    pub schema: Pubkey,

    /// SHA-256 hash of the metadata content.
    pub hash: [u8; 32],

    /// IPFS CID pointing to the metadata content.
    pub cid: [u8; MAX_CID_LENGTH],

    /// Type of parent (Entity or IP).
    pub parent_type: MetadataParentType,

    /// Public key of the parent (Entity or IP account).
    pub parent: Pubkey,

    /// Monotonically increasing revision number.
    pub revision: u64,

    /// Unix timestamp when this metadata was created.
    pub created_at: i64,

    /// PDA bump seed.
    pub bump: u8,
}

impl MetadataAccount {
    /// Returns the PDA seed prefix for metadata accounts.
    pub fn seed_prefix() -> &'static [u8] {
        b"metadata"
    }

    /// Returns the seed for entity metadata.
    pub fn entity_seed() -> &'static [u8] {
        b"entity"
    }

    /// Returns the seed for IP metadata.
    pub fn ip_seed() -> &'static [u8] {
        b"ip"
    }
}
