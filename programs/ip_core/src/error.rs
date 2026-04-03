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

    /// License validation failed via CPI to the license program.
    #[msg("License validation failed")]
    LicenseValidationFailed,

    /// Invalid token mint for registration fee.
    #[msg("Invalid token mint: does not match registration currency")]
    InvalidTokenMint,

    /// Invalid treasury token account authority.
    #[msg("Invalid treasury token account authority")]
    InvalidTreasuryAuthority,

    /// Token accounts are required when registration fee is non-zero.
    #[msg("Token accounts are required when registration fee is non-zero")]
    MissingTokenAccount,

    /// Token program is required when registration fee is non-zero.
    #[msg("Token program is required when registration fee is non-zero")]
    MissingTokenProgram,
}
