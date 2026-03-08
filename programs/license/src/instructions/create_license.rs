use anchor_lang::prelude::*;
use ip_core::state::{Entity, IpAccount};

use crate::constants::LICENSE_SEED;
use crate::error::LicenseError;
use crate::events::LicenseCreated;
use crate::state::{License, LICENSE_SIZE};
use crate::utils::validation::{extract_signer_keys, validate_multisig_keys};

/// Accounts required for create_license instruction.
#[derive(Accounts)]
pub struct CreateLicense<'info> {
    /// The license account to create (PDA).
    #[account(
        init,
        payer = payer,
        space = LICENSE_SIZE,
        seeds = [LICENSE_SEED, origin_ip.key().as_ref()],
        bump
    )]
    pub license: Account<'info, License>,

    /// The IP account to create a license for.
    /// Must be owned by ip_core program.
    pub origin_ip: Account<'info, IpAccount>,

    /// The owner entity of the IP.
    /// Must match origin_ip.current_owner_entity.
    #[account(
        constraint = owner_entity.key() == origin_ip.current_owner_entity @ LicenseError::InvalidAuthority
    )]
    pub owner_entity: Account<'info, Entity>,

    /// Optional: DerivativeLink account to check if this IP is a derivative.
    /// If this account exists where child_ip == origin_ip, creation fails.
    /// CHECK: We only check if it exists and is initialized to determine derivative status.
    pub derivative_check: Option<UncheckedAccount<'info>>,

    /// Payer for account creation.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
    // Remaining accounts are signers (owner entity controllers)
}

/// Create a new license for an IP.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `derivatives_allowed` - Whether this license allows derivative creation
/// * `ip_core_program_id` - The ip_core program ID for validation
///
/// # Errors
/// * `LicenseError::InsufficientSignatures` - Owner entity multisig threshold not met
/// * `LicenseError::DerivativeCannotCreateLicense` - Origin IP is a derivative
/// * `LicenseError::InvalidOriginIp` - Origin IP is not owned by ip_core
pub fn handler(
    ctx: Context<CreateLicense>,
    derivatives_allowed: bool,
    ip_core_program_id: Pubkey,
) -> Result<()> {
    let origin_ip = &ctx.accounts.origin_ip;
    let owner_entity = &ctx.accounts.owner_entity;

    // Validate origin IP is owned by ip_core
    if origin_ip.to_account_info().owner != &ip_core_program_id {
        return Err(LicenseError::InvalidOriginIp.into());
    }

    // Validate owner entity is owned by ip_core
    if owner_entity.to_account_info().owner != &ip_core_program_id {
        return Err(LicenseError::InvalidAuthority.into());
    }

    // Validate owner entity multisig
    let signer_keys = extract_signer_keys(ctx.remaining_accounts);
    validate_multisig_keys(
        &signer_keys,
        &owner_entity.controllers,
        owner_entity.signature_threshold,
    )?;

    // Check if origin IP is a derivative (has a DerivativeLink where child_ip == origin_ip)
    // If derivative_check account is provided and exists, the IP is a derivative
    if let Some(derivative_check) = &ctx.accounts.derivative_check {
        // If the account exists and has data, it's a derivative
        if !derivative_check.data_is_empty() {
            return Err(LicenseError::DerivativeCannotCreateLicense.into());
        }
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize license
    let license = &mut ctx.accounts.license;
    license.origin_ip = origin_ip.key();
    license.authority = owner_entity.key();
    license.derivatives_allowed = derivatives_allowed;
    license.created_at = now;
    license.bump = ctx.bumps.license;

    emit!(LicenseCreated {
        license: ctx.accounts.license.key(),
        origin_ip: origin_ip.key(),
        authority: owner_entity.key(),
        derivatives_allowed,
        created_at: now,
    });

    msg!("License created for IP: {:?}", origin_ip.key());

    Ok(())
}
