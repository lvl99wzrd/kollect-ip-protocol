use anchor_lang::prelude::*;

use crate::constants::MAX_HANDLE_LENGTH;
use crate::events::EntityCreated;
use crate::state::{Entity, ENTITY_SIZE};
use crate::utils::seeds::ENTITY_SEED;
use crate::utils::validation::validate_handle;

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
///
/// # Errors
/// * `IpCoreError::InvalidHandle` - Handle contains invalid characters
/// * `IpCoreError::HandleTooLong` - Handle exceeds 32 characters
/// * `IpCoreError::EmptyHandle` - Handle is empty
pub fn handler(ctx: Context<CreateEntity>, handle: [u8; MAX_HANDLE_LENGTH]) -> Result<()> {
    // Validate handle format
    validate_handle(&handle)?;

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Capture values needed for event before mutable borrow
    let entity_key = ctx.accounts.entity.key();
    let creator_key = ctx.accounts.creator.key();

    // Initialize entity with creator as controller
    let entity = &mut ctx.accounts.entity;
    entity.creator = creator_key;
    entity.handle = handle;
    entity.controller = creator_key;
    entity.current_metadata_revision = 0;
    entity.created_at = now;
    entity.updated_at = now;
    entity.bump = ctx.bumps.entity;

    emit!(EntityCreated {
        entity: entity_key,
        creator: creator_key,
        handle,
        controller: creator_key,
        created_at: now,
    });

    msg!("Entity created");

    Ok(())
}
