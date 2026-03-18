use anchor_lang::prelude::*;

/// Canonical error enum for the ip_core program.
#[error_code]
pub enum IpCoreError {
    /// Protocol configuration has already been initialized.
    #[msg("Protocol configuration has already been initialized")]
    ConfigAlreadyInitialized,

    /// Protocol treasury has already been initialized.
    #[msg("Protocol treasury has already been initialized")]
    TreasuryAlreadyInitialized,

    /// The signer is not authorized to perform this action.
    #[msg("Unauthorized: signer is not authorized to perform this action")]
    Unauthorized,

    /// The provided authority does not match the expected authority.
    #[msg("Invalid authority provided")]
    InvalidAuthority,

    /// The entity account has not been initialized.
    #[msg("Entity has not been initialized")]
    EntityNotInitialized,

    /// The handle contains invalid characters (must be lowercase alphanumeric).
    #[msg("Invalid handle: must be lowercase alphanumeric (a-z, 0-9)")]
    InvalidHandle,

    /// The handle exceeds the maximum allowed length.
    #[msg("Handle too long: maximum length is 32 characters")]
    HandleTooLong,

    /// The handle is already registered for this creator.
    #[msg("Handle already exists for this creator")]
    HandleAlreadyExists,

    /// The referenced metadata schema does not exist.
    #[msg("Metadata schema not found")]
    MetadataSchemaNotFound,

    /// The metadata revision is invalid (must be current + 1).
    #[msg("Invalid metadata revision: must be exactly current revision + 1")]
    InvalidMetadataRevision,

    /// An IP with this content hash already exists for the registrant.
    #[msg("IP already exists for this registrant and content hash")]
    IPAlreadyExists,

    /// The ownership validation failed.
    #[msg("Invalid ownership: signer is not the owner")]
    InvalidOwnership,

    /// A derivative link already exists between these IPs.
    #[msg("Derivative link already exists between parent and child IP")]
    DerivativeAlreadyExists,

    /// An arithmetic overflow occurred.
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    /// The CID cannot be empty.
    #[msg("CID cannot be empty")]
    EmptyCid,

    /// The handle cannot be empty.
    #[msg("Handle cannot be empty")]
    EmptyHandle,

    /// Invalid license: not owned by license program.
    #[msg("Invalid license: account not owned by license program")]
    InvalidLicenseOwner,

    /// Invalid license: does not reference the parent IP.
    #[msg("Invalid license: does not reference the parent IP")]
    InvalidLicenseOrigin,

    /// License does not allow derivatives.
    #[msg("License does not allow derivatives")]
    DerivativesNotAllowed,

    /// License has expired.
    #[msg("License has expired")]
    LicenseExpired,

    /// Invalid token mint for registration fee.
    #[msg("Invalid token mint: does not match registration currency")]
    InvalidTokenMint,

    /// Invalid treasury token account authority.
    #[msg("Invalid treasury token account authority")]
    InvalidTreasuryAuthority,

    /// License grant does not reference the expected license.
    #[msg("License grant does not reference the expected license")]
    LicenseGrantMismatch,

    /// Grantee does not match the child owner entity.
    #[msg("Grantee does not match the child owner entity")]
    InvalidGrantee,
}
