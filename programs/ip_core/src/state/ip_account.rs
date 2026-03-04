//! IP (Intellectual Property) account.
//!
//! PDA Seeds: `["ip", registrant_entity, content_hash]`
//!
//! Invariants:
//! - content_hash immutable
//! - registrant_entity immutable
//! - PDA never changes
//! - current_owner_entity mutable only via transfer
//! - No royalty or governance fields

use anchor_lang::prelude::*;

/// Space calculation for IpAccount:
/// - 8 bytes: discriminator
/// - 32 bytes: content_hash
/// - 32 bytes: registrant_entity
/// - 32 bytes: current_owner_entity
/// - 8 bytes: current_metadata_revision
/// - 8 bytes: created_at
/// - 1 byte: bump
///
/// Total: 121 bytes
pub const IP_ACCOUNT_SIZE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;

/// An on-chain IP (Intellectual Property) registration.
///
/// Represents a claim to a specific piece of intellectual property,
/// identified by its content hash.
#[account]
#[derive(Debug)]
pub struct IpAccount {
    /// SHA-256 hash of the content (immutable).
    pub content_hash: [u8; 32],

    /// The entity that originally registered this IP (immutable).
    pub registrant_entity: Pubkey,

    /// The entity that currently owns this IP.
    /// Can be transferred via transfer_ip instruction.
    pub current_owner_entity: Pubkey,

    /// Current metadata revision number.
    /// Incremented when new metadata is attached.
    pub current_metadata_revision: u64,

    /// Unix timestamp when this IP was registered.
    pub created_at: i64,

    /// PDA bump seed.
    pub bump: u8,
}

impl IpAccount {
    /// Returns the PDA seed prefix for IP accounts.
    pub fn seed_prefix() -> &'static [u8] {
        b"ip"
    }
}
