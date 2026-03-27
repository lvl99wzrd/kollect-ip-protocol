use anchor_lang::prelude::*;

#[account]
pub struct IpConfig {
    pub ip_account: Pubkey,
    pub owner_entity: Pubkey,
    pub price_per_play_override: Option<u64>,
    pub is_active: bool,
    pub license_template_count: u16,
    pub onboarded_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl IpConfig {
    // 8 disc + 32 ip_account + 32 owner_entity + 9 Option<u64>
    // + 1 is_active + 2 license_template_count + 8 onboarded_at + 8 updated_at + 1 bump
    pub const SIZE: usize = 8 + 32 + 32 + 9 + 1 + 2 + 8 + 8 + 1;
}
