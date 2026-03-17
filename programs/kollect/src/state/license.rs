use anchor_lang::prelude::*;

/// Thin interface account matching ip_core's `LicenseData` exactly.
/// Created alongside LicenseTemplate. ip_core uses `try_from_slice`
/// which rejects trailing bytes — this account must have exactly
/// these fields after the 8-byte Anchor discriminator.
#[account]
pub struct License {
    pub origin_ip: Pubkey,
    pub authority: Pubkey,
    pub derivatives_allowed: bool,
    pub created_at: i64,
    pub bump: u8,
}

impl License {
    /// 8 (discriminator) + 32 + 32 + 1 + 8 + 1 = 82 bytes
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8 + 1;
}
