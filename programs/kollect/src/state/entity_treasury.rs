use anchor_lang::prelude::*;

#[account]
pub struct EntityTreasury {
    pub entity: Pubkey,
    pub authority: Pubkey,
    pub total_earned: u64,
    pub total_withdrawn: u64,
    pub bump: u8,
}

impl EntityTreasury {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 1;
}
