use anchor_lang::prelude::*;

#[account]
pub struct RoyaltySplit {
    pub derivative_ip: Pubkey,
    pub origin_ip: Pubkey,
    pub license_grant: Pubkey,
    pub license: Pubkey,
    pub share_bps: u16,
    pub total_distributed: u64,
    pub created_at: i64,
    pub bump: u8,
}

impl RoyaltySplit {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 32 + 2 + 8 + 8 + 1;
}
