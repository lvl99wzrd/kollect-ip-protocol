use anchor_lang::prelude::*;

use crate::error::KollectError;
use crate::events::VenueDeactivated;
use crate::state::{PlatformConfig, VenueAccount};
use crate::utils::seeds::{PLATFORM_CONFIG_SEED, VENUE_SEED};

#[derive(Accounts)]
pub struct DeactivateVenue<'info> {
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
}

pub fn handler(ctx: Context<DeactivateVenue>) -> Result<()> {
    let venue = &mut ctx.accounts.venue;
    let clock = Clock::get()?;

    venue.is_active = false;
    venue.updated_at = clock.unix_timestamp;

    emit!(VenueDeactivated {
        venue: venue.key(),
        deactivated_at: clock.unix_timestamp,
    });

    Ok(())
}
