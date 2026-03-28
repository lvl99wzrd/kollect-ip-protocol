use anchor_lang::prelude::*;

use crate::error::IpCoreError;
use crate::events::DerivativeLicenseUpdated;
use crate::state::{DerivativeLink, Entity, IpAccount};
use crate::utils::seeds::{DERIVATIVE_SEED, ENTITY_SEED, IP_SEED};
use crate::utils::validation::validate_derivative_grant_cpi;

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
    /// CHECK: Validated by the license program via CPI.
    pub new_license_grant: UncheckedAccount<'info>,

    /// The new license account (owned by external license program).
    /// CHECK: Validated by the license program via CPI.
    pub new_license: UncheckedAccount<'info>,

    /// The license program to invoke for validation.
    /// CHECK: The CPI call itself validates this is a valid program with the expected instruction.
    pub license_program: UncheckedAccount<'info>,

    /// The child owner entity controller (must sign).
    #[account(
        constraint = controller.key() == child_owner_entity.controller @ IpCoreError::Unauthorized
    )]
    pub controller: Signer<'info>,
}

/// Update the license on a derivative link.
///
/// ONLY mutates the `license` field. All other fields remain immutable.
/// Delegates license validation to the license program via CPI.
///
/// # Arguments
/// * `ctx` - Context containing accounts
///
/// # Errors
/// * `IpCoreError::Unauthorized` - Controller signature verification failed
/// * Any error propagated from the license program's `validate_derivative_grant`
pub fn handler(ctx: Context<UpdateDerivativeLicense>) -> Result<()> {
    // Validate new license grant via CPI to the license program
    validate_derivative_grant_cpi(
        &ctx.accounts.license_program.to_account_info(),
        &ctx.accounts.new_license_grant.to_account_info(),
        &ctx.accounts.new_license.to_account_info(),
        &ctx.accounts.parent_ip.to_account_info(),
        &ctx.accounts.child_owner_entity.to_account_info(),
    )?;

    let link = &mut ctx.accounts.derivative_link;

    // Capture old license before mutation
    let old_license_grant = link.license;

    // ONLY update license field (to the license grant)
    link.license = ctx.accounts.new_license_grant.key();

    emit!(DerivativeLicenseUpdated {
        derivative_link: link.key(),
        child_ip: ctx.accounts.child_ip.key(),
        old_license_grant,
        new_license_grant: ctx.accounts.new_license_grant.key(),
        authority: ctx.accounts.child_owner_entity.key(),
    });

    msg!("Derivative license updated");

    Ok(())
}
