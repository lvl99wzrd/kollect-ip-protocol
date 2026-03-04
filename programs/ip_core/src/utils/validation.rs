//! Pure validation helpers.
//!
//! No state mutation. Only validation logic.

use crate::constants::MAX_HANDLE_LENGTH;
use crate::error::IpCoreError;
use anchor_lang::prelude::*;

/// Validates that a handle is lowercase alphanumeric and within length limits.
///
/// Handle requirements:
/// - Must be 1-32 characters
/// - Must contain only lowercase letters (a-z) and digits (0-9)
/// - Regex equivalent: `^[a-z0-9]{1,32}$`
///
/// # Arguments
/// * `handle` - The handle bytes to validate
///
/// # Returns
/// * `Ok(())` if valid
/// * `Err(IpCoreError::EmptyHandle)` if handle is empty
/// * `Err(IpCoreError::HandleTooLong)` if handle exceeds 32 chars
/// * `Err(IpCoreError::InvalidHandle)` if handle contains invalid characters
pub fn validate_handle(handle: &[u8]) -> Result<()> {
    // Find the actual length (excluding null padding)
    let actual_len = handle.iter().position(|&b| b == 0).unwrap_or(handle.len());

    // Check for empty handle
    if actual_len == 0 {
        return Err(IpCoreError::EmptyHandle.into());
    }

    // Check length limit
    if actual_len > MAX_HANDLE_LENGTH {
        return Err(IpCoreError::HandleTooLong.into());
    }

    // Validate characters: must be lowercase alphanumeric (a-z, 0-9)
    for &byte in &handle[..actual_len] {
        if !byte.is_ascii_lowercase() && !byte.is_ascii_digit() {
            return Err(IpCoreError::InvalidHandle.into());
        }
    }

    Ok(())
}

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

/// Validates that the signature threshold is within valid bounds.
///
/// # Arguments
/// * `threshold` - The signature threshold
/// * `controller_count` - The number of controllers
///
/// # Returns
/// * `Ok(())` if 1 <= threshold <= controller_count
/// * `Err(IpCoreError::InvalidThreshold)` otherwise
pub fn validate_threshold(threshold: u8, controller_count: usize) -> Result<()> {
    if threshold == 0 || threshold as usize > controller_count {
        return Err(IpCoreError::InvalidThreshold.into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_handle_valid() {
        assert!(validate_handle(b"validhandle123").is_ok());
        assert!(validate_handle(b"a").is_ok());
        assert!(validate_handle(b"12345").is_ok());
        assert!(validate_handle(b"abc123def456").is_ok());
    }

    #[test]
    fn test_validate_handle_invalid() {
        // Uppercase not allowed
        assert!(validate_handle(b"InvalidHandle").is_err());
        // Special characters not allowed
        assert!(validate_handle(b"handle_with_underscore").is_err());
        assert!(validate_handle(b"handle-with-dash").is_err());
        // Spaces not allowed
        assert!(validate_handle(b"handle with spaces").is_err());
    }

    #[test]
    fn test_validate_revision_increment() {
        assert!(validate_revision_increment(0, 1).is_ok());
        assert!(validate_revision_increment(5, 6).is_ok());
        assert!(validate_revision_increment(0, 2).is_err());
        assert!(validate_revision_increment(5, 5).is_err());
    }
}
