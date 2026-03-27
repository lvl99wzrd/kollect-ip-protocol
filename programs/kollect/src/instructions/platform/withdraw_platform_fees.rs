use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::KollectError;
use crate::events::PlatformFeesWithdrawn;
use crate::state::{PlatformConfig, PlatformTreasury};
use crate::utils::seeds::{PLATFORM_CONFIG_SEED, PLATFORM_TREASURY_SEED};

#[derive(Accounts)]
pub struct WithdrawPlatformFees<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(
        seeds = [PLATFORM_TREASURY_SEED],
        bump = treasury.bump,
        constraint = treasury.authority == authority.key() @ KollectError::InvalidAuthority,
    )]
    pub treasury: Account<'info, PlatformTreasury>,

    #[account(
        mut,
        token::authority = treasury,
        token::mint = config.currency,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<WithdrawPlatformFees>, amount: u64) -> Result<()> {
    let treasury = &ctx.accounts.treasury;

    let seeds = &[PLATFORM_TREASURY_SEED, &[treasury.bump]];
    let signer_seeds = &[&seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.treasury_token_account.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: treasury.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    emit!(PlatformFeesWithdrawn {
        treasury: treasury.key(),
        amount,
        destination: ctx.accounts.destination.key(),
    });

    Ok(())
}
