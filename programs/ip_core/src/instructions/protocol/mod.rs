//! Protocol instruction handlers.
//!
//! Handles protocol-level operations: config and treasury management.

pub mod initialize_config;
pub mod initialize_treasury;
pub mod update_config;
pub mod withdraw_treasury;

#[allow(ambiguous_glob_reexports)]
pub use initialize_config::*;
#[allow(ambiguous_glob_reexports)]
pub use initialize_treasury::*;
#[allow(ambiguous_glob_reexports)]
pub use update_config::*;
#[allow(ambiguous_glob_reexports)]
pub use withdraw_treasury::*;
