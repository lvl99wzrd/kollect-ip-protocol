use anchor_lang::prelude::*;

use crate::error::KollectError;
use crate::events::LicenseTemplateUpdated;
use crate::state::LicenseTemplate;
use crate::utils::seeds::LICENSE_TEMPLATE_SEED;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateLicenseTemplateParams {
    pub new_is_active: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateLicenseTemplate<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [LICENSE_TEMPLATE_SEED, &license_template.template_id.to_le_bytes()],
        bump = license_template.bump,
        constraint = license_template.creator == authority.key() @ KollectError::InvalidAuthority,
    )]
    pub license_template: Account<'info, LicenseTemplate>,
}

pub fn handler(
    ctx: Context<UpdateLicenseTemplate>,
    params: UpdateLicenseTemplateParams,
) -> Result<()> {
    let template = &mut ctx.accounts.license_template;

    if let Some(is_active) = params.new_is_active {
        template.is_active = is_active;
    }

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    emit!(LicenseTemplateUpdated {
        template: template.key(),
        is_active: template.is_active,
        updated_at: now,
    });

    Ok(())
}

