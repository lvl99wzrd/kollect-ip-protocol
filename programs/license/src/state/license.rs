//! License account.
//!
//! PDA Seeds: `["license", origin_ip]`
//!
//! Invariants:
//! - origin_ip must reference a valid IPAccount owned by ip_core.
//! - origin_ip must NOT be a derivative IP (has no parent DerivativeLink where child_ip == origin_ip).
//! - Derivative IPs inherit licensing terms from their parent — they cannot create independent licenses.
//! - authority is the Entity that owns the IP at creation time.
//! - authority is immutable after creation.
//! - origin_ip is immutable after creation.
//! - License never expires (terms are permanent).
//! - Only one license may exist per IP.

use anchor_lang::prelude::*;

/// Space calculation for License:
/// - 8 bytes: discriminator
/// - 32 bytes: origin_ip
/// - 32 bytes: authority
/// - 1 byte: derivatives_allowed
/// - 8 bytes: created_at
/// - 1 byte: bump
///
/// Total: 82 bytes
pub const LICENSE_SIZE: usize = 8 + 32 + 32 + 1 + 8 + 1;

/// A license attached to an IP, defining usage terms.
///
/// Licenses are permanent and define what operations are permitted
/// for the associated IP (e.g., derivative creation).
#[account]
#[derive(Debug)]
pub struct License {
    /// The IP this license is attached to (immutable).
    pub origin_ip: Pubkey,

    /// The entity that has authority over this license (immutable).
    /// This is the IP owner at the time of license creation.
    pub authority: Pubkey,

    /// Whether derivatives are allowed under this license.
    pub derivatives_allowed: bool,

    /// Unix timestamp when this license was created.
    pub created_at: i64,

    /// PDA bump seed.
    pub bump: u8,
}

impl License {
    /// Returns the PDA seed prefix for license accounts.
    pub fn seed_prefix() -> &'static [u8] {
        b"license"
    }
}
