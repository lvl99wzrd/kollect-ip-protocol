use anchor_lang::prelude::*;

use crate::constants::MAX_CONTROLLERS;
use crate::state::Entity;
use crate::utils::multisig::{extract_signer_keys, validate_multisig_keys};
use crate::utils::seeds::ENTITY_SEED;
use crate::utils::validation::{validate_controllers, validate_threshold};

/// Accounts required for update_entity_controllers instruction.
#[derive(Accounts)]
pub struct UpdateEntityControllers<'info> {
    /// The entity to update.
    #[account(
        mut,
        seeds = [ENTITY_SEED, entity.creator.as_ref(), &entity.handle],
        bump = entity.bump
    )]
    pub entity: Account<'info, Entity>,
    // Remaining accounts are signers (controllers)
}

/// Update entity controllers by replacing the entire controller list.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `new_controllers` - The new list of controller pubkeys (replaces existing list)
/// * `new_threshold` - The new signature threshold
///
/// # Errors
/// * `IpCoreError::InsufficientSignatures` - Multisig threshold not met by current controllers
/// * `IpCoreError::EmptyControllerList` - New controller list is empty
/// * `IpCoreError::ControllerLimitExceeded` - Too many controllers in new list
/// * `IpCoreError::DuplicateController` - Duplicate pubkey in new controller list
/// * `IpCoreError::InvalidThreshold` - Invalid threshold value for new controller count
pub fn handler(
    ctx: Context<UpdateEntityControllers>,
    new_controllers: Vec<Pubkey>,
    new_threshold: u8,
) -> Result<()> {
    let entity = &mut ctx.accounts.entity;

    // Validate multisig from current controllers
    let signer_keys = extract_signer_keys(ctx.remaining_accounts);
    validate_multisig_keys(
        &signer_keys,
        &entity.controllers,
        entity.signature_threshold,
    )?;

    // Validate the new controller list
    validate_controllers(&new_controllers, MAX_CONTROLLERS)?;

    // Validate threshold against new controller count
    validate_threshold(new_threshold, new_controllers.len())?;

    // Replace controllers and threshold
    entity.controllers = new_controllers;
    entity.signature_threshold = new_threshold;

    // Update timestamp
    let clock = Clock::get()?;
    entity.updated_at = clock.unix_timestamp;

    msg!("Entity controllers updated");

    Ok(())
}
