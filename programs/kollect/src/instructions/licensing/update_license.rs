use anchor_lang::prelude::*;
use ip_core::state::entity::Entity;

use crate::error::KollectError;
use crate::events::LicenseUpdated;
use crate::state::{IpConfig, License, LicenseTemplate};
use crate::utils::seeds::{IP_CONFIG_SEED, LICENSE_SEED, LICENSE_TEMPLATE_SEED};
use crate::utils::validation::validate_entity_controller;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateLicenseParams {
    pub new_price: Option<u64>,
    pub new_grant_duration: Option<i64>,
    pub new_is_active: Option<bool>,
    pub new_derivative_rev_share_bps: Option<u16>,
}

#[derive(Accounts)]
pub struct UpdateLicense<'info> {
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
        seeds = [LICENSE_TEMPLATE_SEED, &license_template.template_id.to_le_bytes()],
        bump = license_template.bump,
    )]
    pub license_template: Account<'info, LicenseTemplate>,

    #[account(
        mut,
        seeds = [LICENSE_SEED, license.ip_account.as_ref(), license_template.key().as_ref()],
        bump = license.bump,
        constraint = license.owner_entity == entity.key() @ KollectError::IpOwnerMismatch,
    )]
    pub license: Account<'info, License>,
    // remaining_accounts: entity controller signer
}

pub fn handler(ctx: Context<UpdateLicense>, params: UpdateLicenseParams) -> Result<()> {
    let entity = &ctx.accounts.entity;
    validate_entity_controller(entity, ctx.remaining_accounts)?;

    let license = &mut ctx.accounts.license;

    if let Some(price) = params.new_price {
        license.price = price;
    }
    if let Some(duration) = params.new_grant_duration {
        require!(duration >= 0, KollectError::InvalidGrantDuration);
        license.grant_duration = duration;
    }
    if let Some(is_active) = params.new_is_active {
        license.is_active = is_active;
    }
    if let Some(bps) = params.new_derivative_rev_share_bps {
        require!(bps <= 10_000, KollectError::InvalidShareBps);
        require!(
            bps >= ctx.accounts.license_template.derivative_rev_share_bps,
            KollectError::DerivativeRevShareTooLow
        );
        license.derivative_rev_share_bps = bps;
    }

    let clock = Clock::get()?;
    license.updated_at = clock.unix_timestamp;

    emit!(LicenseUpdated {
        license: license.key(),
        price: license.price,
        grant_duration: license.grant_duration,
        is_active: license.is_active,
        derivative_rev_share_bps: license.derivative_rev_share_bps,
        updated_at: license.updated_at,
    });

    Ok(())
}
