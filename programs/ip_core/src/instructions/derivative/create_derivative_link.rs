use anchor_lang::prelude::*;

use crate::error::IpCoreError;
use crate::events::DerivativeLinkCreated;
use crate::state::{DerivativeLink, Entity, IpAccount, DERIVATIVE_LINK_SIZE};
use crate::utils::seeds::{DERIVATIVE_SEED, ENTITY_SEED, IP_SEED};

/// License account data structure (from license program).
/// Used for deserializing and validating license terms.
#[derive(AnchorDeserialize)]
pub struct LicenseData {
    /// The IP this license is for.
    pub origin_ip: Pubkey,
    /// The authority entity.
    pub authority: Pubkey,
    /// Whether derivatives are allowed.
    pub derivatives_allowed: bool,
    /// Created at timestamp.
    pub created_at: i64,
    /// Bump seed.
    pub bump: u8,
}

/// LicenseGrant account data structure (from license program).
/// Used for deserializing and validating grant details.
#[derive(AnchorDeserialize)]
pub struct LicenseGrantData {
    /// The license this grant is for.
    pub license: Pubkey,
    /// The entity that has been granted rights.
    pub grantee: Pubkey,
    /// Unix timestamp when this grant was created.
    pub granted_at: i64,
    /// Expiration timestamp (0 = no expiration).
    pub expiration: i64,
    /// Bump seed.
    pub bump: u8,
}

/// Accounts required for create_derivative_link instruction.
#[derive(Accounts)]
pub struct CreateDerivativeLink<'info> {
    /// The derivative link account to create (PDA).
    #[account(
        init,
        payer = payer,
        space = DERIVATIVE_LINK_SIZE,
        seeds = [DERIVATIVE_SEED, parent_ip.key().as_ref(), child_ip.key().as_ref()],
        bump
    )]
    pub derivative_link: Account<'info, DerivativeLink>,

    /// The parent IP.
    #[account(
        seeds = [IP_SEED, parent_ip.registrant_entity.as_ref(), &parent_ip.content_hash],
        bump = parent_ip.bump
    )]
    pub parent_ip: Account<'info, IpAccount>,

    /// The child IP (derivative).
    #[account(
        seeds = [IP_SEED, child_ip.registrant_entity.as_ref(), &child_ip.content_hash],
        bump = child_ip.bump,
        constraint = child_ip.current_owner_entity == child_owner_entity.key() @ IpCoreError::InvalidOwnership
    )]
    pub child_ip: Account<'info, IpAccount>,

    /// The owner entity of the child IP.
    #[account(
        seeds = [ENTITY_SEED, child_owner_entity.creator.as_ref(), &child_owner_entity.handle],
        bump = child_owner_entity.bump
    )]
    pub child_owner_entity: Account<'info, Entity>,

    /// The child owner entity controller (must sign).
    #[account(
        constraint = controller.key() == child_owner_entity.controller @ IpCoreError::Unauthorized
    )]
    pub controller: Signer<'info>,

    /// The license grant account (owned by external license program).
    /// CHECK: We validate the owner and deserialize the required fields.
    pub license_grant: UncheckedAccount<'info>,

    /// The license account (owned by external license program).
    /// CHECK: We validate the owner and deserialize the required fields.
    pub license: UncheckedAccount<'info>,

    /// Payer for account creation.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Create a derivative link between parent and child IPs.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `license_program_id` - Expected owner of the license accounts
///
/// # Errors
/// * `IpCoreError::Unauthorized` - Signer is not the child owner entity controller
/// * `IpCoreError::InvalidLicenseOwner` - License not owned by license program
/// * `IpCoreError::InvalidLicenseOrigin` - License doesn't reference parent IP
/// * `IpCoreError::DerivativesNotAllowed` - License doesn't allow derivatives
/// * `IpCoreError::LicenseExpired` - License grant has expired
pub fn handler(ctx: Context<CreateDerivativeLink>, license_program_id: Pubkey) -> Result<()> {
    let child_owner = &ctx.accounts.child_owner_entity;
    let parent_ip = &ctx.accounts.parent_ip;
    let license_grant_info = &ctx.accounts.license_grant;
    let license_info = &ctx.accounts.license;

    // 1. Validate LicenseGrant account owner equals LICENSE_PROGRAM_ID
    if license_grant_info.owner != &license_program_id {
        return Err(IpCoreError::InvalidLicenseOwner.into());
    }

    // 2. Validate License account owner equals LICENSE_PROGRAM_ID
    if license_info.owner != &license_program_id {
        return Err(IpCoreError::InvalidLicenseOwner.into());
    }

    // Deserialize license grant data (skip 8-byte discriminator)
    let license_grant_data = license_grant_info.try_borrow_data()?;
    if license_grant_data.len() < 8 {
        return Err(IpCoreError::InvalidLicenseOwner.into());
    }
    let license_grant: LicenseGrantData =
        LicenseGrantData::try_from_slice(&license_grant_data[8..])?;

    // Deserialize license data (skip 8-byte discriminator)
    let license_data = license_info.try_borrow_data()?;
    if license_data.len() < 8 {
        return Err(IpCoreError::InvalidLicenseOwner.into());
    }
    let license: LicenseData = LicenseData::try_from_slice(&license_data[8..])?;

    // 3. Validate LicenseGrant.license references the License account
    if license_grant.license != license_info.key() {
        return Err(IpCoreError::InvalidLicenseOrigin.into());
    }

    // 4. Validate License.origin_ip references parent IP
    if license.origin_ip != parent_ip.key() {
        return Err(IpCoreError::InvalidLicenseOrigin.into());
    }

    // 5. Validate derivatives are allowed
    if !license.derivatives_allowed {
        return Err(IpCoreError::DerivativesNotAllowed.into());
    }

    // 6. Validate license grant hasn't expired
    if license_grant.expiration != 0 {
        let clock = Clock::get()?;
        if license_grant.expiration < clock.unix_timestamp {
            return Err(IpCoreError::LicenseExpired.into());
        }
    }

    // 7. Validate LicenseGrant.grantee matches child owner entity
    if license_grant.grantee != child_owner.key() {
        return Err(IpCoreError::InvalidOwnership.into());
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize derivative link
    let link = &mut ctx.accounts.derivative_link;
    link.parent_ip = parent_ip.key();
    link.child_ip = ctx.accounts.child_ip.key();
    link.license = license_grant_info.key();
    link.created_at = now;
    link.bump = ctx.bumps.derivative_link;

    emit!(DerivativeLinkCreated {
        derivative_link: ctx.accounts.derivative_link.key(),
        parent_ip: parent_ip.key(),
        child_ip: ctx.accounts.child_ip.key(),
        license_grant: license_grant_info.key(),
        child_owner_entity: child_owner.key(),
        created_at: now,
    });

    msg!("Derivative link created");

    Ok(())
}
