use crate::error::IpCoreError;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;

/// Anchor discriminator for `validate_derivative_grant` instruction.
/// Computed as `sha256("global:validate_derivative_grant")[..8]`.
const VALIDATE_DERIVATIVE_GRANT_DISCRIMINATOR: [u8; 8] = [167, 77, 116, 41, 26, 181, 191, 240];

/// Validates that a CID is not empty.
///
/// # Arguments
/// * `cid` - The CID bytes to validate
///
/// # Returns
/// * `Ok(())` if CID is not empty
/// * `Err(IpCoreError::EmptyCid)` if CID is empty
pub fn validate_cid_not_empty(cid: &[u8]) -> Result<()> {
    // Check if all bytes are zero (empty)
    let is_empty = cid.iter().all(|&b| b == 0);

    if is_empty {
        return Err(IpCoreError::EmptyCid.into());
    }

    Ok(())
}

/// Validates that the expected revision is exactly current + 1.
///
/// # Arguments
/// * `current` - The current revision number
/// * `expected` - The expected new revision number
///
/// # Returns
/// * `Ok(())` if expected == current + 1
/// * `Err(IpCoreError::InvalidMetadataRevision)` otherwise
pub fn validate_revision_increment(current: u64, expected: u64) -> Result<()> {
    let next = current
        .checked_add(1)
        .ok_or(IpCoreError::ArithmeticOverflow)?;

    if expected != next {
        return Err(IpCoreError::InvalidMetadataRevision.into());
    }

    Ok(())
}

/// Validates a license grant for derivative creation via CPI to the license program.
///
/// Invokes the `validate_derivative_grant` instruction on the license program,
/// which performs all license-specific validation (origin IP match, grantee match,
/// derivatives allowed, expiration check).
///
/// # Arguments
/// * `license_program` - The license program to invoke
/// * `license_grant` - The license grant account to validate
/// * `license` - The license account referenced by the grant
/// * `parent_ip` - The parent IP being derived from
/// * `grantee_entity` - The entity claiming the grant
///
/// # Errors
/// Returns any error propagated from the license program's validation.
pub fn validate_derivative_grant_cpi<'info>(
    license_program: &AccountInfo<'info>,
    license_grant: &AccountInfo<'info>,
    license: &AccountInfo<'info>,
    parent_ip: &AccountInfo<'info>,
    grantee_entity: &AccountInfo<'info>,
) -> Result<()> {
    let ix = Instruction {
        program_id: license_program.key(),
        accounts: vec![
            AccountMeta::new_readonly(license_grant.key(), false),
            AccountMeta::new_readonly(license.key(), false),
            AccountMeta::new_readonly(parent_ip.key(), false),
            AccountMeta::new_readonly(grantee_entity.key(), false),
        ],
        data: VALIDATE_DERIVATIVE_GRANT_DISCRIMINATOR.to_vec(),
    };

    invoke(
        &ix,
        &[
            license_grant.clone(),
            license.clone(),
            parent_ip.clone(),
            grantee_entity.clone(),
            license_program.clone(),
        ],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_revision_increment() {
        assert!(validate_revision_increment(0, 1).is_ok());
        assert!(validate_revision_increment(5, 6).is_ok());
        assert!(validate_revision_increment(0, 2).is_err());
        assert!(validate_revision_increment(5, 5).is_err());
    }
}
