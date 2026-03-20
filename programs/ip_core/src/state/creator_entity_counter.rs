use anchor_lang::prelude::*;

/// Space calculation for CreatorEntityCounter:
/// - 8 bytes: discriminator
/// - 32 bytes: creator
/// - 8 bytes: entity_count
/// - 1 byte: bump
///
/// Total: 49 bytes
pub const CREATOR_ENTITY_COUNTER_SIZE: usize = 8 + 32 + 8 + 1;

/// Tracks the number of entities created by a given wallet.
///
/// Used to derive deterministic, sequential entity PDA seeds.
/// Initialized on first entity creation via `init_if_needed`.
#[account]
#[derive(Debug)]
pub struct CreatorEntityCounter {
    /// The creator wallet this counter belongs to.
    pub creator: Pubkey,

    /// Total number of entities created by this creator.
    /// The next entity will receive this value as its index.
    pub entity_count: u64,

    /// PDA bump seed.
    pub bump: u8,
}
