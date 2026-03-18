use anchor_lang::prelude::*;

use crate::constants::MAX_CID_LENGTH;
use crate::error::IpCoreError;
use crate::events::EntityMetadataCreated;
use crate::state::{
    Entity, MetadataAccount, MetadataParentType, MetadataSchema, METADATA_ACCOUNT_SIZE,
};
use crate::utils::seeds::{ENTITY_SEED, METADATA_SEED};
use crate::utils::validation::validate_cid_not_empty;

/// Accounts required for create_entity_metadata instruction.
#[derive(Accounts)]
pub struct CreateEntityMetadata<'info> {
    /// The metadata account to create (PDA).
    #[account(
        init,
        payer = payer,
        space = METADATA_ACCOUNT_SIZE,
        seeds = [
            METADATA_SEED,
            b"entity",
            entity.key().as_ref(),
            &(entity.current_metadata_revision + 1).to_le_bytes()
        ],
        bump
    )]
    pub metadata: Account<'info, MetadataAccount>,

    /// The entity to attach metadata to.
    #[account(
        mut,
        seeds = [ENTITY_SEED, entity.creator.as_ref(), &entity.handle],
        bump = entity.bump
    )]
    pub entity: Account<'info, Entity>,

    /// The metadata schema this metadata conforms to.
    pub schema: Account<'info, MetadataSchema>,

    /// The entity controller (must sign).
    #[account(
        constraint = controller.key() == entity.controller @ IpCoreError::Unauthorized
    )]
    pub controller: Signer<'info>,

    /// Payer for account creation.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Create metadata for an entity.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `hash` - SHA-256 hash of the metadata content
/// * `cid` - IPFS CID pointing to the metadata content
///
/// # Errors
/// * `IpCoreError::Unauthorized` - Signer is not the entity controller
/// * `IpCoreError::EmptyCid` - CID is empty
pub fn handler(
    ctx: Context<CreateEntityMetadata>,
    hash: [u8; 32],
    cid: [u8; MAX_CID_LENGTH],
) -> Result<()> {
    let entity = &mut ctx.accounts.entity;

    // Auto-increment revision
    let new_revision = entity
        .current_metadata_revision
        .checked_add(1)
        .ok_or(IpCoreError::ArithmeticOverflow)?;

    // Validate CID
    validate_cid_not_empty(&cid)?;

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize metadata
    let metadata = &mut ctx.accounts.metadata;
    metadata.schema = ctx.accounts.schema.key();
    metadata.hash = hash;
    metadata.cid = cid;
    metadata.parent_type = MetadataParentType::Entity;
    metadata.parent = entity.key();
    metadata.revision = new_revision;
    metadata.created_at = now;
    metadata.bump = ctx.bumps.metadata;

    // Increment entity's metadata revision
    entity.current_metadata_revision = new_revision;
    entity.updated_at = now;

    emit!(EntityMetadataCreated {
        metadata: ctx.accounts.metadata.key(),
        entity: entity.key(),
        authority: entity.key(),
        schema: ctx.accounts.schema.key(),
        revision: new_revision,
        hash,
        cid,
        created_at: now,
    });

    msg!("Entity metadata created (revision {})", new_revision);

    Ok(())
}
