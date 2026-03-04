//! Update entity controllers instruction.
//!
//! Add or remove controllers from an entity.

use anchor_lang::prelude::*;

use crate::constants::MAX_CONTROLLERS;
use crate::error::IpCoreError;
use crate::state::Entity;
use crate::utils::multisig::{extract_signer_keys, validate_multisig_keys};
use crate::utils::seeds::ENTITY_SEED;
use crate::utils::validation::validate_threshold;

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

/// Action to perform on controllers.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ControllerAction {
    /// Add a new controller.
    Add = 0,
    /// Remove an existing controller.
    Remove = 1,
}

/// Update entity controllers.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `action` - Whether to add or remove a controller
/// * `controller` - The controller pubkey to add or remove
/// * `new_threshold` - Optional new signature threshold
///
/// # Errors
/// * `IpCoreError::InsufficientSignatures` - Multisig threshold not met
/// * `IpCoreError::ControllerLimitExceeded` - Too many controllers (on add)
/// * `IpCoreError::ControllerNotFound` - Controller not found (on remove)
/// * `IpCoreError::CannotRemoveLastController` - Cannot remove the last controller
/// * `IpCoreError::InvalidThreshold` - Invalid threshold value
pub fn handler(
    ctx: Context<UpdateEntityControllers>,
    action: ControllerAction,
    controller: Pubkey,
    new_threshold: Option<u8>,
) -> Result<()> {
    let entity = &mut ctx.accounts.entity;

    // Validate multisig
    let signer_keys = extract_signer_keys(ctx.remaining_accounts);
    validate_multisig_keys(
        &signer_keys,
        &entity.controllers,
        entity.signature_threshold,
    )?;

    match action {
        ControllerAction::Add => {
            // Check limit before adding
            if entity.controllers.len() >= MAX_CONTROLLERS {
                return Err(IpCoreError::ControllerLimitExceeded.into());
            }

            // Don't add duplicates
            if !entity.controllers.contains(&controller) {
                entity.controllers.push(controller);
            }
        }
        ControllerAction::Remove => {
            // Cannot remove the last controller
            if entity.controllers.len() == 1 {
                return Err(IpCoreError::CannotRemoveLastController.into());
            }

            // Find and remove the controller
            let position = entity
                .controllers
                .iter()
                .position(|&c| c == controller)
                .ok_or(IpCoreError::ControllerNotFound)?;

            entity.controllers.remove(position);
        }
    }

    // Update threshold if provided
    if let Some(threshold) = new_threshold {
        validate_threshold(threshold, entity.controllers.len())?;
        entity.signature_threshold = threshold;
    } else {
        // Ensure current threshold is still valid after changes
        if entity.signature_threshold as usize > entity.controllers.len() {
            // Auto-adjust threshold to controller count
            entity.signature_threshold = entity.controllers.len() as u8;
        }
    }

    // Update timestamp
    let clock = Clock::get()?;
    entity.updated_at = clock.unix_timestamp;

    msg!("Entity controllers updated");

    Ok(())
}
