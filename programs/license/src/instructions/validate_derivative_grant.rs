use anchor_lang::prelude::*;

use crate::constants::{LICENSE_GRANT_SEED, LICENSE_SEED};
use crate::error::LicenseError;
use crate::state::{License, LicenseGrant};

/// Accounts required for validate_derivative_grant instruction.
///
/// This is a read-only validation endpoint called by ip_core via CPI
/// to verify that a license grant is valid for derivative creation.
#[derive(Accounts)]
pub struct ValidateDerivativeGrant<'info> {
    /// The license grant to validate.
    #[account(
        seeds = [LICENSE_GRANT_SEED, license.key().as_ref(), license_grant.grantee.as_ref()],
        bump = license_grant.bump,
        constraint = license_grant.license == license.key() @ LicenseError::InvalidLicense
    )]
    pub license_grant: Account<'info, LicenseGrant>,

    /// The license referenced by the grant.
    #[account(
        seeds = [LICENSE_SEED, license.origin_ip.as_ref()],
        bump = license.bump
    )]
    pub license: Account<'info, License>,

    /// The parent IP being derived from.
    /// CHECK: Only the key is used; compared against license.origin_ip.
    pub parent_ip: UncheckedAccount<'info>,

    /// The entity claiming the grant.
    /// CHECK: Only the key is used; compared against license_grant.grantee.
    pub grantee_entity: UncheckedAccount<'info>,
}

/// Validate that a license grant permits derivative creation.
///
/// This instruction performs read-only validation and does not mutate any state.
/// It is designed to be called via CPI from ip_core's derivative instructions.
///
/// # Validation
/// 1. License references the parent IP
/// 2. License grant references the grantee entity
/// 3. License allows derivatives
/// 4. License grant has not expired
///
/// # Errors
/// * `LicenseError::InvalidOriginIp` - License does not reference parent IP
/// * `LicenseError::InvalidGrantee` - Grant does not reference grantee entity
/// * `LicenseError::DerivativesNotAllowed` - License does not allow derivatives
/// * `LicenseError::GrantExpired` - License grant has expired
pub fn handler(ctx: Context<ValidateDerivativeGrant>) -> Result<()> {
    let license = &ctx.accounts.license;
    let license_grant = &ctx.accounts.license_grant;
    let parent_ip = &ctx.accounts.parent_ip;
    let grantee_entity = &ctx.accounts.grantee_entity;

    // 1. Validate license references the parent IP
    if license.origin_ip != parent_ip.key() {
        return Err(LicenseError::InvalidOriginIp.into());
    }

    // 2. Validate grant references the grantee entity
    if license_grant.grantee != grantee_entity.key() {
        return Err(LicenseError::InvalidGrantee.into());
    }

    // 3. Validate derivatives are allowed
    if !license.derivatives_allowed {
        return Err(LicenseError::DerivativesNotAllowed.into());
    }

    // 4. Validate grant has not expired
    if license_grant.expiration != 0 {
        let clock = Clock::get()?;
        if license_grant.expiration < clock.unix_timestamp {
            return Err(LicenseError::GrantExpired.into());
        }
    }

    msg!("Derivative grant validated");

    Ok(())
}
