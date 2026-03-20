use anchor_lang::prelude::*;

#[account]
pub struct PlaybackCommitment {
    pub venue: Pubkey,
    pub day_timestamp: i64,
    pub commitment_hash: [u8; 32],
    pub total_plays: u64,
    pub submitted_at: i64,
    pub settled: bool,
    pub bump: u8,
}

impl PlaybackCommitment {
    pub const SIZE: usize = 8 + 32 + 8 + 32 + 8 + 8 + 1 + 1;
}
