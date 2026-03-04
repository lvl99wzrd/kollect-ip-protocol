//! Update protocol configuration instruction.
//!
//! Updates the singleton ProtocolConfig account.

use anchor_lang::prelude::*;

use crate::error::IpCoreError;
use crate::state::ProtocolConfig;
use crate::utils::seeds::CONFIG_SEED;

/// Accounts required for update_config instruction.
#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    /// The config account to update.
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ IpCoreError::InvalidAuthority
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// The current authority (must sign).
    pub authority: Signer<'info>,
}

/// Parameters for updating the config.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateConfigParams {
    /// New authority (optional).
    pub new_authority: Option<Pubkey>,

    /// New treasury PDA (optional).
    pub new_treasury: Option<Pubkey>,

    /// New registration currency mint (optional).
    pub new_registration_currency: Option<Pubkey>,

    /// New registration fee (optional).
    pub new_registration_fee: Option<u64>,
}

/// Update protocol configuration.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `params` - Update parameters (all optional)
///
/// # Errors
/// * `IpCoreError::InvalidAuthority` - Signer is not the current authority
pub fn handler(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(new_authority) = params.new_authority {
        config.authority = new_authority;
    }

    if let Some(new_treasury) = params.new_treasury {
        config.treasury = new_treasury;
    }

    if let Some(new_registration_currency) = params.new_registration_currency {
        config.registration_currency = new_registration_currency;
    }

    if let Some(new_registration_fee) = params.new_registration_fee {
        config.registration_fee = new_registration_fee;
    }

    msg!("Protocol config updated");

    Ok(())
}
