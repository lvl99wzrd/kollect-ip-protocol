use anchor_lang::prelude::*;

use crate::error::KollectError;
use crate::state::{License, LicenseGrant};

/// CPI handler invoked by ip_core's `validate_derivative_grant`.
///
/// ip_core passes exactly 4 accounts in the CPI instruction:
///   [0] license_grant  (owned by kollect) → consumed as `placeholder`
///   [1] license        (owned by kollect) → remaining_accounts[0]
///   [2] parent_ip      (owned by ip_core) → remaining_accounts[1]
///   [3] grantee_entity (owned by ip_core) → remaining_accounts[2]
///
/// This handler validates that the license grant is valid for
/// the derivative operation. `derivatives_allowed` is purely
/// descriptive and is NOT enforced here.
pub fn handler<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ValidateDerivativeGrant<'info>>,
) -> Result<()> {
    let remaining = ctx.remaining_accounts;
    require!(remaining.len() >= 3, KollectError::InvalidDerivativeLink);

    // placeholder is the first CPI account (license_grant)
    let license_grant_info = &ctx.accounts.placeholder;
    let license_info = &remaining[0];
    let parent_ip_info = &remaining[1];
    let grantee_entity_info = &remaining[2];

    // Verify ownership
    require!(
        license_grant_info.owner == ctx.program_id,
        KollectError::InvalidIpCoreAccount
    );
    require!(
        license_info.owner == ctx.program_id,
        KollectError::InvalidIpCoreAccount
    );

    // Deserialize
    let grant_data = license_grant_info.try_borrow_data()?;
    let grant = LicenseGrant::try_deserialize(&mut &grant_data[..])
        .map_err(|_| error!(KollectError::InvalidLicenseTemplate))?;

    let license_data = license_info.try_borrow_data()?;
    let license = License::try_deserialize(&mut &license_data[..])
        .map_err(|_| error!(KollectError::InvalidLicenseTemplate))?;

    // Validate relationships
    require!(
        grant.license == license_info.key(),
        KollectError::InvalidLicenseTemplate
    );
    require!(
        license.ip_account == parent_ip_info.key(),
        KollectError::InvalidLicenseTemplate
    );
    require!(
        grant.grantee == grantee_entity_info.key(),
        KollectError::InvalidLicenseTemplate
    );

    // License must be active
    require!(license.is_active, KollectError::LicenseNotActive);

    // Check expiration (0 = perpetual)
    if grant.expiration != 0 {
        let clock = Clock::get()?;
        require!(
            grant.expiration > clock.unix_timestamp,
            KollectError::LicenseExpired
        );
    }

    Ok(())
}

#[derive(Accounts)]
pub struct ValidateDerivativeGrant<'info> {
    /// CHECK: This instruction is invoked via CPI from ip_core.
    /// The accounts are passed as remaining_accounts and validated manually.
    pub placeholder: UncheckedAccount<'info>,
}
