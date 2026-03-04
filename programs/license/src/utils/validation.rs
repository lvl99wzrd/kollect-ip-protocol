//! Cross-program validation helpers.
//!
//! Contains helpers for validating accounts owned by other programs.
//! No state mutations.

use anchor_lang::prelude::*;

use crate::error::LicenseError;

/// Validates that enough signers have signed to meet the threshold.
///
/// # Arguments
/// * `signers` - List of account infos that have signed
/// * `controllers` - List of valid controller pubkeys
/// * `threshold` - Required number of signatures
///
/// # Returns
/// * `Ok(())` if signature threshold is met
/// * `Err(LicenseError::InsufficientSignatures)` if not enough valid signatures
pub fn validate_multisig<'info>(
    signers: &[AccountInfo<'info>],
    controllers: &[Pubkey],
    threshold: u8,
) -> Result<()> {
    let mut valid_signature_count = 0u8;

    for signer in signers {
        // Must have actually signed
        if !signer.is_signer {
            continue;
        }

        // Must be a controller
        if controllers.contains(signer.key) {
            valid_signature_count = valid_signature_count
                .checked_add(1)
                .ok_or(LicenseError::ArithmeticOverflow)?;
        }
    }

    if valid_signature_count < threshold {
        return Err(LicenseError::InsufficientSignatures.into());
    }

    Ok(())
}

/// Validates multisig using signer keys directly.
///
/// # Arguments
/// * `signer_keys` - List of signer public keys
/// * `controllers` - List of valid controller pubkeys
/// * `threshold` - Required number of signatures
///
/// # Returns
/// * `Ok(())` if signature threshold is met
/// * `Err(LicenseError::InsufficientSignatures)` if not enough valid signatures
pub fn validate_multisig_keys(
    signer_keys: &[Pubkey],
    controllers: &[Pubkey],
    threshold: u8,
) -> Result<()> {
    let mut valid_signature_count = 0u8;

    for signer_key in signer_keys {
        if controllers.contains(signer_key) {
            valid_signature_count = valid_signature_count
                .checked_add(1)
                .ok_or(LicenseError::ArithmeticOverflow)?;
        }
    }

    if valid_signature_count < threshold {
        return Err(LicenseError::InsufficientSignatures.into());
    }

    Ok(())
}

/// Extracts signer keys from remaining accounts.
///
/// # Arguments
/// * `remaining_accounts` - Slice of remaining account infos
///
/// # Returns
/// * Vec of pubkeys for accounts that are signers
pub fn extract_signer_keys(remaining_accounts: &[AccountInfo<'_>]) -> Vec<Pubkey> {
    remaining_accounts
        .iter()
        .filter(|acc| acc.is_signer)
        .map(|acc| *acc.key)
        .collect()
}

/// Validates that an account is owned by the expected program.
///
/// # Arguments
/// * `account` - The account to check
/// * `expected_owner` - The expected owner program ID
///
/// # Returns
/// * `Ok(())` if owner matches
/// * `Err` if owner doesn't match
pub fn validate_account_owner(account: &AccountInfo<'_>, expected_owner: &Pubkey) -> Result<()> {
    if account.owner != expected_owner {
        return Err(LicenseError::InvalidOriginIp.into());
    }
    Ok(())
}
