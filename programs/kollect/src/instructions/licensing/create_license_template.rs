use anchor_lang::prelude::*;

use crate::constants::{MAX_TEMPLATE_NAME_LENGTH, MAX_URI_LENGTH};
use crate::error::KollectError;
use crate::events::LicenseTemplateCreated;
use crate::state::{LicenseTemplate, TemplateConfig};
use crate::utils::seeds::{LICENSE_TEMPLATE_SEED, TEMPLATE_CONFIG_SEED};

#[derive(Accounts)]
pub struct CreateLicenseTemplate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [TEMPLATE_CONFIG_SEED],
        bump = template_config.bump,
    )]
    pub template_config: Account<'info, TemplateConfig>,

    #[account(
        init,
        payer = payer,
        space = LicenseTemplate::SIZE,
        seeds = [LICENSE_TEMPLATE_SEED, &template_config.template_count.to_le_bytes()],
        bump,
    )]
    pub license_template: Account<'info, LicenseTemplate>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateLicenseTemplateParams {
    pub template_name: [u8; MAX_TEMPLATE_NAME_LENGTH],
    pub transferable: bool,
    pub derivatives_allowed: bool,
    pub derivatives_reciprocal: bool,
    pub derivatives_approval: bool,
    pub commercial_use: bool,
    pub commercial_attribution: bool,
    pub commercial_rev_share_bps: u16,
    pub derivative_rev_share_bps: u16,
    pub uri: [u8; MAX_URI_LENGTH],
}

pub fn handler(
    ctx: Context<CreateLicenseTemplate>,
    params: CreateLicenseTemplateParams,
) -> Result<()> {
    require!(
        params.commercial_rev_share_bps <= 10_000,
        KollectError::InvalidShareBps
    );
    require!(
        params.derivative_rev_share_bps <= 10_000,
        KollectError::InvalidShareBps
    );

    let clock = Clock::get()?;
    let template_id = ctx.accounts.template_config.template_count;

    // Initialize LicenseTemplate
    let template = &mut ctx.accounts.license_template;
    template.template_id = template_id;
    template.creator = ctx.accounts.payer.key();
    template.template_name = params.template_name;
    template.transferable = params.transferable;
    template.derivatives_allowed = params.derivatives_allowed;
    template.derivatives_reciprocal = params.derivatives_reciprocal;
    template.derivatives_approval = params.derivatives_approval;
    template.commercial_use = params.commercial_use;
    template.commercial_attribution = params.commercial_attribution;
    template.commercial_rev_share_bps = params.commercial_rev_share_bps;
    template.derivative_rev_share_bps = params.derivative_rev_share_bps;
    template.uri = params.uri;
    template.is_active = true;
    template.created_at = clock.unix_timestamp;
    template.bump = ctx.bumps.license_template;

    // Increment counter
    ctx.accounts.template_config.template_count = template_id
        .checked_add(1)
        .ok_or(KollectError::ArithmeticOverflow)?;

    emit!(LicenseTemplateCreated {
        template: template.key(),
        template_id,
        creator: ctx.accounts.payer.key(),
        template_name: params.template_name,
        derivatives_allowed: params.derivatives_allowed,
        commercial_use: params.commercial_use,
        derivative_rev_share_bps: params.derivative_rev_share_bps,
    });

    Ok(())
}

