use anchor_lang::prelude::*;

use crate::error::IpCoreError;
use crate::events::EntityControlTransferred;
use crate::state::Entity;
use crate::utils::seeds::ENTITY_SEED;

/// Accounts required for transfer_entity_control instruction.
#[derive(Accounts)]
pub struct TransferEntityControl<'info> {
    /// The entity to update.
    #[account(
        mut,
        seeds = [ENTITY_SEED, entity.creator.as_ref(), &entity.index.to_le_bytes()],
        bump = entity.bump
    )]
    pub entity: Account<'info, Entity>,

    /// The current controller (must sign).
    #[account(
        constraint = controller.key() == entity.controller @ IpCoreError::Unauthorized
    )]
    pub controller: Signer<'info>,
}

/// Transfer entity control to a new controller.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `new_controller` - The new controller pubkey
///
/// # Errors
/// * `IpCoreError::Unauthorized` - Signer is not the current controller
pub fn handler(ctx: Context<TransferEntityControl>, new_controller: Pubkey) -> Result<()> {
    let entity = &mut ctx.accounts.entity;

    let old_controller = entity.controller;
    let entity_key = entity.key();

    entity.controller = new_controller;

    let clock = Clock::get()?;
    entity.updated_at = clock.unix_timestamp;

    emit!(EntityControlTransferred {
        entity: entity_key,
        old_controller,
        new_controller,
        updated_at: entity.updated_at,
    });

    msg!("Entity control transferred");

    Ok(())
}
