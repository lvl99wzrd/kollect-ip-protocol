//! PDA seed derivation helpers.
//!
//! All PDA seeds are defined here for deterministic account derivation.
//! No randomness, no counters, no dynamic derivation.

use crate::constants::{MAX_HANDLE_LENGTH, MAX_SCHEMA_ID_LENGTH, MAX_VERSION_LENGTH};

/// Seed prefix for protocol config PDA.
pub const CONFIG_SEED: &[u8] = b"config";

/// Seed prefix for protocol treasury PDA.
pub const TREASURY_SEED: &[u8] = b"treasury";

/// Seed prefix for entity PDA.
pub const ENTITY_SEED: &[u8] = b"entity";

/// Seed prefix for metadata schema PDA.
pub const METADATA_SCHEMA_SEED: &[u8] = b"metadata_schema";

/// Seed prefix for metadata account PDA.
pub const METADATA_SEED: &[u8] = b"metadata";

/// Seed prefix for entity metadata.
pub const METADATA_ENTITY_SEED: &[u8] = b"entity";

/// Seed prefix for IP metadata.
pub const METADATA_IP_SEED: &[u8] = b"ip";

/// Seed prefix for IP account PDA.
pub const IP_SEED: &[u8] = b"ip";

/// Seed prefix for derivative link PDA.
pub const DERIVATIVE_SEED: &[u8] = b"derivative";

/// Returns seeds for protocol config PDA: `["config"]`
#[inline]
pub fn config_seeds() -> [&'static [u8]; 1] {
    [CONFIG_SEED]
}

/// Returns seeds for protocol treasury PDA: `["treasury"]`
#[inline]
pub fn treasury_seeds() -> [&'static [u8]; 1] {
    [TREASURY_SEED]
}

/// Returns seeds for entity PDA: `["entity", creator, handle]`
#[inline]
pub fn entity_seeds<'a>(
    creator: &'a [u8; 32],
    handle: &'a [u8; MAX_HANDLE_LENGTH],
) -> [&'a [u8]; 3] {
    [ENTITY_SEED, creator, handle]
}

/// Returns seeds for metadata schema PDA: `["metadata_schema", id, version]`
#[inline]
pub fn metadata_schema_seeds<'a>(
    schema_id: &'a [u8; MAX_SCHEMA_ID_LENGTH],
    version: &'a [u8; MAX_VERSION_LENGTH],
) -> [&'a [u8]; 3] {
    [METADATA_SCHEMA_SEED, schema_id, version]
}

/// Returns seeds for entity metadata PDA: `["metadata", "entity", entity, revision]`
#[inline]
pub fn metadata_entity_seeds<'a>(entity: &'a [u8; 32], revision: &'a [u8; 8]) -> [&'a [u8]; 4] {
    [METADATA_SEED, METADATA_ENTITY_SEED, entity, revision]
}

/// Returns seeds for IP metadata PDA: `["metadata", "ip", ip, revision]`
#[inline]
pub fn metadata_ip_seeds<'a>(ip: &'a [u8; 32], revision: &'a [u8; 8]) -> [&'a [u8]; 4] {
    [METADATA_SEED, METADATA_IP_SEED, ip, revision]
}

/// Returns seeds for IP account PDA: `["ip", registrant_entity, content_hash]`
#[inline]
pub fn ip_seeds<'a>(registrant_entity: &'a [u8; 32], content_hash: &'a [u8; 32]) -> [&'a [u8]; 3] {
    [IP_SEED, registrant_entity, content_hash]
}

/// Returns seeds for derivative link PDA: `["derivative", parent_ip, child_ip]`
#[inline]
pub fn derivative_seeds<'a>(parent_ip: &'a [u8; 32], child_ip: &'a [u8; 32]) -> [&'a [u8]; 3] {
    [DERIVATIVE_SEED, parent_ip, child_ip]
}
