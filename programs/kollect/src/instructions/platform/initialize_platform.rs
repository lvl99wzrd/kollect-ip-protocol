use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::MAX_ROYALTY_CHAIN_DEPTH;
use crate::error::KollectError;
use crate::events::PlatformInitialized;
use crate::state::{PlatformConfig, PlatformTreasury};
use crate::utils::seeds::{PLATFORM_CONFIG_SEED, PLATFORM_TREASURY_SEED};

#[derive(Accounts)]
#[instruction(base_price_per_play: u64, platform_fee_bps: u16, currency: Pubkey)]
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

    /// SPL token mint used as the platform currency.
    /// Must match the `currency` parameter passed to this instruction.
    #[account(constraint = currency_mint.key() == currency @ KollectError::InvalidCurrency)]
    pub currency_mint: Account<'info, Mint>,

    /// ATA for the platform treasury to hold currency tokens.
    #[account(
        init,
        payer = authority,
        associated_token::mint = currency_mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializePlatform>,
    base_price_per_play: u64,
    platform_fee_bps: u16,
    currency: Pubkey,
    max_derivatives_depth: u8,
    max_license_types: u16,
) -> Result<()> {
    require!(platform_fee_bps <= 10_000, KollectError::InvalidShareBps);
    require!(
        max_derivatives_depth <= MAX_ROYALTY_CHAIN_DEPTH,
        KollectError::RoyaltyChainTooDeep
    );

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.base_price_per_play = base_price_per_play;
    config.platform_fee_bps = platform_fee_bps;
    config.currency = currency;
    config.max_derivatives_depth = max_derivatives_depth;
    config.max_license_types = max_license_types;
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
