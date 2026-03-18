use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::KollectError;
use crate::events::EntityEarningsWithdrawn;
use crate::state::EntityTreasury;
use crate::utils::seeds::ENTITY_TREASURY_SEED;

#[derive(Accounts)]
pub struct WithdrawEntityEarnings<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ENTITY_TREASURY_SEED, entity_treasury.entity.as_ref()],
        bump = entity_treasury.bump,
        constraint = entity_treasury.authority == authority.key() @ KollectError::InvalidAuthority,
    )]
    pub entity_treasury: Account<'info, EntityTreasury>,

    #[account(
        mut,
        token::authority = entity_treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawEntityEarnings>, amount: u64) -> Result<()> {
    let entity_treasury = &mut ctx.accounts.entity_treasury;
    let entity_key = entity_treasury.entity;
    let bump = entity_treasury.bump;

    entity_treasury.total_withdrawn = entity_treasury
        .total_withdrawn
        .checked_add(amount)
        .ok_or(KollectError::ArithmeticOverflow)?;

    let seeds = &[ENTITY_TREASURY_SEED, entity_key.as_ref(), &[bump]];
    let signer_seeds = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.treasury_token_account.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: entity_treasury.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    emit!(EntityEarningsWithdrawn {
        entity_treasury: entity_treasury.key(),
        amount,
        destination: ctx.accounts.destination.key(),
    });

    Ok(())
}
