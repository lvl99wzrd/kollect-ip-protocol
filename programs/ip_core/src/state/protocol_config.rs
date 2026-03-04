//! Protocol configuration account.
//!
//! PDA Seeds: `["config"]`
//!
//! Invariants:
//! - Exactly one instance may exist
//! - Must be initialized before any entity or IP creation
//! - Authority is used for config mutation only

use anchor_lang::prelude::*;

/// Space calculation for ProtocolConfig:
/// - 8 bytes: discriminator
/// - 32 bytes: authority
/// - 32 bytes: treasury
/// - 32 bytes: registration_currency
/// - 8 bytes: registration_fee
/// - 1 byte: bump
///
/// Total: 113 bytes
pub const PROTOCOL_CONFIG_SIZE: usize = 8 + 32 + 32 + 32 + 8 + 1;

/// Protocol-wide configuration account.
///
/// Controls registration fees and treasury settings.
#[account]
#[derive(Debug)]
pub struct ProtocolConfig {
    /// The authority allowed to update configuration.
    pub authority: Pubkey,

    /// The treasury PDA that receives registration fees.
    pub treasury: Pubkey,

    /// The SPL token mint for registration fees.
    pub registration_currency: Pubkey,

    /// The fee amount required to register an IP.
    pub registration_fee: u64,

    /// PDA bump seed.
    pub bump: u8,
}

impl ProtocolConfig {
    /// Returns the PDA seeds for this account.
    pub fn seeds() -> &'static [u8] {
        b"config"
    }
}
