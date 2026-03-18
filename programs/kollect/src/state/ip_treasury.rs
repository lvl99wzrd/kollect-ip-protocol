use anchor_lang::prelude::*;

#[account]
pub struct IpTreasury {
    pub ip_account: Pubkey,
    pub ip_config: Pubkey,
    pub entity_treasury: Pubkey,
    pub total_earned: u64,
    pub total_settled: u64,
    pub bump: u8,
}

impl IpTreasury {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1;
}
