use anchor_lang::prelude::*;

use crate::events::ConfigInitialized;
use crate::state::{ProtocolConfig, PROTOCOL_CONFIG_SIZE};
use crate::utils::seeds::CONFIG_SEED;

/// Accounts required for initialize_config instruction.
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    /// The config account to initialize (PDA).
    #[account(
        init,
        payer = authority,
        space = PROTOCOL_CONFIG_SIZE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// The authority that will control the protocol config.
    /// Also pays for account creation.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Initialize protocol configuration.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `treasury` - The treasury PDA pubkey
/// * `registration_currency` - SPL token mint for registration fees
/// * `registration_fee` - Fee amount required for IP registration
///
/// # Errors
/// Returns error if config already exists (handled by Anchor init constraint)
pub fn handler(
    ctx: Context<InitializeConfig>,
    treasury: Pubkey,
    registration_currency: Pubkey,
    registration_fee: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    config.authority = ctx.accounts.authority.key();
    config.treasury = treasury;
    config.registration_currency = registration_currency;
    config.registration_fee = registration_fee;
    config.bump = ctx.bumps.config;

    emit!(ConfigInitialized {
        config: ctx.accounts.config.key(),
        authority: ctx.accounts.authority.key(),
        treasury,
        registration_currency,
        registration_fee,
    });

    msg!("Protocol config initialized");

    Ok(())
}
