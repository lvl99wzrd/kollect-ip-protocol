use anchor_lang::prelude::*;

use crate::constants::{MAX_VENUE_NAME_LENGTH, MAX_VENUE_TYPE};

#[account]
pub struct VenueAccount {
    pub venue_id: u64,
    pub authority: Pubkey,
    pub name: [u8; MAX_VENUE_NAME_LENGTH],
    pub venue_type: u8,
    pub capacity: u32,
    pub operating_hours: u8,
    pub multiplier_bps: u16,
    pub is_active: bool,
    pub total_commitments: u64,
    pub registered_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl VenueAccount {
    pub const SIZE: usize = 8 + 8 + 32 + MAX_VENUE_NAME_LENGTH + 1 + 4 + 1 + 2 + 1 + 8 + 8 + 8 + 1;
}

impl VenueAccount {
    pub fn is_valid_venue_type(venue_type: u8) -> bool {
        venue_type <= MAX_VENUE_TYPE
    }
}
