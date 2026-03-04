//! Instruction handlers for the license program.
//!
//! Each instruction is defined in its own file.

pub mod create_license;
pub mod create_license_grant;
pub mod revoke_license;
pub mod revoke_license_grant;
pub mod update_license;

#[allow(ambiguous_glob_reexports)]
pub use create_license::*;
#[allow(ambiguous_glob_reexports)]
pub use create_license_grant::*;
#[allow(ambiguous_glob_reexports)]
pub use revoke_license::*;
#[allow(ambiguous_glob_reexports)]
pub use revoke_license_grant::*;
#[allow(ambiguous_glob_reexports)]
pub use update_license::*;
