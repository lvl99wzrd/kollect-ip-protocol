use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use ip_core::state::entity::Entity;

use crate::error::KollectError;
use crate::events::IpTreasuryWithdrawn;
use crate::state::{EntityTreasury, IpConfig, IpTreasury, PlatformConfig};
use crate::utils::seeds::{
    ENTITY_TREASURY_SEED, IP_CONFIG_SEED, IP_TREASURY_SEED, PLATFORM_CONFIG_SEED,
};
use crate::utils::validation::validate_entity_controller;

#[derive(Accounts)]
pub struct WithdrawIpTreasury<'info> {
    pub authority: Signer<'info>,

    #[account(
        owner = ip_core::ID @ KollectError::InvalidIpCoreAccount,
    )]
    pub entity: Account<'info, Entity>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(
        seeds = [IP_CONFIG_SEED, ip_config.ip_account.as_ref()],
        bump = ip_config.bump,
        constraint = ip_config.owner_entity == entity.key() @ KollectError::IpOwnerMismatch,
    )]
    pub ip_config: Account<'info, IpConfig>,

    #[account(
        mut,
        seeds = [IP_TREASURY_SEED, ip_config.ip_account.as_ref()],
        bump = ip_treasury.bump,
        constraint = ip_treasury.entity_treasury == entity_treasury.key() @ KollectError::EntityTreasuryNotInitialized,
    )]
    pub ip_treasury: Account<'info, IpTreasury>,

    #[account(
        mut,
        seeds = [ENTITY_TREASURY_SEED, entity.key().as_ref()],
        bump = entity_treasury.bump,
    )]
    pub entity_treasury: Account<'info, EntityTreasury>,

    #[account(
        mut,
        token::authority = ip_treasury,
        token::mint = config.currency,
    )]
    pub ip_treasury_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::authority = entity_treasury,
        token::mint = config.currency,
    )]
    pub entity_treasury_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    // remaining_accounts: entity controller signer
}

pub fn handler(ctx: Context<WithdrawIpTreasury>, amount: u64) -> Result<()> {
    let entity = &ctx.accounts.entity;
    validate_entity_controller(entity, ctx.remaining_accounts)?;

    let ip_treasury = &mut ctx.accounts.ip_treasury;
    let entity_treasury = &mut ctx.accounts.entity_treasury;

    let available = ip_treasury
        .total_earned
        .checked_sub(ip_treasury.total_settled)
        .ok_or(KollectError::ArithmeticOverflow)?;
    require!(amount <= available, KollectError::InsufficientPayment);

    // Update counters
    ip_treasury.total_settled = ip_treasury
        .total_settled
        .checked_add(amount)
        .ok_or(KollectError::ArithmeticOverflow)?;

    entity_treasury.total_earned = entity_treasury
        .total_earned
        .checked_add(amount)
        .ok_or(KollectError::ArithmeticOverflow)?;

    // PDA-signed transfer from ip_treasury ATA → entity_treasury ATA
    let ip_account_key = ip_treasury.ip_account;
    let bump = ip_treasury.bump;
    let seeds = &[IP_TREASURY_SEED, ip_account_key.as_ref(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.ip_treasury_token_account.to_account_info(),
                to: ctx.accounts.entity_treasury_token_account.to_account_info(),
                authority: ip_treasury.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    emit!(IpTreasuryWithdrawn {
        ip_treasury: ip_treasury.key(),
        entity_treasury: entity_treasury.key(),
        amount,
    });

    Ok(())
}
