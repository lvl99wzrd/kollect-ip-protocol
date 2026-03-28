use anchor_lang::prelude::*;

use crate::constants::MAX_TEMPLATE_NAME_LENGTH;

#[account]
pub struct LicenseTemplate {
    pub ip_account: Pubkey,
    pub ip_config: Pubkey,
    pub creator_entity: Pubkey,
    pub template_name: [u8; MAX_TEMPLATE_NAME_LENGTH],
    pub price: u64,
    pub max_grants: u16,
    pub current_grants: u16,
    pub grant_duration: i64,
    pub is_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl LicenseTemplate {
    pub const SIZE: usize =
        8 + 32 + 32 + 32 + MAX_TEMPLATE_NAME_LENGTH + 8 + 2 + 2 + 8 + 1 + 8 + 8 + 1;
}
