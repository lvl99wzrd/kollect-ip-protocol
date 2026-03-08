use anchor_lang::prelude::*;

// ===== License Events =====

/// Emitted when a new license is created.
#[event]
pub struct LicenseCreated {
    /// The license PDA.
    pub license: Pubkey,
    /// The origin IP this license is for.
    pub origin_ip: Pubkey,
    /// The authority entity (IP owner).
    pub authority: Pubkey,
    /// Whether derivatives are allowed.
    pub derivatives_allowed: bool,
    /// Creation timestamp.
    pub created_at: i64,
}

/// Emitted when a license is updated.
#[event]
pub struct LicenseUpdated {
    /// The license PDA.
    pub license: Pubkey,
    /// The origin IP this license is for.
    pub origin_ip: Pubkey,
    /// The authority entity (IP owner).
    pub authority: Pubkey,
    /// Previous derivatives_allowed value.
    pub old_derivatives_allowed: bool,
    /// New derivatives_allowed value.
    pub new_derivatives_allowed: bool,
}

/// Emitted when a license is revoked (closed).
#[event]
pub struct LicenseRevoked {
    /// The license PDA.
    pub license: Pubkey,
    /// The origin IP this license was for.
    pub origin_ip: Pubkey,
    /// The authority entity (IP owner).
    pub authority: Pubkey,
    /// Destination for rent refund.
    pub rent_destination: Pubkey,
}

// ===== License Grant Events =====

/// Emitted when a new license grant is created.
#[event]
pub struct LicenseGrantCreated {
    /// The license grant PDA.
    pub license_grant: Pubkey,
    /// The license this grant is for.
    pub license: Pubkey,
    /// The grantee entity.
    pub grantee: Pubkey,
    /// Grant expiration (0 = no expiration).
    pub expiration: i64,
    /// Grant timestamp.
    pub granted_at: i64,
}

/// Emitted when a license grant is revoked (closed).
#[event]
pub struct LicenseGrantRevoked {
    /// The license grant PDA.
    pub license_grant: Pubkey,
    /// The license this grant was for.
    pub license: Pubkey,
    /// The grantee entity.
    pub grantee: Pubkey,
    /// The authority entity who revoked.
    pub authority: Pubkey,
    /// Destination for rent refund.
    pub rent_destination: Pubkey,
}
