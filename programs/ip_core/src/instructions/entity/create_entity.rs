//! Create entity instruction.
//!
//! Creates a new entity with the creator as the first controller.

use anchor_lang::prelude::*;

use crate::constants::{MAX_CONTROLLERS, MAX_HANDLE_LENGTH};
use crate::error::IpCoreError;
use crate::state::{Entity, ENTITY_SIZE};
use crate::utils::seeds::ENTITY_SEED;
use crate::utils::validation::{validate_handle, validate_threshold};

/// Accounts required for create_entity instruction.
#[derive(Accounts)]
#[instruction(handle: [u8; MAX_HANDLE_LENGTH])]
pub struct CreateEntity<'info> {
    /// The entity account to create (PDA).
    #[account(
        init,
        payer = creator,
        space = ENTITY_SIZE,
        seeds = [ENTITY_SEED, creator.key().as_ref(), &handle],
        bump
    )]
    pub entity: Account<'info, Entity>,

    /// The creator of this entity (must sign).
    /// Also pays for account creation.
    #[account(mut)]
    pub creator: Signer<'info>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Create a new entity.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `handle` - Unique handle for this entity (lowercase alphanumeric, 1-32 chars)
/// * `additional_controllers` - Additional controller pubkeys (optional, max 4 since creator is first)
/// * `signature_threshold` - Required number of signatures (1 to total controllers)
///
/// # Errors
/// * `IpCoreError::InvalidHandle` - Handle contains invalid characters
/// * `IpCoreError::HandleTooLong` - Handle exceeds 32 characters
/// * `IpCoreError::EmptyHandle` - Handle is empty
/// * `IpCoreError::InvalidThreshold` - Threshold is invalid
/// * `IpCoreError::ControllerLimitExceeded` - Too many controllers
pub fn handler(
    ctx: Context<CreateEntity>,
    handle: [u8; MAX_HANDLE_LENGTH],
    additional_controllers: Vec<Pubkey>,
    signature_threshold: u8,
) -> Result<()> {
    // Validate handle format
    validate_handle(&handle)?;

    // Build controllers list with creator first
    let mut controllers = vec![ctx.accounts.creator.key()];
    controllers.extend(additional_controllers);

    // Validate controller count
    if controllers.len() > MAX_CONTROLLERS {
        return Err(IpCoreError::ControllerLimitExceeded.into());
    }

    // Validate threshold
    validate_threshold(signature_threshold, controllers.len())?;

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize entity
    let entity = &mut ctx.accounts.entity;
    entity.creator = ctx.accounts.creator.key();
    entity.handle = handle;
    entity.controllers = controllers;
    entity.signature_threshold = signature_threshold;
    entity.current_metadata_revision = 0;
    entity.created_at = now;
    entity.updated_at = now;
    entity.bump = ctx.bumps.entity;

    msg!("Entity created");

    Ok(())
}
