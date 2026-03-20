use anchor_lang::prelude::*;

use crate::error::IpCoreError;
use crate::events::EntityCreated;
use crate::state::{CreatorEntityCounter, Entity, CREATOR_ENTITY_COUNTER_SIZE, ENTITY_SIZE};
use crate::utils::seeds::{CREATOR_ENTITY_COUNTER_SEED, ENTITY_SEED};

/// Accounts required for create_entity instruction.
#[derive(Accounts)]
pub struct CreateEntity<'info> {
    /// The per-creator entity counter (initialized on first entity creation).
    #[account(
        init_if_needed,
        payer = creator,
        space = CREATOR_ENTITY_COUNTER_SIZE,
        seeds = [CREATOR_ENTITY_COUNTER_SEED, creator.key().as_ref()],
        bump
    )]
    pub counter: Account<'info, CreatorEntityCounter>,

    /// The entity account to create (PDA).
    /// Seeds use the current counter value as the entity index.
    #[account(
        init,
        payer = creator,
        space = ENTITY_SIZE,
        seeds = [ENTITY_SEED, creator.key().as_ref(), &counter.entity_count.to_le_bytes()],
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
/// The entity index is automatically derived from the creator's entity counter.
/// On first call, the counter PDA is initialized. Each subsequent call increments
/// the counter, producing a new deterministic entity PDA.
///
/// # Arguments
/// * `ctx` - Context containing accounts
///
/// # Errors
/// * `IpCoreError::ArithmeticOverflow` - Entity count overflow
pub fn handler(ctx: Context<CreateEntity>) -> Result<()> {
    let creator_key = ctx.accounts.creator.key();
    let counter = &mut ctx.accounts.counter;

    // Capture the index for this entity (current count before increment)
    let entity_index = counter.entity_count;

    // Initialize counter fields (idempotent for init_if_needed)
    counter.creator = creator_key;
    counter.bump = ctx.bumps.counter;

    // Increment the counter for the next entity
    counter.entity_count = counter
        .entity_count
        .checked_add(1)
        .ok_or(IpCoreError::ArithmeticOverflow)?;

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Capture entity key before mutable borrow
    let entity_key = ctx.accounts.entity.key();

    // Initialize entity with creator as controller
    let entity = &mut ctx.accounts.entity;
    entity.creator = creator_key;
    entity.index = entity_index;
    entity.controller = creator_key;
    entity.current_metadata_revision = 0;
    entity.created_at = now;
    entity.updated_at = now;
    entity.bump = ctx.bumps.entity;

    emit!(EntityCreated {
        entity: entity_key,
        creator: creator_key,
        index: entity_index,
        controller: creator_key,
        created_at: now,
    });

    msg!("Entity created (index {})", entity_index);

    Ok(())
}
