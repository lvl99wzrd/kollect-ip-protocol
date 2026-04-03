use anchor_lang::prelude::*;

/// Per-entity proof of license purchase. Passed as `license_grant`
/// (account[0]) in ip_core's `validate_derivative_grant` CPI.
#[account]
pub struct LicenseGrant {
    pub license: Pubkey,
    pub grantee: Pubkey,
    pub granted_at: i64,
    pub expiration: i64,
    pub price_paid: u64,
    pub bump: u8,
}

impl LicenseGrant {
    // 8 disc + 32 license + 32 grantee + 8 granted_at + 8 expiration
    // + 8 price_paid + 1 bump
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1;
}
