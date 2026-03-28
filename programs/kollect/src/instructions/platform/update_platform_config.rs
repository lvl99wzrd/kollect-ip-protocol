use anchor_lang::prelude::*;

use crate::constants::MAX_ROYALTY_CHAIN_DEPTH;
use crate::error::KollectError;
use crate::events::PlatformConfigUpdated;
use crate::state::PlatformConfig;
use crate::utils::seeds::PLATFORM_CONFIG_SEED;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdatePlatformConfigParams {
    pub new_authority: Option<Pubkey>,
    pub new_base_price_per_play: Option<u64>,
    pub new_platform_fee_bps: Option<u16>,
    pub new_max_derivatives_depth: Option<u8>,
    pub new_max_license_types: Option<u16>,
}

#[derive(Accounts)]
pub struct UpdatePlatformConfig<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ KollectError::InvalidAuthority,
    )]
    pub config: Account<'info, PlatformConfig>,
}

pub fn handler(
    ctx: Context<UpdatePlatformConfig>,
    params: UpdatePlatformConfigParams,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(authority) = params.new_authority {
        config.authority = authority;
    }
    if let Some(price) = params.new_base_price_per_play {
        config.base_price_per_play = price;
    }
    if let Some(fee_bps) = params.new_platform_fee_bps {
        require!(fee_bps <= 10_000, KollectError::InvalidShareBps);
        config.platform_fee_bps = fee_bps;
    }
    if let Some(max) = params.new_max_derivatives_depth {
        require!(
            max <= MAX_ROYALTY_CHAIN_DEPTH,
            KollectError::RoyaltyChainTooDeep
        );
        config.max_derivatives_depth = max;
    }
    if let Some(max_lt) = params.new_max_license_types {
        config.max_license_types = max_lt;
    }

    emit!(PlatformConfigUpdated {
        config: config.key(),
        authority: config.authority,
        base_price_per_play: config.base_price_per_play,
        platform_fee_bps: config.platform_fee_bps,
        max_derivatives_depth: config.max_derivatives_depth,
        max_license_types: config.max_license_types,
    });

    Ok(())
}
