//! State account definitions for the ip_core program.
//!
//! Each account is defined in its own file with PDA seeds, space calculations, and invariants.

pub mod derivative_link;
pub mod entity;
pub mod ip_account;
pub mod metadata_account;
pub mod metadata_schema;
pub mod protocol_config;
pub mod protocol_treasury;

pub use derivative_link::*;
pub use entity::*;
pub use ip_account::*;
pub use metadata_account::*;
pub use metadata_schema::*;
pub use protocol_config::*;
pub use protocol_treasury::*;
