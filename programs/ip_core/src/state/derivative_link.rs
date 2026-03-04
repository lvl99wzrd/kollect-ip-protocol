//! Derivative link account.
//!
//! PDA Seeds: `["derivative", parent_ip, child_ip]`
//!
//! Invariants:
//! - parent_ip must exist
//! - child_ip must exist
//! - license must be owned by LICENSE_PROGRAM_ID
//! - Immutable except optional license update
//! - No economic fields

use anchor_lang::prelude::*;

/// Space calculation for DerivativeLink:
/// - 8 bytes: discriminator
/// - 32 bytes: parent_ip
/// - 32 bytes: child_ip
/// - 32 bytes: license
/// - 8 bytes: created_at
/// - 1 byte: bump
///
/// Total: 113 bytes
pub const DERIVATIVE_LINK_SIZE: usize = 8 + 32 + 32 + 32 + 8 + 1;

/// A link between a parent IP and a derivative (child) IP.
///
/// Records that a child IP is derived from a parent IP under a specific license.
#[account]
#[derive(Debug)]
pub struct DerivativeLink {
    /// The parent IP that this derivative is based on.
    pub parent_ip: Pubkey,

    /// The child IP that is derived from the parent.
    pub child_ip: Pubkey,

    /// The license under which this derivative was created.
    /// Must be owned by the license program.
    pub license: Pubkey,

    /// Unix timestamp when this derivative link was created.
    pub created_at: i64,

    /// PDA bump seed.
    pub bump: u8,
}

impl DerivativeLink {
    /// Returns the PDA seed prefix for derivative link accounts.
    pub fn seed_prefix() -> &'static [u8] {
        b"derivative"
    }
}
