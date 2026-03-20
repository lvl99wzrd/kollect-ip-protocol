use anchor_lang::prelude::*;

use crate::error::IpCoreError;
use crate::events::DerivativeLicenseUpdated;
use crate::state::{DerivativeLink, Entity, IpAccount};
use crate::utils::seeds::{DERIVATIVE_SEED, ENTITY_SEED, IP_SEED};

use super::create_derivative_link::{LicenseData, LicenseGrantData};

/// Accounts required for update_derivative_license instruction.
#[derive(Accounts)]
pub struct UpdateDerivativeLicense<'info> {
    /// The derivative link to update.
    #[account(
        mut,
        seeds = [DERIVATIVE_SEED, derivative_link.parent_ip.as_ref(), derivative_link.child_ip.as_ref()],
        bump = derivative_link.bump
    )]
    pub derivative_link: Account<'info, DerivativeLink>,

    /// The child IP (for ownership verification).
    #[account(
        seeds = [IP_SEED, child_ip.registrant_entity.as_ref(), &child_ip.content_hash],
        bump = child_ip.bump,
        constraint = child_ip.key() == derivative_link.child_ip @ IpCoreError::InvalidOwnership,
        constraint = child_ip.current_owner_entity == child_owner_entity.key() @ IpCoreError::InvalidOwnership
    )]
    pub child_ip: Account<'info, IpAccount>,

    /// The owner entity of the child IP.
    #[account(
        seeds = [ENTITY_SEED, child_owner_entity.creator.as_ref(), &child_owner_entity.index.to_le_bytes()],
        bump = child_owner_entity.bump
    )]
    pub child_owner_entity: Account<'info, Entity>,

    /// The parent IP (for license validation).
    #[account(
        seeds = [IP_SEED, parent_ip.registrant_entity.as_ref(), &parent_ip.content_hash],
        bump = parent_ip.bump,
        constraint = parent_ip.key() == derivative_link.parent_ip @ IpCoreError::InvalidOwnership
    )]
    pub parent_ip: Account<'info, IpAccount>,

    /// The new license grant account (owned by external license program).
    /// CHECK: We validate the owner and deserialize the required fields.
    pub new_license_grant: UncheckedAccount<'info>,

    /// The new license account (owned by external license program).
    /// CHECK: We validate the owner and deserialize the required fields.
    pub new_license: UncheckedAccount<'info>,

    /// The child owner entity controller (must sign).
    #[account(
        constraint = controller.key() == child_owner_entity.controller @ IpCoreError::Unauthorized
    )]
    pub controller: Signer<'info>,
}

/// Update the license on a derivative link.
///
/// ONLY mutates the `license` field. All other fields remain immutable.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `license_program_id` - Expected owner of the license account
///
/// # Errors
/// * `IpCoreError::Unauthorized` - Controller signature verification failed
/// * `IpCoreError::InvalidLicenseOwner` - License not owned by license program
/// * `IpCoreError::InvalidLicenseOrigin` - License doesn't reference parent IP
/// * `IpCoreError::DerivativesNotAllowed` - License doesn't allow derivatives
/// * `IpCoreError::LicenseExpired` - License has expired
/// * `IpCoreError::LicenseGrantMismatch` - License grant doesn't reference correct license
/// * `IpCoreError::InvalidGrantee` - Child owner entity is not the grantee
pub fn handler(ctx: Context<UpdateDerivativeLicense>, license_program_id: Pubkey) -> Result<()> {
    let child_owner = &ctx.accounts.child_owner_entity;
    let parent_ip = &ctx.accounts.parent_ip;
    let new_license_grant_info = &ctx.accounts.new_license_grant;
    let new_license_info = &ctx.accounts.new_license;

    // 1. Validate license grant owner
    if new_license_grant_info.owner != &license_program_id {
        return Err(IpCoreError::InvalidLicenseOwner.into());
    }

    // 2. Validate license owner
    if new_license_info.owner != &license_program_id {
        return Err(IpCoreError::InvalidLicenseOwner.into());
    }

    // 3. Deserialize license grant data (skip 8-byte discriminator)
    let license_grant_data = new_license_grant_info.try_borrow_data()?;
    if license_grant_data.len() < 8 {
        return Err(IpCoreError::InvalidLicenseOwner.into());
    }
    let license_grant: LicenseGrantData =
        LicenseGrantData::try_from_slice(&license_grant_data[8..])?;

    // 4. Validate license grant references the correct license
    if license_grant.license != new_license_info.key() {
        return Err(IpCoreError::LicenseGrantMismatch.into());
    }

    // 5. Validate grantee matches child owner entity
    if license_grant.grantee != child_owner.key() {
        return Err(IpCoreError::InvalidGrantee.into());
    }

    // 6. Deserialize license data (skip 8-byte discriminator)
    let license_data = new_license_info.try_borrow_data()?;
    if license_data.len() < 8 {
        return Err(IpCoreError::InvalidLicenseOwner.into());
    }
    let license: LicenseData = LicenseData::try_from_slice(&license_data[8..])?;

    // 7. Validate license references parent IP
    if license.origin_ip != parent_ip.key() {
        return Err(IpCoreError::InvalidLicenseOrigin.into());
    }

    // 8. Validate derivatives are allowed
    if !license.derivatives_allowed {
        return Err(IpCoreError::DerivativesNotAllowed.into());
    }

    // 9. Validate license grant hasn't expired
    if license_grant.expiration != 0 {
        let clock = Clock::get()?;
        if license_grant.expiration < clock.unix_timestamp {
            return Err(IpCoreError::LicenseExpired.into());
        }
    }

    let link = &mut ctx.accounts.derivative_link;

    // Capture old license before mutation
    let old_license_grant = link.license;

    // ONLY update license field (to the license grant)
    link.license = new_license_grant_info.key();

    emit!(DerivativeLicenseUpdated {
        derivative_link: link.key(),
        child_ip: ctx.accounts.child_ip.key(),
        old_license_grant,
        new_license_grant: new_license_grant_info.key(),
        authority: child_owner.key(),
    });

    msg!("Derivative license updated");

    Ok(())
}
