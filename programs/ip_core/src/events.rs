use anchor_lang::prelude::*;

use crate::constants::{
    MAX_CID_LENGTH, MAX_HANDLE_LENGTH, MAX_SCHEMA_ID_LENGTH, MAX_VERSION_LENGTH,
};

// ===== Protocol Events =====

/// Emitted when protocol configuration is initialized.
#[event]
pub struct ConfigInitialized {
    /// The config PDA.
    pub config: Pubkey,
    /// The protocol authority.
    pub authority: Pubkey,
    /// The treasury PDA.
    pub treasury: Pubkey,
    /// The registration currency mint.
    pub registration_currency: Pubkey,
    /// The registration fee amount.
    pub registration_fee: u64,
}

/// Emitted when protocol configuration is updated.
#[event]
pub struct ConfigUpdated {
    /// The config PDA.
    pub config: Pubkey,
    /// The authority who made the change.
    pub authority: Pubkey,
    /// New authority (if changed).
    pub new_authority: Option<Pubkey>,
    /// New treasury (if changed).
    pub new_treasury: Option<Pubkey>,
    /// New registration currency (if changed).
    pub new_registration_currency: Option<Pubkey>,
    /// New registration fee (if changed).
    pub new_registration_fee: Option<u64>,
}

/// Emitted when protocol treasury is initialized.
#[event]
pub struct TreasuryInitialized {
    /// The treasury PDA.
    pub treasury: Pubkey,
    /// The treasury authority.
    pub authority: Pubkey,
    /// The protocol config PDA.
    pub config: Pubkey,
}

/// Emitted when tokens are withdrawn from treasury.
#[event]
pub struct TreasuryWithdrawal {
    /// The treasury PDA.
    pub treasury: Pubkey,
    /// The authority who made the withdrawal.
    pub authority: Pubkey,
    /// The destination token account.
    pub destination: Pubkey,
    /// The token mint.
    pub mint: Pubkey,
    /// The amount withdrawn.
    pub amount: u64,
}

// ===== Entity Events =====

/// Emitted when a new entity is created.
#[event]
pub struct EntityCreated {
    /// The entity PDA.
    pub entity: Pubkey,
    /// The entity creator.
    pub creator: Pubkey,
    /// The entity handle.
    pub handle: [u8; MAX_HANDLE_LENGTH],
    /// The initial controller.
    pub controller: Pubkey,
    /// Creation timestamp.
    pub created_at: i64,
}

/// Emitted when entity control is transferred.
#[event]
pub struct EntityControlTransferred {
    /// The entity PDA.
    pub entity: Pubkey,
    /// The previous controller.
    pub old_controller: Pubkey,
    /// The new controller.
    pub new_controller: Pubkey,
    /// Update timestamp.
    pub updated_at: i64,
}

// ===== Metadata Events =====

/// Emitted when a metadata schema is created.
#[event]
pub struct MetadataSchemaCreated {
    /// The schema PDA.
    pub schema: Pubkey,
    /// The schema ID.
    pub schema_id: [u8; MAX_SCHEMA_ID_LENGTH],
    /// The schema version.
    pub version: [u8; MAX_VERSION_LENGTH],
    /// The schema hash.
    pub hash: [u8; 32],
    /// The schema CID.
    pub cid: [u8; MAX_CID_LENGTH],
    /// The schema creator.
    pub creator: Pubkey,
    /// Creation timestamp.
    pub created_at: i64,
}

/// Emitted when entity metadata is created.
#[event]
pub struct EntityMetadataCreated {
    /// The metadata PDA.
    pub metadata: Pubkey,
    /// The entity this metadata belongs to.
    pub entity: Pubkey,
    /// The entity (acts as authority).
    pub authority: Pubkey,
    /// The metadata schema.
    pub schema: Pubkey,
    /// The metadata revision number.
    pub revision: u64,
    /// The metadata hash.
    pub hash: [u8; 32],
    /// The metadata CID.
    pub cid: [u8; MAX_CID_LENGTH],
    /// Creation timestamp.
    pub created_at: i64,
}

/// Emitted when IP metadata is created.
#[event]
pub struct IpMetadataCreated {
    /// The metadata PDA.
    pub metadata: Pubkey,
    /// The IP this metadata belongs to.
    pub ip: Pubkey,
    /// The owner entity.
    pub owner_entity: Pubkey,
    /// The metadata schema.
    pub schema: Pubkey,
    /// The metadata revision number.
    pub revision: u64,
    /// The metadata hash.
    pub hash: [u8; 32],
    /// The metadata CID.
    pub cid: [u8; MAX_CID_LENGTH],
    /// Creation timestamp.
    pub created_at: i64,
}

// ===== IP Events =====

/// Emitted when a new IP is registered.
#[event]
pub struct IpCreated {
    /// The IP account PDA.
    pub ip: Pubkey,
    /// The content hash.
    pub content_hash: [u8; 32],
    /// The registrant entity.
    pub registrant_entity: Pubkey,
    /// The registration fee paid.
    pub registration_fee: u64,
    /// Creation timestamp.
    pub created_at: i64,
}

/// Emitted when IP ownership is transferred.
#[event]
pub struct IpTransferred {
    /// The IP account PDA.
    pub ip: Pubkey,
    /// The previous owner entity.
    pub from_entity: Pubkey,
    /// The new owner entity.
    pub to_entity: Pubkey,
    /// The authority (from_entity) who authorized the transfer.
    pub authority: Pubkey,
}

// ===== Derivative Events =====

/// Emitted when a derivative link is created.
#[event]
pub struct DerivativeLinkCreated {
    /// The derivative link PDA.
    pub derivative_link: Pubkey,
    /// The parent IP.
    pub parent_ip: Pubkey,
    /// The child IP (derivative).
    pub child_ip: Pubkey,
    /// The license grant used.
    pub license_grant: Pubkey,
    /// The child IP owner entity.
    pub child_owner_entity: Pubkey,
    /// Creation timestamp.
    pub created_at: i64,
}

/// Emitted when a derivative link's license is updated.
#[event]
pub struct DerivativeLicenseUpdated {
    /// The derivative link PDA.
    pub derivative_link: Pubkey,
    /// The child IP.
    pub child_ip: Pubkey,
    /// The previous license grant.
    pub old_license_grant: Pubkey,
    /// The new license grant.
    pub new_license_grant: Pubkey,
    /// The authority (child owner entity) who authorized the change.
    pub authority: Pubkey,
}
