use anchor_lang::prelude::*;
use ip_core::state::entity::Entity;

use crate::error::KollectError;

/// Validate that the entity's controller has signed the transaction.
/// `remaining_accounts` should include the controller signer account.
pub fn validate_entity_controller(entity: &Entity, remaining_accounts: &[AccountInfo]) -> Result<()> {
    let is_signed = remaining_accounts
        .iter()
        .any(|a| a.is_signer && a.key() == entity.controller);

    require!(is_signed, KollectError::InsufficientSignatures);

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
