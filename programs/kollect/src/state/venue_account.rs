use anchor_lang::prelude::*;

use crate::constants::MAX_CID_LENGTH;

#[account]
pub struct VenueAccount {
    pub venue_id: u64,
    pub authority: Pubkey,
    pub cid: [u8; MAX_CID_LENGTH],
    pub multiplier_bps: u16,
    pub is_active: bool,
    pub total_commitments: u64,
    pub registered_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl VenueAccount {
    // 8 disc + 8 venue_id + 32 authority + 96 cid
    // + 2 multiplier_bps + 1 is_active + 8 total_commitments
    // + 8 registered_at + 8 updated_at + 1 bump
    pub const SIZE: usize = 8 + 8 + 32 + MAX_CID_LENGTH + 2 + 1 + 8 + 8 + 8 + 1;
}
