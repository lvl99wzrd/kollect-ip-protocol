//! Global constants for the ip_core program.
//!
//! These limits are fixed and must not be modified dynamically.
//! No dynamic sizing is permitted.

/// Maximum length for metadata schema IDs.
pub const MAX_SCHEMA_ID_LENGTH: usize = 32;

/// Maximum length for version strings.
pub const MAX_VERSION_LENGTH: usize = 16;

/// Maximum length for IPFS CID strings.
pub const MAX_CID_LENGTH: usize = 96;

/// Maximum length for entity handles.
pub const MAX_HANDLE_LENGTH: usize = 32;

/// Maximum number of controllers per entity.
pub const MAX_CONTROLLERS: usize = 5;

/// Placeholder for external license program ID.
/// This should be updated when the licensing program is deployed.
pub const LICENSE_PROGRAM_ID: &str = "11111111111111111111111111111111";
