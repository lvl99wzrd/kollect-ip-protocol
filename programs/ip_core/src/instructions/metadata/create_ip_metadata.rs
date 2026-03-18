use anchor_lang::prelude::*;

use crate::constants::MAX_CID_LENGTH;
use crate::error::IpCoreError;
use crate::events::IpMetadataCreated;
use crate::state::{
    Entity, IpAccount, MetadataAccount, MetadataParentType, MetadataSchema, METADATA_ACCOUNT_SIZE,
};
use crate::utils::seeds::{ENTITY_SEED, IP_SEED, METADATA_SEED};
use crate::utils::validation::validate_cid_not_empty;

/// Accounts required for create_ip_metadata instruction.
#[derive(Accounts)]
pub struct CreateIpMetadata<'info> {
    /// The metadata account to create (PDA).
    #[account(
        init,
        payer = payer,
        space = METADATA_ACCOUNT_SIZE,
        seeds = [
            METADATA_SEED,
            b"ip",
            ip.key().as_ref(),
            &(ip.current_metadata_revision + 1).to_le_bytes()
        ],
        bump
    )]
    pub metadata: Account<'info, MetadataAccount>,

    /// The IP to attach metadata to.
    #[account(
        mut,
        seeds = [IP_SEED, ip.registrant_entity.as_ref(), &ip.content_hash],
        bump = ip.bump,
        constraint = ip.current_owner_entity == owner_entity.key() @ IpCoreError::InvalidOwnership
    )]
    pub ip: Account<'info, IpAccount>,

    /// The current owner entity of the IP.
    #[account(
        seeds = [ENTITY_SEED, owner_entity.creator.as_ref(), &owner_entity.handle],
        bump = owner_entity.bump
    )]
    pub owner_entity: Account<'info, Entity>,

    /// The metadata schema this metadata conforms to.
    pub schema: Account<'info, MetadataSchema>,

    /// The owner entity controller (must sign).
    #[account(
        constraint = controller.key() == owner_entity.controller @ IpCoreError::Unauthorized
    )]
    pub controller: Signer<'info>,

    /// Payer for account creation.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Create metadata for an IP.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `hash` - SHA-256 hash of the metadata content
/// * `cid` - IPFS CID pointing to the metadata content
///
/// # Errors
/// * `IpCoreError::Unauthorized` - Signer is not the owner entity controller
/// * `IpCoreError::InvalidOwnership` - Signer is not the current owner
/// * `IpCoreError::EmptyCid` - CID is empty
pub fn handler(
    ctx: Context<CreateIpMetadata>,
    hash: [u8; 32],
    cid: [u8; MAX_CID_LENGTH],
) -> Result<()> {
    let ip = &mut ctx.accounts.ip;
    let owner_entity = &ctx.accounts.owner_entity;

    // Auto-increment revision
    let new_revision = ip
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
    metadata.parent_type = MetadataParentType::Ip;
    metadata.parent = ip.key();
    metadata.revision = new_revision;
    metadata.created_at = now;
    metadata.bump = ctx.bumps.metadata;

    // Increment IP's metadata revision
    ip.current_metadata_revision = new_revision;
    ip.updated_at = now;

    emit!(IpMetadataCreated {
        metadata: ctx.accounts.metadata.key(),
        ip: ip.key(),
        owner_entity: owner_entity.key(),
        schema: ctx.accounts.schema.key(),
        revision: new_revision,
        hash,
        cid,
        created_at: now,
    });

    msg!("IP metadata created (revision {})", new_revision);

    Ok(())
}
