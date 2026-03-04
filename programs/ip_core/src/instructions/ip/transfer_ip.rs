//! Transfer IP instruction.
//!
//! Transfers ownership of an IP to a new entity.

use anchor_lang::prelude::*;

use crate::error::IpCoreError;
use crate::state::{Entity, IpAccount};
use crate::utils::multisig::{extract_signer_keys, validate_multisig_keys};
use crate::utils::seeds::{ENTITY_SEED, IP_SEED};

/// Accounts required for transfer_ip instruction.
#[derive(Accounts)]
pub struct TransferIp<'info> {
    /// The IP account to transfer.
    #[account(
        mut,
        seeds = [IP_SEED, ip.registrant_entity.as_ref(), &ip.content_hash],
        bump = ip.bump,
        constraint = ip.current_owner_entity == current_owner_entity.key() @ IpCoreError::InvalidOwnership
    )]
    pub ip: Account<'info, IpAccount>,

    /// The current owner entity.
    #[account(
        seeds = [ENTITY_SEED, current_owner_entity.creator.as_ref(), &current_owner_entity.handle],
        bump = current_owner_entity.bump
    )]
    pub current_owner_entity: Account<'info, Entity>,

    /// The new owner entity.
    #[account(
        seeds = [ENTITY_SEED, new_owner_entity.creator.as_ref(), &new_owner_entity.handle],
        bump = new_owner_entity.bump
    )]
    pub new_owner_entity: Account<'info, Entity>,
    // Remaining accounts are signers (current owner entity controllers)
}

/// Transfer IP ownership.
///
/// Only mutates `current_owner_entity`. Does NOT modify:
/// - content_hash
/// - registrant_entity
/// - current_metadata_revision
/// - created_at
///
/// # Arguments
/// * `ctx` - Context containing accounts
///
/// # Errors
/// * `IpCoreError::InsufficientSignatures` - Current owner multisig threshold not met
/// * `IpCoreError::InvalidOwnership` - Signer is not the current owner
pub fn handler(ctx: Context<TransferIp>) -> Result<()> {
    let ip = &mut ctx.accounts.ip;
    let current_owner = &ctx.accounts.current_owner_entity;
    let new_owner = &ctx.accounts.new_owner_entity;

    // Validate current owner multisig
    let signer_keys = extract_signer_keys(ctx.remaining_accounts);
    validate_multisig_keys(
        &signer_keys,
        &current_owner.controllers,
        current_owner.signature_threshold,
    )?;

    // ONLY update current_owner_entity - all other fields remain immutable
    ip.current_owner_entity = new_owner.key();

    msg!(
        "IP transferred from {} to {}",
        current_owner.key(),
        new_owner.key()
    );

    Ok(())
}
