use anchor_lang::prelude::*;

#[account]
pub struct RoyaltyPolicy {
    pub license_template: Pubkey,
    pub derivative_share_bps: u16,
    pub allow_remix: bool,
    pub allow_cover: bool,
    pub allow_sample: bool,
    pub attribution_required: bool,
    pub commercial_use: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl RoyaltyPolicy {
    pub const SIZE: usize = 8 + 32 + 2 + 1 + 1 + 1 + 1 + 1 + 8 + 8 + 1;
}
