//! License grant account.
//!
//! PDA Seeds: `["license_grant", license, grantee_entity]`
//!
//! Invariants:
//! - license must reference a valid License account owned by this program.
//! - grantee must reference a valid Entity account owned by ip_core.
//! - expiration = 0 means no expiration (permanent grant).
//! - expiration > 0 means unix timestamp after which grant is invalid.
//! - One grant per (license, grantee) pair.
//! - license is immutable.
//! - grantee is immutable.
//! - granted_at is immutable.

use anchor_lang::prelude::*;

/// Space calculation for LicenseGrant:
/// - 8 bytes: discriminator
/// - 32 bytes: license
/// - 32 bytes: grantee
/// - 8 bytes: granted_at
/// - 8 bytes: expiration
/// - 1 byte: bump
///
/// Total: 89 bytes
pub const LICENSE_GRANT_SIZE: usize = 8 + 32 + 32 + 8 + 8 + 1;

/// A grant of license rights to a specific entity.
///
/// Grants allow entities to use an IP under the terms of its license.
/// The grant may be permanent (expiration = 0) or time-limited.
#[account]
#[derive(Debug)]
pub struct LicenseGrant {
    /// The license this grant is for (immutable).
    pub license: Pubkey,

    /// The entity that has been granted rights (immutable).
    pub grantee: Pubkey,

    /// Unix timestamp when this grant was created (immutable).
    pub granted_at: i64,

    /// Expiration timestamp (0 = no expiration).
    pub expiration: i64,

    /// PDA bump seed.
    pub bump: u8,
}

impl LicenseGrant {
    /// Returns the PDA seed prefix for license grant accounts.
    pub fn seed_prefix() -> &'static [u8] {
        b"license_grant"
    }

    /// Returns whether this grant has expired.
    ///
    /// # Arguments
    /// * `current_timestamp` - Current unix timestamp
    ///
    /// # Returns
    /// * `true` if grant has expired
    /// * `false` if grant is permanent or still valid
    pub fn is_expired(&self, current_timestamp: i64) -> bool {
        self.expiration != 0 && self.expiration < current_timestamp
    }
}
