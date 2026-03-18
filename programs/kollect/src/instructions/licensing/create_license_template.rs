use anchor_lang::prelude::*;
use ip_core::state::entity::Entity;

use crate::constants::MAX_TEMPLATE_NAME_LENGTH;
use crate::error::KollectError;
use crate::events::LicenseTemplateCreated;
use crate::state::{IpConfig, License, LicenseTemplate};
use crate::utils::seeds::{IP_CONFIG_SEED, LICENSE_SEED, LICENSE_TEMPLATE_SEED};
use crate::utils::validation::validate_entity_controller;

#[derive(Accounts)]
#[instruction(template_name: [u8; MAX_TEMPLATE_NAME_LENGTH])]
pub struct CreateLicenseTemplate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        owner = ip_core::ID @ KollectError::InvalidIpCoreAccount,
    )]
    pub entity: Account<'info, Entity>,

    #[account(
        seeds = [IP_CONFIG_SEED, ip_config.ip_account.as_ref()],
        bump = ip_config.bump,
        constraint = ip_config.owner_entity == entity.key() @ KollectError::IpOwnerMismatch,
        constraint = ip_config.is_active @ KollectError::IpNotActive,
    )]
    pub ip_config: Account<'info, IpConfig>,

    #[account(
        init,
        payer = payer,
        space = LicenseTemplate::SIZE,
        seeds = [LICENSE_TEMPLATE_SEED, ip_config.ip_account.as_ref(), &template_name],
        bump,
    )]
    pub license_template: Account<'info, LicenseTemplate>,

    /// Thin License account created alongside the template for ip_core interop.
    #[account(
        init,
        payer = payer,
        space = License::SIZE,
        seeds = [LICENSE_SEED, license_template.key().as_ref()],
        bump,
    )]
    pub license: Account<'info, License>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: entity controller signer
}

pub fn handler(
    ctx: Context<CreateLicenseTemplate>,
    template_name: [u8; MAX_TEMPLATE_NAME_LENGTH],
    price: u64,
    currency: Pubkey,
    max_grants: u16,
    grant_duration: i64,
) -> Result<()> {
    let entity = &ctx.accounts.entity;
    validate_entity_controller(entity, ctx.remaining_accounts)?;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize LicenseTemplate
    let template = &mut ctx.accounts.license_template;
    template.ip_account = ctx.accounts.ip_config.ip_account;
    template.ip_config = ctx.accounts.ip_config.key();
    template.creator_entity = entity.key();
    template.template_name = template_name;
    template.price = price;
    template.currency = currency;
    template.max_grants = max_grants;
    template.current_grants = 0;
    template.grant_duration = grant_duration;
    template.is_active = true;
    template.created_at = now;
    template.updated_at = now;
    template.bump = ctx.bumps.license_template;

    // Initialize thin License (matches ip_core's LicenseData exactly)
    let license = &mut ctx.accounts.license;
    license.origin_ip = ctx.accounts.ip_config.ip_account;
    license.authority = entity.key();
    license.derivatives_allowed = true;
    license.created_at = now;
    license.bump = ctx.bumps.license;

    emit!(LicenseTemplateCreated {
        template: template.key(),
        license: license.key(),
        ip_account: template.ip_account,
        creator_entity: entity.key(),
        template_name,
        price,
        max_grants,
    });

    Ok(())
}
