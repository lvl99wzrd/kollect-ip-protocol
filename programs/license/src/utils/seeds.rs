//! PDA seed derivation helpers.
//!
//! All PDA seeds are defined here for deterministic account derivation.
//! No randomness, no counters, no dynamic derivation.

use crate::constants::{LICENSE_GRANT_SEED, LICENSE_SEED};

/// Returns seeds for license PDA: `["license", origin_ip]`
#[inline]
pub fn license_seeds(origin_ip: &[u8; 32]) -> [&[u8]; 2] {
    [LICENSE_SEED, origin_ip]
}

/// Returns seeds for license PDA with bump: `["license", origin_ip, bump]`
#[inline]
pub fn license_seeds_with_bump<'a>(origin_ip: &'a [u8; 32], bump: &'a [u8; 1]) -> [&'a [u8]; 3] {
    [LICENSE_SEED, origin_ip, bump]
}

/// Returns seeds for license grant PDA: `["license_grant", license, grantee_entity]`
#[inline]
pub fn license_grant_seeds<'a>(license: &'a [u8; 32], grantee: &'a [u8; 32]) -> [&'a [u8]; 3] {
    [LICENSE_GRANT_SEED, license, grantee]
}

/// Returns seeds for license grant PDA with bump: `["license_grant", license, grantee_entity, bump]`
#[inline]
pub fn license_grant_seeds_with_bump<'a>(
    license: &'a [u8; 32],
    grantee: &'a [u8; 32],
    bump: &'a [u8; 1],
) -> [&'a [u8]; 4] {
    [LICENSE_GRANT_SEED, license, grantee, bump]
}
