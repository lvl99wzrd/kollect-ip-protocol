use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use constants::{MAX_CID_LENGTH, MAX_HANDLE_LENGTH, MAX_SCHEMA_ID_LENGTH, MAX_VERSION_LENGTH};
use instructions::*;

declare_id!("47gfhX3eMBKzxHejX5n8HXxWSg8qi6DcbHDRRRXSoUUw");

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
    pub fn create_entity(
        ctx: Context<CreateEntity>,
        handle: [u8; MAX_HANDLE_LENGTH],
        additional_controllers: Vec<Pubkey>,
        signature_threshold: u8,
    ) -> Result<()> {
        instructions::entity::create_entity::handler(
            ctx,
            handle,
            additional_controllers,
            signature_threshold,
        )
    }

    /// Update entity controllers by replacing the entire controller list.
    pub fn update_entity_controllers(
        ctx: Context<UpdateEntityControllers>,
        new_controllers: Vec<Pubkey>,
        new_threshold: u8,
    ) -> Result<()> {
        instructions::entity::update_entity_controllers::handler(
            ctx,
            new_controllers,
            new_threshold,
        )
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
        revision: u64,
        hash: [u8; 32],
        cid: [u8; MAX_CID_LENGTH],
    ) -> Result<()> {
        instructions::metadata::create_entity_metadata::handler(ctx, revision, hash, cid)
    }

    /// Create metadata for an IP.
    pub fn create_ip_metadata(
        ctx: Context<CreateIpMetadata>,
        revision: u64,
        hash: [u8; 32],
        cid: [u8; MAX_CID_LENGTH],
    ) -> Result<()> {
        instructions::metadata::create_ip_metadata::handler(ctx, revision, hash, cid)
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
    pub fn create_derivative_link(
        ctx: Context<CreateDerivativeLink>,
        license_program_id: Pubkey,
    ) -> Result<()> {
        instructions::derivative::create_derivative_link::handler(ctx, license_program_id)
    }

    /// Update the license on a derivative link.
    pub fn update_derivative_license(
        ctx: Context<UpdateDerivativeLicense>,
        license_program_id: Pubkey,
    ) -> Result<()> {
        instructions::derivative::update_derivative_license::handler(ctx, license_program_id)
    }
}
