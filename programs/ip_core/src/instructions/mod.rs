//! Instruction handlers for the ip_core program.
//!
//! Each domain has its own submodule with specific instruction handlers.

pub mod derivative;
pub mod entity;
pub mod ip;
pub mod metadata;
pub mod protocol;

#[allow(ambiguous_glob_reexports)]
pub use derivative::*;
#[allow(ambiguous_glob_reexports)]
pub use entity::*;
#[allow(ambiguous_glob_reexports)]
pub use ip::*;
#[allow(ambiguous_glob_reexports)]
pub use metadata::*;
#[allow(ambiguous_glob_reexports)]
pub use protocol::*;
