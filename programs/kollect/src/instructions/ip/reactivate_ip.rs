use anchor_lang::prelude::*;

use crate::error::KollectError;
use crate::events::IpReactivated;
use crate::state::{IpConfig, PlatformConfig};
use crate::utils::seeds::{IP_CONFIG_SEED, PLATFORM_CONFIG_SEED};

#[derive(Accounts)]
pub struct ReactivateIp<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ KollectError::InvalidAuthority,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(
        mut,
        seeds = [IP_CONFIG_SEED, ip_config.ip_account.as_ref()],
        bump = ip_config.bump,
        constraint = !ip_config.is_active @ KollectError::IpAlreadyActive,
    )]
    pub ip_config: Account<'info, IpConfig>,
}

pub fn handler(ctx: Context<ReactivateIp>) -> Result<()> {
    let ip_config = &mut ctx.accounts.ip_config;
    let clock = Clock::get()?;

    ip_config.is_active = true;
    ip_config.updated_at = clock.unix_timestamp;

    emit!(IpReactivated {
        ip_config: ip_config.key(),
        reactivated_at: clock.unix_timestamp,
    });

    Ok(())
}
