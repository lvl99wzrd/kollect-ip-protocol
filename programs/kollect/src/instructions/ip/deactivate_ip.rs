use anchor_lang::prelude::*;

use crate::error::KollectError;
use crate::events::IpDeactivated;
use crate::state::{IpConfig, PlatformConfig};
use crate::utils::seeds::{IP_CONFIG_SEED, PLATFORM_CONFIG_SEED};

#[derive(Accounts)]
pub struct DeactivateIp<'info> {
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
        constraint = ip_config.is_active @ KollectError::IpNotActive,
    )]
    pub ip_config: Account<'info, IpConfig>,
}

pub fn handler(ctx: Context<DeactivateIp>) -> Result<()> {
    let ip_config = &mut ctx.accounts.ip_config;
    let clock = Clock::get()?;

    ip_config.is_active = false;
    ip_config.updated_at = clock.unix_timestamp;

    emit!(IpDeactivated {
        ip_config: ip_config.key(),
        deactivated_at: clock.unix_timestamp,
    });

    Ok(())
}
