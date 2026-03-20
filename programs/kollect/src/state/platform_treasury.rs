use anchor_lang::prelude::*;

#[account]
pub struct PlatformTreasury {
    pub authority: Pubkey,
    pub config: Pubkey,
    pub bump: u8,
}

impl PlatformTreasury {
    pub const SIZE: usize = 8 + 32 + 32 + 1;
}
