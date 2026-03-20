use anchor_lang::prelude::*;

#[account]
pub struct SettlementRecord {
    pub venue: Pubkey,
    pub period_start: i64,
    pub period_end: i64,
    pub total_plays: u64,
    pub total_amount: u64,
    pub platform_fee: u64,
    pub commitment_count: u16,
    pub merkle_root: [u8; 32],
    pub ip_count: u16,
    pub settled_at: i64,
    pub bump: u8,
}

impl SettlementRecord {
    pub const SIZE: usize = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 2 + 32 + 2 + 8 + 1;
}
