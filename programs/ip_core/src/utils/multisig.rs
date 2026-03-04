//! Multisig validation utilities.
//!
//! Pure validation logic for signature threshold verification.
//! No account mutation.

use crate::error::IpCoreError;
use anchor_lang::prelude::*;

/// Validates that enough signers have signed to meet the threshold.
///
/// # Arguments
/// * `signers` - List of account infos that have signed
/// * `controllers` - List of valid controller pubkeys
/// * `threshold` - Required number of signatures
///
/// # Returns
/// * `Ok(())` if signature threshold is met
/// * `Err(IpCoreError::InsufficientSignatures)` if not enough valid signatures
///
/// # Validation Rules
/// 1. Each signer must be in the controllers list
/// 2. Number of valid signers must be >= threshold
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
                .ok_or(IpCoreError::ArithmeticOverflow)?;
        }
    }

    if valid_signature_count < threshold {
        return Err(IpCoreError::InsufficientSignatures.into());
    }

    Ok(())
}

/// Validates multisig using Signer accounts instead of AccountInfo.
///
/// This variant is useful when signers are already extracted as Signer types.
///
/// # Arguments
/// * `signer_keys` - List of signer public keys
/// * `controllers` - List of valid controller pubkeys
/// * `threshold` - Required number of signatures
///
/// # Returns
/// * `Ok(())` if signature threshold is met
/// * `Err(IpCoreError::InsufficientSignatures)` if not enough valid signatures
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
                .ok_or(IpCoreError::ArithmeticOverflow)?;
        }
    }

    if valid_signature_count < threshold {
        return Err(IpCoreError::InsufficientSignatures.into());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_multisig_keys() {
        let controller1 = Pubkey::new_unique();
        let controller2 = Pubkey::new_unique();
        let controller3 = Pubkey::new_unique();
        let controllers = vec![controller1, controller2, controller3];

        // 2 of 3 threshold met
        let signers = vec![controller1, controller2];
        assert!(validate_multisig_keys(&signers, &controllers, 2).is_ok());

        // 1 of 3 threshold met
        let signers = vec![controller1];
        assert!(validate_multisig_keys(&signers, &controllers, 1).is_ok());

        // Threshold not met
        let signers = vec![controller1];
        assert!(validate_multisig_keys(&signers, &controllers, 2).is_err());

        // Non-controller signer doesn't count
        let non_controller = Pubkey::new_unique();
        let signers = vec![non_controller];
        assert!(validate_multisig_keys(&signers, &controllers, 1).is_err());
    }
}
