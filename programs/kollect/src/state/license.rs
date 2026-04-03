use anchor_lang::prelude::*;

/// Per-IP license attachment binding an IP to a LicenseTemplate.
/// Business terms (price, grants, duration) live here. Passed as
/// `license` (account[1]) in ip_core's `validate_derivative_grant` CPI.
#[account]
pub struct License {
    pub ip_account: Pubkey,
    pub ip_config: Pubkey,
    pub license_template: Pubkey,
    pub owner_entity: Pubkey,
    pub price: u64,
    pub max_grants: u16,
    pub current_grants: u16,
    pub grant_duration: i64,
    pub derivative_rev_share_bps: u16,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl License {
    // 8 disc + 32 ip_account + 32 ip_config + 32 license_template
    // + 32 owner_entity + 8 price + 2 max_grants + 2 current_grants
    // + 8 grant_duration + 2 derivative_rev_share_bps + 1 is_active
    // + 8 created_at + 8 updated_at + 1 bump
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 32 + 8 + 2 + 2 + 8 + 2 + 1 + 8 + 8 + 1;
}
