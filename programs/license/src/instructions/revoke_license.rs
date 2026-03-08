use anchor_lang::prelude::*;
use ip_core::state::Entity;

use crate::constants::LICENSE_SEED;
use crate::error::LicenseError;
use crate::events::LicenseRevoked;
use crate::state::License;
use crate::utils::validation::{extract_signer_keys, validate_multisig_keys};

/// Accounts required for revoke_license instruction.
#[derive(Accounts)]
pub struct RevokeLicense<'info> {
    /// The license account to close.
    #[account(
        mut,
        seeds = [LICENSE_SEED, license.origin_ip.as_ref()],
        bump = license.bump,
        constraint = license.authority == authority_entity.key() @ LicenseError::InvalidAuthority,
        close = rent_destination
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

/// Revoke a license by closing its account.
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
/// This instruction closes the license account and returns rent to rent_destination.
/// Consider that this should only be allowed if no active grants exist.
pub fn handler(ctx: Context<RevokeLicense>, ip_core_program_id: Pubkey) -> Result<()> {
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

    // Note: In a production system, you may want to check that no active grants exist
    // before allowing license revocation. This would require iterating through grants
    // or maintaining a counter, which adds complexity.

    // Emit event BEFORE the account is closed (close happens after handler returns)
    emit!(LicenseRevoked {
        license: ctx.accounts.license.key(),
        origin_ip: ctx.accounts.license.origin_ip,
        authority: authority_entity.key(),
        rent_destination: ctx.accounts.rent_destination.key(),
    });

    msg!("License revoked");

    Ok(())
}
