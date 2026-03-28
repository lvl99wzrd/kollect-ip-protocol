use anchor_lang::prelude::*;

use crate::constants::{MAX_TEMPLATE_NAME_LENGTH, MAX_URI_LENGTH};

/// Global reusable license terms (PIL — Programmable IP License).
/// Anyone can create a template. Terms are immutable once created;
/// only `is_active` may be toggled to retire the template.
#[account]
pub struct LicenseTemplate {
    pub template_id: u64,
    pub creator: Pubkey,
    pub template_name: [u8; MAX_TEMPLATE_NAME_LENGTH],
    pub transferable: bool,
    pub derivatives_allowed: bool,
    pub derivatives_reciprocal: bool,
    pub derivatives_approval: bool,
    pub commercial_use: bool,
    pub commercial_attribution: bool,
    pub commercial_rev_share_bps: u16,
    pub derivative_rev_share_bps: u16,
    pub uri: [u8; MAX_URI_LENGTH],
    pub is_active: bool,
    pub created_at: i64,
    pub bump: u8,
}

impl LicenseTemplate {
    // 8 disc + 8 template_id + 32 creator + 64 template_name
    // + 6 bools + 2 + 2 bps + 96 uri + 1 is_active + 8 created_at + 1 bump
    pub const SIZE: usize = 8
        + 8
        + 32
        + MAX_TEMPLATE_NAME_LENGTH
        + 1
        + 1
        + 1
        + 1
        + 1
        + 1
        + 2
        + 2
        + MAX_URI_LENGTH
        + 1
        + 8
        + 1;
}
