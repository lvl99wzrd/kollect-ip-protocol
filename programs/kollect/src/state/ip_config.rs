use anchor_lang::prelude::*;

#[account]
pub struct IpConfig {
    pub ip_account: Pubkey,
    pub owner_entity: Pubkey,
    pub price_per_play_override: Option<u64>,
    pub is_active: bool,
    pub onboarded_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl IpConfig {
    // Option<u64> = 1 + 8 = 9 bytes
    pub const SIZE: usize = 8 + 32 + 32 + 9 + 1 + 8 + 8 + 1;
}
