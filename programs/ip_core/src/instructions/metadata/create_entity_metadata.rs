//! Create entity metadata instruction.
//!
//! Attaches metadata to an entity.

use anchor_lang::prelude::*;

use crate::constants::MAX_CID_LENGTH;
use crate::error::IpCoreError;
use crate::state::{Entity, MetadataAccount, MetadataParentType, MetadataSchema, METADATA_ACCOUNT_SIZE};
use crate::utils::multisig::{extract_signer_keys, validate_multisig_keys};
use crate::utils::seeds::{ENTITY_SEED, METADATA_SEED};
use crate::utils::validation::validate_cid_not_empty;

/// Accounts required for create_entity_metadata instruction.
#[derive(Accounts)]
#[instruction(revision: u64)]
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
            &revision.to_le_bytes()
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

    /// Payer for account creation.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
    // Remaining accounts are signers (entity controllers)
}

/// Create metadata for an entity.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `revision` - Revision number (must be current + 1)
/// * `hash` - SHA-256 hash of the metadata content
/// * `cid` - IPFS CID pointing to the metadata content
///
/// # Errors
/// * `IpCoreError::InsufficientSignatures` - Multisig threshold not met
/// * `IpCoreError::InvalidMetadataRevision` - Revision is not current + 1
/// * `IpCoreError::EmptyCid` - CID is empty
pub fn handler(
    ctx: Context<CreateEntityMetadata>,
    revision: u64,
    hash: [u8; 32],
    cid: [u8; MAX_CID_LENGTH],
) -> Result<()> {
    let entity = &mut ctx.accounts.entity;

    // Validate multisig
    let signer_keys = extract_signer_keys(ctx.remaining_accounts);
    validate_multisig_keys(&signer_keys, &entity.controllers, entity.signature_threshold)?;

    // Validate revision is exactly current + 1
    let expected_revision = entity
        .current_metadata_revision
        .checked_add(1)
        .ok_or(IpCoreError::ArithmeticOverflow)?;

    if revision != expected_revision {
        return Err(IpCoreError::InvalidMetadataRevision.into());
    }

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
    metadata.revision = revision;
    metadata.created_at = now;
    metadata.bump = ctx.bumps.metadata;

    // Increment entity's metadata revision
    entity.current_metadata_revision = revision;
    entity.updated_at = now;

    msg!("Entity metadata created (revision {})", revision);

    Ok(())
}
