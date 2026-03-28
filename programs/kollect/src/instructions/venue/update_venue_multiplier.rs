use anchor_lang::prelude::*;

use crate::error::KollectError;
use crate::events::VenueMultiplierUpdated;
use crate::state::{PlatformConfig, VenueAccount};
use crate::utils::seeds::{PLATFORM_CONFIG_SEED, VENUE_SEED};

#[derive(Accounts)]
pub struct UpdateVenueMultiplier<'info> {
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

pub fn handler(ctx: Context<UpdateVenueMultiplier>, new_multiplier_bps: u16) -> Result<()> {
    require!(new_multiplier_bps > 0, KollectError::InvalidMultiplier);

    let venue = &mut ctx.accounts.venue;
    let old_multiplier = venue.multiplier_bps;
    venue.multiplier_bps = new_multiplier_bps;

    let clock = Clock::get()?;
    venue.updated_at = clock.unix_timestamp;

    emit!(VenueMultiplierUpdated {
        venue: venue.key(),
        old_multiplier,
        new_multiplier: new_multiplier_bps,
        updated_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
