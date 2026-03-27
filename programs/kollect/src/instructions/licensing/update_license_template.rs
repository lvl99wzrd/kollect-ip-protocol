use anchor_lang::prelude::*;
use ip_core::state::entity::Entity;

use crate::error::KollectError;
use crate::events::LicenseTemplateUpdated;
use crate::state::{IpConfig, LicenseTemplate};
use crate::utils::seeds::{IP_CONFIG_SEED, LICENSE_TEMPLATE_SEED};
use crate::utils::validation::validate_entity_controller;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateLicenseTemplateParams {
    pub new_price: Option<u64>,
    pub new_grant_duration: Option<i64>,
    pub new_is_active: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateLicenseTemplate<'info> {
    #[account(
        owner = ip_core::ID @ KollectError::InvalidIpCoreAccount,
    )]
    pub entity: Account<'info, Entity>,

    #[account(
        seeds = [IP_CONFIG_SEED, ip_config.ip_account.as_ref()],
        bump = ip_config.bump,
        constraint = ip_config.owner_entity == entity.key() @ KollectError::IpOwnerMismatch,
    )]
    pub ip_config: Account<'info, IpConfig>,

    #[account(
        mut,
        seeds = [LICENSE_TEMPLATE_SEED, license_template.ip_account.as_ref(), &license_template.template_name],
        bump = license_template.bump,
        constraint = license_template.creator_entity == entity.key() @ KollectError::InvalidAuthority,
    )]
    pub license_template: Account<'info, LicenseTemplate>,
    // remaining_accounts: entity controller signer
}

pub fn handler(
    ctx: Context<UpdateLicenseTemplate>,
    params: UpdateLicenseTemplateParams,
) -> Result<()> {
    let entity = &ctx.accounts.entity;
    validate_entity_controller(entity, ctx.remaining_accounts)?;

    let template = &mut ctx.accounts.license_template;

    if let Some(price) = params.new_price {
        template.price = price;
    }
    if let Some(duration) = params.new_grant_duration {
        require!(duration >= 0, KollectError::InvalidGrantDuration);
        template.grant_duration = duration;
    }
    if let Some(is_active) = params.new_is_active {
        template.is_active = is_active;
    }

    let clock = Clock::get()?;
    template.updated_at = clock.unix_timestamp;

    emit!(LicenseTemplateUpdated {
        template: template.key(),
        price: template.price,
        max_grants: template.max_grants,
        grant_duration: template.grant_duration,
        is_active: template.is_active,
        updated_at: template.updated_at,
    });

    Ok(())
}

