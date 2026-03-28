use anchor_lang::prelude::*;
use ip_core::state::entity::Entity;

use crate::error::KollectError;
use crate::events::IpConfigUpdated;
use crate::state::IpConfig;
use crate::utils::seeds::IP_CONFIG_SEED;
use crate::utils::validation::validate_entity_controller;

#[derive(Accounts)]
pub struct UpdateIpConfig<'info> {
    #[account(
        owner = ip_core::ID @ KollectError::InvalidIpCoreAccount,
    )]
    pub entity: Account<'info, Entity>,

    #[account(
        mut,
        seeds = [IP_CONFIG_SEED, ip_config.ip_account.as_ref()],
        bump = ip_config.bump,
        constraint = ip_config.owner_entity == entity.key() @ KollectError::IpOwnerMismatch,
        constraint = ip_config.is_active @ KollectError::IpNotActive,
    )]
    pub ip_config: Account<'info, IpConfig>,
    // remaining_accounts: entity controller signer
}

pub fn handler(
    ctx: Context<UpdateIpConfig>,
    new_price_per_play_override: Option<Option<u64>>,
) -> Result<()> {
    let entity = &ctx.accounts.entity;
    validate_entity_controller(entity, ctx.remaining_accounts)?;

    let ip_config = &mut ctx.accounts.ip_config;
    let clock = Clock::get()?;

    if let Some(price_override) = new_price_per_play_override {
        ip_config.price_per_play_override = price_override;
    }

    ip_config.updated_at = clock.unix_timestamp;

    emit!(IpConfigUpdated {
        ip_config: ip_config.key(),
        price_per_play_override: ip_config.price_per_play_override,
        updated_at: ip_config.updated_at,
    });

    Ok(())
}
