//! Create metadata schema instruction.
//!
//! Creates an immutable metadata schema definition.

use anchor_lang::prelude::*;

use crate::constants::{MAX_CID_LENGTH, MAX_SCHEMA_ID_LENGTH, MAX_VERSION_LENGTH};
use crate::state::{MetadataSchema, METADATA_SCHEMA_SIZE};
use crate::utils::seeds::METADATA_SCHEMA_SEED;
use crate::utils::validation::validate_cid_not_empty;

/// Accounts required for create_metadata_schema instruction.
#[derive(Accounts)]
#[instruction(id: [u8; MAX_SCHEMA_ID_LENGTH], version: [u8; MAX_VERSION_LENGTH])]
pub struct CreateMetadataSchema<'info> {
    /// The metadata schema account to create (PDA).
    #[account(
        init,
        payer = creator,
        space = METADATA_SCHEMA_SIZE,
        seeds = [METADATA_SCHEMA_SEED, &id, &version],
        bump
    )]
    pub metadata_schema: Account<'info, MetadataSchema>,

    /// The creator of this schema (must sign).
    /// Also pays for account creation.
    #[account(mut)]
    pub creator: Signer<'info>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Create a new metadata schema.
///
/// Schemas are immutable after creation. They define the structure for
/// metadata that can be attached to entities or IPs.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `id` - Unique schema identifier
/// * `version` - Schema version
/// * `hash` - SHA-256 hash of the schema definition
/// * `cid` - IPFS CID pointing to the schema definition
///
/// # Errors
/// * `IpCoreError::EmptyCid` - CID is empty
pub fn handler(
    ctx: Context<CreateMetadataSchema>,
    id: [u8; MAX_SCHEMA_ID_LENGTH],
    version: [u8; MAX_VERSION_LENGTH],
    hash: [u8; 32],
    cid: [u8; MAX_CID_LENGTH],
) -> Result<()> {
    // Validate CID is not empty
    validate_cid_not_empty(&cid)?;

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize schema
    let schema = &mut ctx.accounts.metadata_schema;
    schema.id = id;
    schema.version = version;
    schema.hash = hash;
    schema.cid = cid;
    schema.creator = ctx.accounts.creator.key();
    schema.created_at = now;
    schema.bump = ctx.bumps.metadata_schema;

    msg!("Metadata schema created");

    Ok(())
}
