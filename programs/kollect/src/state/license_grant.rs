use anchor_lang::prelude::*;

/// Thin interface account matching ip_core's `LicenseGrantData` exactly.
/// Created during `purchase_license`. ip_core uses `try_from_slice`
/// which rejects trailing bytes — this account must have exactly
/// these fields after the 8-byte Anchor discriminator.
#[account]
pub struct LicenseGrant {
    pub license: Pubkey,
    pub grantee: Pubkey,
    pub granted_at: i64,
    pub expiration: i64,
    pub bump: u8,
}

impl LicenseGrant {
    /// 8 (discriminator) + 32 + 32 + 8 + 8 + 1 = 89 bytes
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 1;
}
