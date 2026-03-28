use anchor_lang::prelude::*;
use ip_core::state::entity::Entity;

use crate::error::KollectError;
use crate::events::RoyaltyPolicyUpdated;
use crate::state::{IpConfig, LicenseTemplate, RoyaltyPolicy};
use crate::utils::seeds::{IP_CONFIG_SEED, LICENSE_TEMPLATE_SEED, ROYALTY_POLICY_SEED};
use crate::utils::validation::validate_entity_controller;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateRoyaltyPolicyParams {
    pub new_derivative_share_bps: Option<u16>,
    pub new_allow_remix: Option<bool>,
    pub new_allow_cover: Option<bool>,
    pub new_allow_sample: Option<bool>,
    pub new_attribution_required: Option<bool>,
    pub new_commercial_use: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateRoyaltyPolicy<'info> {
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
        mut,
        seeds = [ROYALTY_POLICY_SEED, license_template.key().as_ref()],
        bump = royalty_policy.bump,
    )]
    pub royalty_policy: Account<'info, RoyaltyPolicy>,
    // remaining_accounts: entity controller signer
}

pub fn handler(
    ctx: Context<UpdateRoyaltyPolicy>,
    params: UpdateRoyaltyPolicyParams,
) -> Result<()> {
    let entity = &ctx.accounts.entity;
    validate_entity_controller(entity, ctx.remaining_accounts)?;

    let policy = &mut ctx.accounts.royalty_policy;

    if let Some(share_bps) = params.new_derivative_share_bps {
        require!(share_bps <= 10_000, KollectError::InvalidShareBps);
        policy.derivative_share_bps = share_bps;
    }
    if let Some(allow_remix) = params.new_allow_remix {
        policy.allow_remix = allow_remix;
    }
    if let Some(allow_cover) = params.new_allow_cover {
        policy.allow_cover = allow_cover;
    }
    if let Some(allow_sample) = params.new_allow_sample {
        policy.allow_sample = allow_sample;
    }
    if let Some(attribution_required) = params.new_attribution_required {
        policy.attribution_required = attribution_required;
    }
    if let Some(commercial_use) = params.new_commercial_use {
        policy.commercial_use = commercial_use;
    }

    let clock = Clock::get()?;
    policy.updated_at = clock.unix_timestamp;

    emit!(RoyaltyPolicyUpdated {
        policy: policy.key(),
        derivative_share_bps: policy.derivative_share_bps,
        allow_remix: policy.allow_remix,
        allow_cover: policy.allow_cover,
        allow_sample: policy.allow_sample,
        attribution_required: policy.attribution_required,
        commercial_use: policy.commercial_use,
        updated_at: policy.updated_at,
    });

    Ok(())
}
