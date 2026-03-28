use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use constants::{MAX_CID_LENGTH, MAX_SCHEMA_ID_LENGTH, MAX_VERSION_LENGTH};
use instructions::*;

declare_id!("ARoG6DV6Mx4w44tM9QGYoMaqXUBM6zCwyMBRDLt5vAap");

#[program]
pub mod ip_core {
    use super::*;

    // ===== Protocol Instructions =====

    /// Initialize the protocol configuration.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        treasury: Pubkey,
        registration_currency: Pubkey,
        registration_fee: u64,
    ) -> Result<()> {
        instructions::protocol::initialize_config::handler(
            ctx,
            treasury,
            registration_currency,
            registration_fee,
        )
    }

    /// Update the protocol configuration.
    pub fn update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
        instructions::protocol::update_config::handler(ctx, params)
    }

    /// Initialize the protocol treasury.
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        instructions::protocol::initialize_treasury::handler(ctx)
    }

    /// Withdraw tokens from the protocol treasury.
    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
        instructions::protocol::withdraw_treasury::handler(ctx, amount)
    }

    // ===== Entity Instructions =====

    /// Create a new entity.
    pub fn create_entity(ctx: Context<CreateEntity>) -> Result<()> {
        instructions::entity::create_entity::handler(ctx)
    }

    /// Transfer entity control to a new controller.
    pub fn transfer_entity_control(
        ctx: Context<TransferEntityControl>,
        new_controller: Pubkey,
    ) -> Result<()> {
        instructions::entity::transfer_entity_control::handler(ctx, new_controller)
    }

    // ===== Metadata Instructions =====

    /// Create a new metadata schema.
    pub fn create_metadata_schema(
        ctx: Context<CreateMetadataSchema>,
        id: [u8; MAX_SCHEMA_ID_LENGTH],
        version: [u8; MAX_VERSION_LENGTH],
        hash: [u8; 32],
        cid: [u8; MAX_CID_LENGTH],
    ) -> Result<()> {
        instructions::metadata::create_metadata_schema::handler(ctx, id, version, hash, cid)
    }

    /// Create metadata for an entity.
    pub fn create_entity_metadata(
        ctx: Context<CreateEntityMetadata>,
        hash: [u8; 32],
        cid: [u8; MAX_CID_LENGTH],
    ) -> Result<()> {
        instructions::metadata::create_entity_metadata::handler(ctx, hash, cid)
    }

    /// Create metadata for an IP.
    pub fn create_ip_metadata(
        ctx: Context<CreateIpMetadata>,
        hash: [u8; 32],
        cid: [u8; MAX_CID_LENGTH],
    ) -> Result<()> {
        instructions::metadata::create_ip_metadata::handler(ctx, hash, cid)
    }

    // ===== IP Instructions =====

    /// Register a new IP.
    pub fn create_ip(ctx: Context<CreateIp>, content_hash: [u8; 32]) -> Result<()> {
        instructions::ip::create_ip::handler(ctx, content_hash)
    }

    /// Transfer IP ownership.
    pub fn transfer_ip(ctx: Context<TransferIp>) -> Result<()> {
        instructions::ip::transfer_ip::handler(ctx)
    }

    // ===== Derivative Instructions =====

    /// Create a derivative link between IPs.
    pub fn create_derivative_link(ctx: Context<CreateDerivativeLink>) -> Result<()> {
        instructions::derivative::create_derivative_link::handler(ctx)
    }

    /// Update the license on a derivative link.
    pub fn update_derivative_license(ctx: Context<UpdateDerivativeLicense>) -> Result<()> {
        instructions::derivative::update_derivative_license::handler(ctx)
    }
}
