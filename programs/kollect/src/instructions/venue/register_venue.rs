use anchor_lang::prelude::*;

use crate::error::KollectError;
use crate::events::VenueRegistered;
use crate::state::{PlatformConfig, VenueAccount};
use crate::utils::seeds::{PLATFORM_CONFIG_SEED, VENUE_SEED};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegisterVenueParams {
    pub venue_authority: Pubkey,
    pub cid: [u8; 96],
    pub multiplier_bps: u16,
}

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
    params: RegisterVenueParams,
) -> Result<()> {
    require!(params.cid.iter().any(|&b| b != 0), KollectError::InvalidCid);
    require!(params.multiplier_bps > 0, KollectError::InvalidMultiplier);

    let clock = Clock::get()?;
    let venue = &mut ctx.accounts.venue;

    venue.venue_id = venue_id;
    venue.authority = params.venue_authority;
    venue.cid = params.cid;
    venue.multiplier_bps = params.multiplier_bps;
    venue.is_active = true;
    venue.total_commitments = 0;
    venue.registered_at = clock.unix_timestamp;
    venue.updated_at = clock.unix_timestamp;
    venue.bump = ctx.bumps.venue;

    emit!(VenueRegistered {
        venue: venue.key(),
        venue_id,
        authority: params.venue_authority,
        cid: params.cid,
        registered_at: venue.registered_at,
    });

    Ok(())
}
