use anchor_lang::prelude::*;

use crate::error::IpCoreError;
use crate::events::TreasuryInitialized;
use crate::state::{ProtocolConfig, ProtocolTreasury, PROTOCOL_TREASURY_SIZE};
use crate::utils::seeds::{CONFIG_SEED, TREASURY_SEED};

/// Accounts required for initialize_treasury instruction.
#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    /// The treasury account to initialize (PDA).
    #[account(
        init,
        payer = authority,
        space = PROTOCOL_TREASURY_SIZE,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: Account<'info, ProtocolTreasury>,

    /// The protocol configuration account.
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ IpCoreError::InvalidAuthority
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// The config authority (must sign).
    /// Also pays for account creation.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Initialize protocol treasury.
///
/// # Arguments
/// * `ctx` - Context containing accounts
///
/// # Errors
/// * Treasury already initialized (handled by Anchor init constraint)
/// * `IpCoreError::InvalidAuthority` - Signer is not the config authority
pub fn handler(ctx: Context<InitializeTreasury>) -> Result<()> {
    let treasury = &mut ctx.accounts.treasury;

    treasury.authority = ctx.accounts.authority.key();
    treasury.config = ctx.accounts.config.key();
    treasury.bump = ctx.bumps.treasury;

    emit!(TreasuryInitialized {
        treasury: ctx.accounts.treasury.key(),
        authority: ctx.accounts.authority.key(),
        config: ctx.accounts.config.key(),
    });

    msg!("Protocol treasury initialized");

    Ok(())
}
