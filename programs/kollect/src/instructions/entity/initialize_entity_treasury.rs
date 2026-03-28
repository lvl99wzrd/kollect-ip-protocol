use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use ip_core::state::entity::Entity;

use crate::error::KollectError;
use crate::events::EntityTreasuryInitialized;
use crate::state::{EntityTreasury, PlatformConfig};
use crate::utils::seeds::{ENTITY_TREASURY_SEED, PLATFORM_CONFIG_SEED};

#[derive(Accounts)]
pub struct InitializeEntityTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        owner = ip_core::ID @ KollectError::InvalidIpCoreAccount,
    )]
    pub entity: Account<'info, Entity>,

    #[account(
        init,
        payer = payer,
        space = EntityTreasury::SIZE,
        seeds = [ENTITY_TREASURY_SEED, entity.key().as_ref()],
        bump,
    )]
    pub entity_treasury: Account<'info, EntityTreasury>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == payer.key() @ KollectError::InvalidAuthority,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(
        constraint = currency_mint.key() == config.currency @ KollectError::InvalidCurrency,
    )]
    pub currency_mint: Account<'info, Mint>,

    /// ATA for the entity treasury to hold currency tokens.
    #[account(
        init,
        payer = payer,
        associated_token::mint = currency_mint,
        associated_token::authority = entity_treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeEntityTreasury>, authority: Pubkey) -> Result<()> {
    let entity = &ctx.accounts.entity;

    let treasury = &mut ctx.accounts.entity_treasury;
    treasury.entity = entity.key();
    treasury.authority = authority;
    treasury.total_earned = 0;
    treasury.total_withdrawn = 0;
    treasury.bump = ctx.bumps.entity_treasury;

    emit!(EntityTreasuryInitialized {
        entity_treasury: treasury.key(),
        entity: entity.key(),
        authority,
    });

    Ok(())
}
