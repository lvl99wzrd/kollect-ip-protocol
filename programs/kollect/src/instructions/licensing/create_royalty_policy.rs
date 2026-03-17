use anchor_lang::prelude::*;
use ip_core::state::entity::Entity;

use crate::error::KollectError;
use crate::events::RoyaltyPolicyCreated;
use crate::state::{IpConfig, LicenseTemplate, RoyaltyPolicy};
use crate::utils::seeds::{IP_CONFIG_SEED, LICENSE_TEMPLATE_SEED, ROYALTY_POLICY_SEED};
use crate::utils::validation::validate_entity_multisig;

#[derive(Accounts)]
pub struct CreateRoyaltyPolicy<'info> {
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
    )]
    pub ip_config: Account<'info, IpConfig>,

    #[account(
        seeds = [LICENSE_TEMPLATE_SEED, license_template.ip_account.as_ref(), &license_template.template_name],
        bump = license_template.bump,
        constraint = license_template.creator_entity == entity.key() @ KollectError::InvalidAuthority,
    )]
    pub license_template: Account<'info, LicenseTemplate>,

    #[account(
        init,
        payer = payer,
        space = RoyaltyPolicy::SIZE,
        seeds = [ROYALTY_POLICY_SEED, license_template.key().as_ref()],
        bump,
    )]
    pub royalty_policy: Account<'info, RoyaltyPolicy>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: entity controller signers
}

pub fn handler(
    ctx: Context<CreateRoyaltyPolicy>,
    derivative_share_bps: u16,
    allow_remix: bool,
    allow_cover: bool,
    allow_sample: bool,
    attribution_required: bool,
    commercial_use: bool,
) -> Result<()> {
    let entity = &ctx.accounts.entity;
    validate_entity_multisig(entity, ctx.remaining_accounts)?;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let policy = &mut ctx.accounts.royalty_policy;
    policy.license_template = ctx.accounts.license_template.key();
    policy.derivative_share_bps = derivative_share_bps;
    policy.allow_remix = allow_remix;
    policy.allow_cover = allow_cover;
    policy.allow_sample = allow_sample;
    policy.attribution_required = attribution_required;
    policy.commercial_use = commercial_use;
    policy.created_at = now;
    policy.updated_at = now;
    policy.bump = ctx.bumps.royalty_policy;

    emit!(RoyaltyPolicyCreated {
        policy: policy.key(),
        template: ctx.accounts.license_template.key(),
        derivative_share_bps,
        allow_remix,
        allow_cover,
        allow_sample,
    });

    Ok(())
}
