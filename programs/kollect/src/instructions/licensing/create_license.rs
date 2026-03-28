use anchor_lang::prelude::*;
use ip_core::state::entity::Entity;

use crate::error::KollectError;
use crate::events::LicenseCreated;
use crate::state::{IpConfig, License, LicenseTemplate, PlatformConfig};
use crate::utils::seeds::{
    IP_CONFIG_SEED, LICENSE_SEED, LICENSE_TEMPLATE_SEED, PLATFORM_CONFIG_SEED,
};
use crate::utils::validation::validate_entity_controller;

#[derive(Accounts)]
pub struct CreateLicense<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        owner = ip_core::ID @ KollectError::InvalidIpCoreAccount,
    )]
    pub entity: Account<'info, Entity>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(
        mut,
        seeds = [IP_CONFIG_SEED, ip_config.ip_account.as_ref()],
        bump = ip_config.bump,
        constraint = ip_config.owner_entity == entity.key() @ KollectError::IpOwnerMismatch,
        constraint = ip_config.is_active @ KollectError::IpNotActive,
    )]
    pub ip_config: Account<'info, IpConfig>,

    #[account(
        seeds = [LICENSE_TEMPLATE_SEED, &license_template.template_id.to_le_bytes()],
        bump = license_template.bump,
        constraint = license_template.is_active @ KollectError::LicenseTemplateNotActive,
    )]
    pub license_template: Account<'info, LicenseTemplate>,

    #[account(
        init,
        payer = payer,
        space = License::SIZE,
        seeds = [LICENSE_SEED, ip_config.ip_account.as_ref(), license_template.key().as_ref()],
        bump,
    )]
    pub license: Account<'info, License>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: entity controller signer
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateLicenseParams {
    pub price: u64,
    pub max_grants: u16,
    pub grant_duration: i64,
    pub derivative_rev_share_bps: u16,
}

pub fn handler(ctx: Context<CreateLicense>, params: CreateLicenseParams) -> Result<()> {
    let entity = &ctx.accounts.entity;
    validate_entity_controller(entity, ctx.remaining_accounts)?;

    require!(
        params.grant_duration >= 0,
        KollectError::InvalidGrantDuration
    );
    require!(
        params.derivative_rev_share_bps <= 10_000,
        KollectError::InvalidShareBps
    );
    require!(
        params.derivative_rev_share_bps >= ctx.accounts.license_template.derivative_rev_share_bps,
        KollectError::DerivativeRevShareTooLow
    );

    // Enforce max_license_types limit (per-IP license count)
    let max_types = ctx.accounts.config.max_license_types;
    let current_count = ctx.accounts.ip_config.license_template_count;
    require!(
        current_count < max_types,
        KollectError::MaxLicenseTypesReached
    );

    // Increment per-IP license count
    ctx.accounts.ip_config.license_template_count = current_count
        .checked_add(1)
        .ok_or(KollectError::ArithmeticOverflow)?;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let license = &mut ctx.accounts.license;
    license.ip_account = ctx.accounts.ip_config.ip_account;
    license.ip_config = ctx.accounts.ip_config.key();
    license.license_template = ctx.accounts.license_template.key();
    license.owner_entity = entity.key();
    license.price = params.price;
    license.max_grants = params.max_grants;
    license.current_grants = 0;
    license.grant_duration = params.grant_duration;
    license.derivative_rev_share_bps = params.derivative_rev_share_bps;
    license.is_active = true;
    license.created_at = now;
    license.updated_at = now;
    license.bump = ctx.bumps.license;

    emit!(LicenseCreated {
        license: license.key(),
        ip_account: license.ip_account,
        license_template: license.license_template,
        owner_entity: entity.key(),
        price: params.price,
        max_grants: params.max_grants,
        derivative_rev_share_bps: params.derivative_rev_share_bps,
    });

    Ok(())
}
