use anchor_lang::prelude::*;

use crate::constants::{MAX_OPERATING_HOURS, MAX_VENUE_NAME_LENGTH};
use crate::error::KollectError;
use crate::events::VenueRegistered;
use crate::state::{PlatformConfig, VenueAccount};
use crate::utils::seeds::{PLATFORM_CONFIG_SEED, VENUE_SEED};

#[derive(Accounts)]
#[instruction(venue_id: u64)]
pub struct RegisterVenue<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ KollectError::InvalidAuthority,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(
        init,
        payer = authority,
        space = VenueAccount::SIZE,
        seeds = [VENUE_SEED, &venue_id.to_le_bytes()],
        bump,
    )]
    pub venue: Account<'info, VenueAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterVenue>,
    venue_id: u64,
    venue_authority: Pubkey,
    name: [u8; MAX_VENUE_NAME_LENGTH],
    venue_type: u8,
    capacity: u32,
    operating_hours: u8,
    multiplier_bps: u16,
) -> Result<()> {
    require!(
        VenueAccount::is_valid_venue_type(venue_type),
        KollectError::InvalidVenueType
    );
    require!(capacity > 0, KollectError::InvalidCapacity);
    require!(
        operating_hours > 0 && operating_hours <= MAX_OPERATING_HOURS,
        KollectError::InvalidOperatingHours
    );
    require!(multiplier_bps > 0, KollectError::InvalidMultiplier);

    let clock = Clock::get()?;
    let venue = &mut ctx.accounts.venue;

    venue.venue_id = venue_id;
    venue.authority = venue_authority;
    venue.name = name;
    venue.venue_type = venue_type;
    venue.capacity = capacity;
    venue.operating_hours = operating_hours;
    venue.multiplier_bps = multiplier_bps;
    venue.is_active = true;
    venue.total_commitments = 0;
    venue.registered_at = clock.unix_timestamp;
    venue.updated_at = clock.unix_timestamp;
    venue.bump = ctx.bumps.venue;

    emit!(VenueRegistered {
        venue: venue.key(),
        venue_id,
        authority: venue_authority,
        venue_type,
        capacity,
        registered_at: venue.registered_at,
    });

    Ok(())
}
