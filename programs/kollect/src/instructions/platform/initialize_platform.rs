use anchor_lang::prelude::*;

use crate::events::PlatformInitialized;
use crate::state::{PlatformConfig, PlatformTreasury};
use crate::utils::seeds::{PLATFORM_CONFIG_SEED, PLATFORM_TREASURY_SEED};

#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = PlatformConfig::SIZE,
        seeds = [PLATFORM_CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(
        init,
        payer = authority,
        space = PlatformTreasury::SIZE,
        seeds = [PLATFORM_TREASURY_SEED],
        bump,
    )]
    pub treasury: Account<'info, PlatformTreasury>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializePlatform>,
    base_price_per_play: u64,
    platform_fee_bps: u16,
    settlement_currency: Pubkey,
    max_derivatives: u16,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.base_price_per_play = base_price_per_play;
    config.platform_fee_bps = platform_fee_bps;
    config.settlement_currency = settlement_currency;
    config.max_derivatives = max_derivatives;
    config.treasury = ctx.accounts.treasury.key();
    config.bump = ctx.bumps.config;

    let treasury = &mut ctx.accounts.treasury;
    treasury.authority = ctx.accounts.authority.key();
    treasury.config = config.key();
    treasury.bump = ctx.bumps.treasury;

    emit!(PlatformInitialized {
        config: config.key(),
        authority: config.authority,
        base_price_per_play,
        platform_fee_bps,
    });

    Ok(())
}
