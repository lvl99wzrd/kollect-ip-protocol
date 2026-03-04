//! Revoke license grant instruction.
//!
//! Closes a license grant account and returns rent to authority signer.

use anchor_lang::prelude::*;
use ip_core::state::Entity;

use crate::constants::{LICENSE_GRANT_SEED, LICENSE_SEED};
use crate::error::LicenseError;
use crate::state::{License, LicenseGrant};
use crate::utils::validation::{extract_signer_keys, validate_multisig_keys};

/// Accounts required for revoke_license_grant instruction.
#[derive(Accounts)]
pub struct RevokeLicenseGrant<'info> {
    /// The license grant account to close.
    #[account(
        mut,
        seeds = [LICENSE_GRANT_SEED, license.key().as_ref(), license_grant.grantee.as_ref()],
        bump = license_grant.bump,
        constraint = license_grant.license == license.key() @ LicenseError::InvalidLicense,
        close = rent_destination
    )]
    pub license_grant: Account<'info, LicenseGrant>,

    /// The license this grant is for.
    #[account(
        seeds = [LICENSE_SEED, license.origin_ip.as_ref()],
        bump = license.bump,
        constraint = license.authority == authority_entity.key() @ LicenseError::InvalidAuthority
    )]
    pub license: Account<'info, License>,

    /// The authority entity (must match license.authority).
    pub authority_entity: Account<'info, Entity>,

    /// Destination for rent refund.
    /// CHECK: This is just the recipient of lamports.
    #[account(mut)]
    pub rent_destination: UncheckedAccount<'info>,

    /// System program.
    pub system_program: Program<'info, System>,
    // Remaining accounts are signers (authority entity controllers)
}

/// Revoke a license grant by closing its account.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `ip_core_program_id` - The ip_core program ID for validation
///
/// # Errors
/// * `LicenseError::InsufficientSignatures` - Authority entity multisig threshold not met
/// * `LicenseError::InvalidAuthority` - Authority entity doesn't match license authority
///
/// # Note
/// This instruction closes the license grant account and returns rent to rent_destination.
/// Grantee consent is NOT required.
pub fn handler(ctx: Context<RevokeLicenseGrant>, ip_core_program_id: Pubkey) -> Result<()> {
    let authority_entity = &ctx.accounts.authority_entity;

    // Validate authority entity is owned by ip_core
    if authority_entity.to_account_info().owner != &ip_core_program_id {
        return Err(LicenseError::InvalidAuthority.into());
    }

    // Validate authority entity multisig
    let signer_keys = extract_signer_keys(ctx.remaining_accounts);
    validate_multisig_keys(
        &signer_keys,
        &authority_entity.controllers,
        authority_entity.signature_threshold,
    )?;

    msg!(
        "License grant revoked for grantee: {:?}",
        ctx.accounts.license_grant.grantee
    );

    Ok(())
}
