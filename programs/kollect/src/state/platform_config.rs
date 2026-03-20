use anchor_lang::prelude::*;

#[account]
pub struct PlatformConfig {
    pub authority: Pubkey,
    pub platform_fee_bps: u16,
    pub base_price_per_play: u64,
    pub settlement_currency: Pubkey,
    pub max_derivatives: u16,
    pub treasury: Pubkey,
    pub bump: u8,
}

impl PlatformConfig {
    pub const SIZE: usize = 8 + 32 + 2 + 8 + 32 + 2 + 32 + 1;
}
