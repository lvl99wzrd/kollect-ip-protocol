//! Canonical error types for the license program.
//!
//! All protocol errors are defined here with explicit error codes.

use anchor_lang::prelude::*;

/// Canonical error enum for the license program.
#[error_code]
pub enum LicenseError {
    /// A license for this IP already exists.
    #[msg("License already exists for this IP")]
    LicenseAlreadyExists,

    /// A license grant already exists for this license and grantee.
    #[msg("License grant already exists for this license and grantee")]
    LicenseGrantAlreadyExists,

    /// The signer is not authorized to perform this action.
    #[msg("Unauthorized: signer is not authorized to perform this action")]
    Unauthorized,

    /// The origin IP is invalid.
    #[msg("Invalid origin IP: must be a valid non-derivative IP owned by ip_core")]
    InvalidOriginIp,

    /// Derivative IPs cannot create independent licenses.
    #[msg("Derivative IP cannot create license: derivatives inherit parent licensing terms")]
    DerivativeCannotCreateLicense,

    /// The referenced license does not exist.
    #[msg("License not found")]
    LicenseNotFound,

    /// The referenced license grant does not exist.
    #[msg("License grant not found")]
    LicenseGrantNotFound,

    /// The license grant has expired.
    #[msg("License grant has expired")]
    GrantExpired,

    /// The license does not allow derivatives.
    #[msg("License does not allow derivative creation")]
    DerivativesNotAllowed,

    /// The provided authority is invalid.
    #[msg("Invalid authority provided")]
    InvalidAuthority,

    /// The provided grantee is invalid.
    #[msg("Invalid grantee: must be a valid entity owned by ip_core")]
    InvalidGrantee,

    /// The provided license reference is invalid.
    #[msg("Invalid license reference")]
    InvalidLicense,

    /// Not enough valid signatures to meet the threshold.
    #[msg("Insufficient signatures: threshold not met")]
    InsufficientSignatures,

    /// An arithmetic overflow occurred.
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    /// Active grants exist, cannot revoke license.
    #[msg("Cannot revoke license with active grants")]
    ActiveGrantsExist,
}
