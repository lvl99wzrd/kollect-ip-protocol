use anchor_lang::prelude::*;

use crate::constants::MAX_HANDLE_LENGTH;

/// Space calculation for Entity:
/// - 8 bytes: discriminator
/// - 32 bytes: creator
/// - 32 bytes: handle
/// - 32 bytes: controller
/// - 8 bytes: current_metadata_revision
/// - 8 bytes: created_at
/// - 8 bytes: updated_at
/// - 1 byte: bump
///
/// Total: 129 bytes
pub const ENTITY_SIZE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 1;

/// An on-chain entity that can own IP and sign transactions.
///
/// Entities use a single controller model. For multisig functionality,
/// the controller can be set to an external multisig PDA (e.g., Squads).
#[account]
#[derive(Debug)]
pub struct Entity {
    /// The original creator of this entity (immutable).
    pub creator: Pubkey,

    /// Unique handle for this entity (lowercase alphanumeric, immutable).
    pub handle: [u8; MAX_HANDLE_LENGTH],

    /// The controller public key authorized to act on behalf of this entity.
    /// Can be an EOA or an external multisig PDA (e.g., Squads).
    pub controller: Pubkey,

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
