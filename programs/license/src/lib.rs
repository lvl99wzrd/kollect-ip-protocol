//! Mycelium IP Protocol - License Program
//!
//! A two-layer licensing model for IP assets on Solana.
//!
//! This program provides:
//! - License creation and management for IP assets
//! - License grants to entities
//! - Validation helpers for derivative creation
//!
//! ## Design Overview
//!
//! The License program implements a two-layer model:
//!
//! 1. **License** — Global per IP (`["license", origin_ip]`), defines terms
//! 2. **LicenseGrant** — Per grantee (`["license_grant", license, grantee_entity]`),
//!    tracks who acquired the license
//!
//! This separation enables:
//! - One license definition per IP asset
//! - Multiple grantees per license
//! - Independent grant expiration from license terms
//! - `ip_core`'s `create_derivative_link` to validate grantee holds a valid license grant
//!
//! ## Invariants
//!
//! - Derivative IPs cannot create independent licenses — they inherit parent IP's licensing terms.
//! - No account may contain royalty, governance, revenue, or economic distribution logic.
//! - License program validates existence and structural correctness only — no economic enforcement.

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("LicE6QjUgS6pYt6QdBcqXE7kD2kFXXWKH2Z7YYY2YYY");

#[program]
pub mod license {
    use super::*;

    // ===== License Instructions =====

    /// Create a new license for an IP.
    ///
    /// # Arguments
    /// * `derivatives_allowed` - Whether this license allows derivative creation
    /// * `ip_core_program_id` - The ip_core program ID for validation
    ///
    /// # Requirements
    /// - Origin IP must exist and be owned by ip_core
    /// - Origin IP must NOT be a derivative
    /// - IP owner entity multisig approval required
    pub fn create_license(
        ctx: Context<CreateLicense>,
        derivatives_allowed: bool,
        ip_core_program_id: Pubkey,
    ) -> Result<()> {
        instructions::create_license::handler(ctx, derivatives_allowed, ip_core_program_id)
    }

    /// Update a license's terms.
    ///
    /// # Arguments
    /// * `derivatives_allowed` - New value for derivatives_allowed
    /// * `ip_core_program_id` - The ip_core program ID for validation
    ///
    /// # Note
    /// Only `derivatives_allowed` may be updated. Origin IP and authority are immutable.
    pub fn update_license(
        ctx: Context<UpdateLicense>,
        derivatives_allowed: bool,
        ip_core_program_id: Pubkey,
    ) -> Result<()> {
        instructions::update_license::handler(ctx, derivatives_allowed, ip_core_program_id)
    }

    /// Revoke a license by closing its account.
    ///
    /// # Arguments
    /// * `ip_core_program_id` - The ip_core program ID for validation
    ///
    /// # Note
    /// This closes the license account and returns rent to the destination.
    pub fn revoke_license(ctx: Context<RevokeLicense>, ip_core_program_id: Pubkey) -> Result<()> {
        instructions::revoke_license::handler(ctx, ip_core_program_id)
    }

    // ===== License Grant Instructions =====

    /// Create a license grant for a grantee entity.
    ///
    /// # Arguments
    /// * `expiration` - Expiration timestamp (0 = no expiration)
    /// * `ip_core_program_id` - The ip_core program ID for validation
    ///
    /// # Requirements
    /// - License must exist
    /// - Grantee entity must exist and be owned by ip_core
    /// - License authority entity multisig approval required
    pub fn create_license_grant(
        ctx: Context<CreateLicenseGrant>,
        expiration: i64,
        ip_core_program_id: Pubkey,
    ) -> Result<()> {
        instructions::create_license_grant::handler(ctx, expiration, ip_core_program_id)
    }

    /// Revoke a license grant by closing its account.
    ///
    /// # Arguments
    /// * `ip_core_program_id` - The ip_core program ID for validation
    ///
    /// # Note
    /// Grantee consent is NOT required. This closes the grant account
    /// and returns rent to the destination.
    pub fn revoke_license_grant(
        ctx: Context<RevokeLicenseGrant>,
        ip_core_program_id: Pubkey,
    ) -> Result<()> {
        instructions::revoke_license_grant::handler(ctx, ip_core_program_id)
    }
}
