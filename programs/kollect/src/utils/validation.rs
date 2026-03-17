use anchor_lang::prelude::*;
use ip_core::state::entity::Entity;

use crate::error::KollectError;

/// Validate that enough signers from the entity's controllers meet the threshold.
/// `remaining_accounts` should include the signer accounts passed by the caller.
pub fn validate_entity_multisig(entity: &Entity, remaining_accounts: &[AccountInfo]) -> Result<()> {
    let signer_keys: Vec<Pubkey> = remaining_accounts
        .iter()
        .filter(|a| a.is_signer)
        .map(|a| a.key())
        .collect();

    let valid_count = signer_keys
        .iter()
        .filter(|k| entity.controllers.contains(k))
        .count();

    require!(
        valid_count >= entity.signature_threshold as usize,
        KollectError::InsufficientSignatures
    );

    Ok(())
}

/// Validate that a day_timestamp is aligned to UTC midnight.
pub fn validate_day_timestamp(day_timestamp: i64) -> Result<()> {
    require!(
        day_timestamp > 0 && day_timestamp % crate::constants::SECONDS_PER_DAY == 0,
        KollectError::InvalidDayTimestamp
    );
    Ok(())
}

/// Perform checked basis-point calculation: `amount * bps / 10_000`.
pub fn calculate_bps(amount: u64, bps: u16) -> Result<u64> {
    amount
        .checked_mul(bps as u64)
        .and_then(|v| v.checked_div(crate::constants::BPS_DENOMINATOR))
        .ok_or_else(|| error!(KollectError::ArithmeticOverflow))
}
