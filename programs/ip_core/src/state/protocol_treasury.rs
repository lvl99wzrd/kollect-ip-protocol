//! Protocol treasury account.
//!
//! PDA Seeds: `["treasury"]`
//!
//! Invariants:
//! - Exactly one instance
//! - Config must match ProtocolConfig PDA
//! - Acts as authority over SPL token accounts
//! - Does NOT hold funds directly

use anchor_lang::prelude::*;

/// Space calculation for ProtocolTreasury:
/// - 8 bytes: discriminator
/// - 32 bytes: authority
/// - 32 bytes: config
/// - 1 byte: bump
///
/// Total: 73 bytes
pub const PROTOCOL_TREASURY_SIZE: usize = 8 + 32 + 32 + 1;

/// Protocol treasury account.
///
/// Acts as the authority for SPL token accounts that hold registration fees.
#[account]
#[derive(Debug)]
pub struct ProtocolTreasury {
    /// The authority allowed to withdraw from treasury.
    pub authority: Pubkey,

    /// Reference to the ProtocolConfig PDA.
    pub config: Pubkey,

    /// PDA bump seed.
    pub bump: u8,
}

impl ProtocolTreasury {
    /// Returns the PDA seed for this account.
    pub fn seeds() -> &'static [u8] {
        b"treasury"
    }
}
