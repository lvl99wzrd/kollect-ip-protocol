//! Metadata instruction handlers.
//!
//! Handles schema creation and metadata attachment operations.

pub mod create_entity_metadata;
pub mod create_ip_metadata;
pub mod create_metadata_schema;

#[allow(ambiguous_glob_reexports)]
pub use create_entity_metadata::*;
#[allow(ambiguous_glob_reexports)]
pub use create_ip_metadata::*;
#[allow(ambiguous_glob_reexports)]
pub use create_metadata_schema::*;
