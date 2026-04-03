use anchor_lang::prelude::*;

use crate::error::KollectError;
use crate::events::PlaybackSubmitted;
use crate::state::{PlatformConfig, PlaybackCommitment, VenueAccount};
use crate::utils::seeds::{PLATFORM_CONFIG_SEED, PLAYBACK_SEED, VENUE_SEED};
use crate::utils::validation::validate_day_timestamp;

#[derive(Accounts)]
#[instruction(day_timestamp: i64)]
pub struct SubmitPlayback<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ KollectError::InvalidAuthority,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(
        mut,
        seeds = [VENUE_SEED, &venue.venue_id.to_le_bytes()],
        bump = venue.bump,
        constraint = venue.is_active @ KollectError::VenueNotActive,
    )]
    pub venue: Account<'info, VenueAccount>,

    #[account(
        init,
        payer = authority,
        space = PlaybackCommitment::SIZE,
        seeds = [PLAYBACK_SEED, venue.key().as_ref(), &day_timestamp.to_le_bytes()],
        bump,
    )]
    pub commitment: Account<'info, PlaybackCommitment>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SubmitPlayback>,
    day_timestamp: i64,
    commitment_hash: [u8; 32],
    total_plays: u64,
) -> Result<()> {
    validate_day_timestamp(day_timestamp)?;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let commitment = &mut ctx.accounts.commitment;
    commitment.venue = ctx.accounts.venue.key();
    commitment.day_timestamp = day_timestamp;
    commitment.commitment_hash = commitment_hash;
    commitment.total_plays = total_plays;
    commitment.submitted_at = now;
    commitment.settled = false;
    commitment.bump = ctx.bumps.commitment;

    let venue = &mut ctx.accounts.venue;
    venue.total_commitments = venue
        .total_commitments
        .checked_add(1)
        .ok_or(KollectError::ArithmeticOverflow)?;
    venue.updated_at = now;

    emit!(PlaybackSubmitted {
        commitment: commitment.key(),
        venue: venue.key(),
        day_timestamp,
        commitment_hash,
        total_plays,
    });

    Ok(())
}
