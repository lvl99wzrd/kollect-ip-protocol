//! IP instruction handlers.
//!
//! Handles IP registration and transfer operations.

pub mod create_ip;
pub mod transfer_ip;

#[allow(ambiguous_glob_reexports)]
pub use create_ip::*;
#[allow(ambiguous_glob_reexports)]
pub use transfer_ip::*;
