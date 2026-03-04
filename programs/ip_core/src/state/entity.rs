//! Entity account.
//!
//! PDA Seeds: `["entity", creator_pubkey, handle]`
//!
//! Invariants:
//! - controllers.len() ∈ [1, 5]
//! - signature_threshold ∈ [1, controllers.len()]
//! - creator must be in controllers
//! - handle immutable
//! - creator immutable
//! - created_at immutable

use anchor_lang::prelude::*;

use crate::constants::{MAX_CONTROLLERS, MAX_HANDLE_LENGTH};

/// Space calculation for Entity:
/// - 8 bytes: discriminator
/// - 32 bytes: creator
/// - 32 bytes: handle
/// - 4 + (5 * 32) bytes: controllers vec (4 byte length + max 5 pubkeys)
/// - 1 byte: signature_threshold
/// - 8 bytes: current_metadata_revision
/// - 8 bytes: created_at
/// - 8 bytes: updated_at
/// - 1 byte: bump
///
/// Total: 262 bytes
pub const ENTITY_SIZE: usize = 8 + 32 + 32 + (4 + MAX_CONTROLLERS * 32) + 1 + 8 + 8 + 8 + 1;

/// An on-chain entity that can own IP and sign transactions.
///
/// Entities use a multisig pattern where multiple controllers can manage
/// the entity's assets with a configurable signature threshold.
#[account]
#[derive(Debug)]
pub struct Entity {
    /// The original creator of this entity (immutable).
    pub creator: Pubkey,

    /// Unique handle for this entity (lowercase alphanumeric, immutable).
    pub handle: [u8; MAX_HANDLE_LENGTH],

    /// List of controller public keys that can sign for this entity.
    /// Maximum 5 controllers.
    pub controllers: Vec<Pubkey>,

    /// Number of signatures required to authorize actions.
    /// Must be between 1 and controllers.len().
    pub signature_threshold: u8,

    /// Current metadata revision number.
    /// Incremented when new metadata is attached.
    pub current_metadata_revision: u64,

    /// Unix timestamp when this entity was created.
    pub created_at: i64,

    /// Unix timestamp when this entity was last updated.
    pub updated_at: i64,

    /// PDA bump seed.
    pub bump: u8,
}

impl Entity {
    /// Returns the PDA seed prefix for entity accounts.
    pub fn seed_prefix() -> &'static [u8] {
        b"entity"
    }
}
