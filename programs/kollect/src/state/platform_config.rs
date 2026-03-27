use anchor_lang::prelude::*;

#[account]
pub struct PlatformConfig {
    pub authority: Pubkey,
    pub platform_fee_bps: u16,
    pub base_price_per_play: u64,
    pub currency: Pubkey,
    pub max_derivatives_depth: u8,
    pub max_license_types: u16,
    pub treasury: Pubkey,
    pub bump: u8,
}

impl PlatformConfig {
    // 8 disc + 32 authority + 2 platform_fee_bps + 8 base_price_per_play
    // + 32 currency + 1 max_derivatives_depth + 2 max_license_types
    // + 32 treasury + 1 bump
    pub const SIZE: usize = 8 + 32 + 2 + 8 + 32 + 1 + 2 + 32 + 1;
}
