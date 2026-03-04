//! Derivative instruction handlers.
//!
//! Handles derivative link creation and management operations.

pub mod create_derivative_link;
pub mod update_derivative_license;

#[allow(ambiguous_glob_reexports)]
pub use create_derivative_link::*;
#[allow(ambiguous_glob_reexports)]
pub use update_derivative_license::*;
