//! Global constants for the license program.
//!
//! These limits are fixed and must not be modified dynamically.
//! No dynamic sizing is permitted.

/// Seed prefix for license PDA.
pub const LICENSE_SEED: &[u8] = b"license";

/// Seed prefix for license grant PDA.
pub const LICENSE_GRANT_SEED: &[u8] = b"license_grant";
