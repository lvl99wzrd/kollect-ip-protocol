//! State account definitions for the license program.
//!
//! Each account is defined in its own file with PDA seeds, space calculations, and invariants.

pub mod license;
pub mod license_grant;

pub use license::*;
pub use license_grant::*;
