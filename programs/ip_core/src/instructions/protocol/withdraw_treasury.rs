//! Withdraw from protocol treasury instruction.
//!
//! Transfers tokens from a treasury-owned SPL token account.

use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

use crate::error::IpCoreError;
use crate::state::ProtocolTreasury;
use crate::utils::seeds::TREASURY_SEED;

/// Accounts required for withdraw_treasury instruction.
#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    /// The treasury account (PDA authority for token accounts).
    #[account(
        seeds = [TREASURY_SEED],
        bump = treasury.bump,
        has_one = authority @ IpCoreError::InvalidAuthority
    )]
    pub treasury: Account<'info, ProtocolTreasury>,

    /// The treasury's SPL token account to withdraw from.
    #[account(
        mut,
        constraint = treasury_token_account.owner == treasury.key() @ IpCoreError::InvalidTreasuryAuthority
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    /// The destination SPL token account.
    #[account(mut)]
    pub destination_token_account: Account<'info, TokenAccount>,

    /// The treasury authority (must sign).
    pub authority: Signer<'info>,

    /// SPL Token program.
    pub token_program: Program<'info, Token>,
}

/// Withdraw tokens from treasury.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `amount` - Amount of tokens to withdraw
///
/// # Errors
/// * `IpCoreError::InvalidAuthority` - Signer is not the treasury authority
/// * `IpCoreError::InvalidTreasuryAuthority` - Token account not owned by treasury
pub fn handler(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
    let treasury = &ctx.accounts.treasury;
    let treasury_bump = treasury.bump;

    // Create signer seeds for the treasury PDA
    let signer_seeds: &[&[&[u8]]] = &[&[TREASURY_SEED, &[treasury_bump]]];

    // Transfer tokens from treasury to destination
    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.treasury_token_account.to_account_info(),
                to: ctx.accounts.destination_token_account.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    msg!("Withdrawn {} tokens from treasury", amount);

    Ok(())
}
