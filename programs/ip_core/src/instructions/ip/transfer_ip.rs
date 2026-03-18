use anchor_lang::prelude::*;

use crate::error::IpCoreError;
use crate::events::IpTransferred;
use crate::state::{Entity, IpAccount};
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

    /// The current owner entity controller (must sign).
    #[account(
        constraint = controller.key() == current_owner_entity.controller @ IpCoreError::Unauthorized
    )]
    pub controller: Signer<'info>,
}

/// Transfer IP ownership.
///
/// Only mutates `current_owner_entity`. Does NOT modify:
/// - content_hash
/// - registrant_entity
/// - current_metadata_revision
/// - created_at
/// - updated_at
///
/// # Arguments
/// * `ctx` - Context containing accounts
///
/// # Errors
/// * `IpCoreError::Unauthorized` - Signer is not the current owner entity controller
/// * `IpCoreError::InvalidOwnership` - Signer is not the current owner
pub fn handler(ctx: Context<TransferIp>) -> Result<()> {
    let ip = &mut ctx.accounts.ip;
    let current_owner = &ctx.accounts.current_owner_entity;
    let new_owner = &ctx.accounts.new_owner_entity;

    // ONLY update current_owner_entity - all other fields remain immutable
    ip.current_owner_entity = new_owner.key();

    emit!(IpTransferred {
        ip: ip.key(),
        from_entity: current_owner.key(),
        to_entity: new_owner.key(),
        authority: current_owner.key(),
    });

    msg!(
        "IP transferred from {} to {}",
        current_owner.key(),
        new_owner.key()
    );

    Ok(())
}
