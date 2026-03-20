use crate::error::IpCoreError;
use anchor_lang::prelude::*;

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
