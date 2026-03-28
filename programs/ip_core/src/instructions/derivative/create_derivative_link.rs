use anchor_lang::prelude::*;

use crate::error::IpCoreError;
use crate::events::DerivativeLinkCreated;
use crate::state::{DerivativeLink, Entity, IpAccount, DERIVATIVE_LINK_SIZE};
use crate::utils::seeds::{DERIVATIVE_SEED, ENTITY_SEED, IP_SEED};
use crate::utils::validation::validate_derivative_grant_cpi;

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
        seeds = [ENTITY_SEED, child_owner_entity.creator.as_ref(), &child_owner_entity.index.to_le_bytes()],
        bump = child_owner_entity.bump
    )]
    pub child_owner_entity: Account<'info, Entity>,

    /// The child owner entity controller (must sign).
    #[account(
        constraint = controller.key() == child_owner_entity.controller @ IpCoreError::Unauthorized
    )]
    pub controller: Signer<'info>,

    /// The license grant account (owned by external license program).
    /// CHECK: Validated by the license program via CPI.
    pub license_grant: UncheckedAccount<'info>,

    /// The license account (owned by external license program).
    /// CHECK: Validated by the license program via CPI.
    pub license: UncheckedAccount<'info>,

    /// The license program to invoke for validation.
    /// CHECK: The CPI call itself validates this is a valid program with the expected instruction.
    pub license_program: UncheckedAccount<'info>,

    /// Payer for account creation.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Create a derivative link between parent and child IPs.
///
/// Delegates license validation to the license program via CPI.
///
/// # Arguments
/// * `ctx` - Context containing accounts
///
/// # Errors
/// * `IpCoreError::Unauthorized` - Signer is not the child owner entity controller
/// * Any error propagated from the license program's `validate_derivative_grant`
pub fn handler(ctx: Context<CreateDerivativeLink>) -> Result<()> {
    // Validate license grant via CPI to the license program
    validate_derivative_grant_cpi(
        &ctx.accounts.license_program.to_account_info(),
        &ctx.accounts.license_grant.to_account_info(),
        &ctx.accounts.license.to_account_info(),
        &ctx.accounts.parent_ip.to_account_info(),
        &ctx.accounts.child_owner_entity.to_account_info(),
    )?;

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize derivative link
    let link = &mut ctx.accounts.derivative_link;
    link.parent_ip = ctx.accounts.parent_ip.key();
    link.child_ip = ctx.accounts.child_ip.key();
    link.license = ctx.accounts.license_grant.key();
    link.created_at = now;
    link.bump = ctx.bumps.derivative_link;

    emit!(DerivativeLinkCreated {
        derivative_link: ctx.accounts.derivative_link.key(),
        parent_ip: ctx.accounts.parent_ip.key(),
        child_ip: ctx.accounts.child_ip.key(),
        license_grant: ctx.accounts.license_grant.key(),
        child_owner_entity: ctx.accounts.child_owner_entity.key(),
        created_at: now,
    });

    msg!("Derivative link created");

    Ok(())
}
