use anchor_lang::prelude::*;

use crate::constants::MAX_OPERATING_HOURS;
use crate::error::KollectError;
use crate::events::VenueUpdated;
use crate::state::VenueAccount;
use crate::utils::seeds::VENUE_SEED;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateVenueParams {
    pub new_authority: Option<Pubkey>,
    pub new_venue_type: Option<u8>,
    pub new_capacity: Option<u32>,
    pub new_operating_hours: Option<u8>,
}

#[derive(Accounts)]
pub struct UpdateVenue<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [VENUE_SEED, &venue.venue_id.to_le_bytes()],
        bump = venue.bump,
        constraint = venue.authority == authority.key() @ KollectError::InvalidAuthority,
        constraint = venue.is_active @ KollectError::VenueNotActive,
    )]
    pub venue: Account<'info, VenueAccount>,
}

pub fn handler(ctx: Context<UpdateVenue>, params: UpdateVenueParams) -> Result<()> {
    let venue = &mut ctx.accounts.venue;

    if let Some(authority) = params.new_authority {
        venue.authority = authority;
    }
    if let Some(venue_type) = params.new_venue_type {
        require!(
            VenueAccount::is_valid_venue_type(venue_type),
            KollectError::InvalidVenueType
        );
        venue.venue_type = venue_type;
    }
    if let Some(capacity) = params.new_capacity {
        require!(capacity > 0, KollectError::InvalidCapacity);
        venue.capacity = capacity;
    }
    if let Some(hours) = params.new_operating_hours {
        require!(
            hours > 0 && hours <= MAX_OPERATING_HOURS,
            KollectError::InvalidOperatingHours
        );
        venue.operating_hours = hours;
    }

    let clock = Clock::get()?;
    venue.updated_at = clock.unix_timestamp;

    emit!(VenueUpdated {
        venue: venue.key(),
        venue_type: venue.venue_type,
        capacity: venue.capacity,
        operating_hours: venue.operating_hours,
        updated_at: venue.updated_at,
    });

    Ok(())
}
