use anchor_lang::prelude::*;

use crate::error::KollectError;
use crate::events::VenueUpdated;
use crate::state::VenueAccount;
use crate::utils::seeds::VENUE_SEED;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateVenueParams {
    pub new_authority: Option<Pubkey>,
    pub new_cid: Option<[u8; 96]>,
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
    if let Some(cid) = params.new_cid {
        require!(cid.iter().any(|&b| b != 0), KollectError::InvalidCid);
        venue.cid = cid;
    }

    let clock = Clock::get()?;
    venue.updated_at = clock.unix_timestamp;

    emit!(VenueUpdated {
        venue: venue.key(),
        cid: venue.cid,
        updated_at: venue.updated_at,
    });

    Ok(())
}
