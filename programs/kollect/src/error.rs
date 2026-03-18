use anchor_lang::prelude::*;

#[error_code]
pub enum KollectError {
    #[msg("Platform already initialized")]
    PlatformAlreadyInitialized,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("IP not registered in ip_core")]
    IpNotRegistered,
    #[msg("IP already onboarded on kollect")]
    IpAlreadyOnboarded,
    #[msg("IP is not active")]
    IpNotActive,
    #[msg("IP is not onboarded on kollect")]
    IpNotOnboarded,
    #[msg("Entity does not own this IP")]
    IpOwnerMismatch,
    #[msg("Account is not owned by ip_core program")]
    InvalidIpCoreAccount,
    #[msg("Venue already registered")]
    VenueAlreadyRegistered,
    #[msg("Venue is not active")]
    VenueNotActive,
    #[msg("Invalid venue type")]
    InvalidVenueType,
    #[msg("Invalid capacity")]
    InvalidCapacity,
    #[msg("Invalid operating hours")]
    InvalidOperatingHours,
    #[msg("Invalid multiplier")]
    InvalidMultiplier,
    #[msg("Playback commitment already submitted for this venue and day")]
    PlaybackAlreadySubmitted,
    #[msg("Day timestamp is not aligned to UTC midnight")]
    InvalidDayTimestamp,
    #[msg("Settlement period has not ended")]
    SettlementPeriodNotEnded,
    #[msg("Commitment already settled")]
    CommitmentAlreadySettled,
    #[msg("No commitments to settle")]
    NoCommitmentsToSettle,
    #[msg("Invalid settlement period")]
    InvalidSettlementPeriod,
    #[msg("Distribution amounts do not match expected total")]
    DistributionAmountMismatch,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Entity treasury not initialized")]
    EntityTreasuryNotInitialized,
    #[msg("Insufficient signatures for entity multisig")]
    InsufficientSignatures,
    #[msg("License template is not active")]
    LicenseTemplateNotActive,
    #[msg("Maximum grants reached for this license template")]
    MaxGrantsReached,
    #[msg("License already granted to this entity for this template")]
    LicenseAlreadyGranted,
    #[msg("License has expired")]
    LicenseExpired,
    #[msg("Invalid license template")]
    InvalidLicenseTemplate,
    #[msg("Royalty policy already exists for this template")]
    RoyaltyPolicyAlreadyExists,
    #[msg("Royalty split already exists for this derivative")]
    RoyaltySplitAlreadyExists,
    #[msg("Invalid derivative link")]
    InvalidDerivativeLink,
    #[msg("Royalty chain exceeds maximum depth")]
    RoyaltyChainTooDeep,
    #[msg("Insufficient payment for license purchase")]
    InsufficientPayment,
    #[msg("Invalid currency for payment")]
    InvalidCurrency,
}
