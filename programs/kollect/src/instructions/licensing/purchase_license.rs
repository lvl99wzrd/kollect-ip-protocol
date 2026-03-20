use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use ip_core::state::entity::Entity;

use crate::error::KollectError;
use crate::events::LicensePurchased;
use crate::state::{License, LicenseGrant, LicenseTemplate, PlatformConfig, PlatformTreasury};
use crate::utils::seeds::{
    LICENSE_GRANT_SEED, LICENSE_SEED, LICENSE_TEMPLATE_SEED, PLATFORM_CONFIG_SEED,
    PLATFORM_TREASURY_SEED,
};
use crate::utils::validation::{calculate_bps, validate_entity_controller};

#[derive(Accounts)]
pub struct PurchaseLicense<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The grantee Entity purchasing the license.
    #[account(
        owner = ip_core::ID @ KollectError::InvalidIpCoreAccount,
    )]
    pub grantee_entity: Account<'info, Entity>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, PlatformConfig>>,

    #[account(
        seeds = [PLATFORM_TREASURY_SEED],
        bump = platform_treasury.bump,
    )]
    pub platform_treasury: Box<Account<'info, PlatformTreasury>>,

    #[account(
        mut,
        seeds = [LICENSE_TEMPLATE_SEED, license_template.ip_account.as_ref(), &license_template.template_name],
        bump = license_template.bump,
        constraint = license_template.is_active @ KollectError::LicenseTemplateNotActive,
    )]
    pub license_template: Box<Account<'info, LicenseTemplate>>,

    /// The thin License account associated with this template.
    #[account(
        seeds = [LICENSE_SEED, license_template.key().as_ref()],
        bump = license.bump,
    )]
    pub license: Box<Account<'info, License>>,

    /// The thin LicenseGrant created for the grantee.
    #[account(
        init,
        payer = payer,
        space = LicenseGrant::SIZE,
        seeds = [LICENSE_GRANT_SEED, license.key().as_ref(), grantee_entity.key().as_ref()],
        bump,
    )]
    pub license_grant: Box<Account<'info, LicenseGrant>>,

    /// Payer's token account for the license price payment.
    #[account(
        mut,
        token::authority = payer,
        token::mint = license_template.currency,
    )]
    pub payer_token_account: Box<Account<'info, TokenAccount>>,

    /// Platform treasury token account to receive platform fee.
    #[account(
        mut,
        token::authority = platform_treasury,
        token::mint = license_template.currency,
    )]
    pub platform_token_account: Box<Account<'info, TokenAccount>>,

    /// IP owner's treasury token account to receive net payment.
    #[account(
        mut,
        token::mint = license_template.currency,
    )]
    pub ip_owner_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: grantee entity controller signer
}

pub fn handler(ctx: Context<PurchaseLicense>) -> Result<()> {
    let grantee_entity = &ctx.accounts.grantee_entity;
    validate_entity_controller(grantee_entity, ctx.remaining_accounts)?;

    let template = &ctx.accounts.license_template;

    // Check max_grants
    if template.max_grants > 0 {
        require!(
            template.current_grants < template.max_grants,
            KollectError::MaxGrantsReached
        );
    }

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let price = template.price;
    let mut platform_fee = 0u64;
    let mut net_to_owner = 0u64;

    // Process payment if price > 0
    if price > 0 {
        platform_fee = calculate_bps(price, ctx.accounts.config.platform_fee_bps)?;
        net_to_owner = price
            .checked_sub(platform_fee)
            .ok_or(KollectError::ArithmeticOverflow)?;

        // Transfer platform fee
        if platform_fee > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.payer_token_account.to_account_info(),
                        to: ctx.accounts.platform_token_account.to_account_info(),
                        authority: ctx.accounts.payer.to_account_info(),
                    },
                ),
                platform_fee,
            )?;
        }

        // Transfer net to IP owner
        if net_to_owner > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.payer_token_account.to_account_info(),
                        to: ctx.accounts.ip_owner_token_account.to_account_info(),
                        authority: ctx.accounts.payer.to_account_info(),
                    },
                ),
                net_to_owner,
            )?;
        }
    }

    // Compute expiration
    let expiration = if template.grant_duration > 0 {
        now.checked_add(template.grant_duration)
            .ok_or(KollectError::ArithmeticOverflow)?
    } else {
        0 // perpetual
    };

    // Initialize LicenseGrant (thin account matching ip_core's LicenseGrantData)
    let grant = &mut ctx.accounts.license_grant;
    grant.license = ctx.accounts.license.key();
    grant.grantee = grantee_entity.key();
    grant.granted_at = now;
    grant.expiration = expiration;
    grant.bump = ctx.bumps.license_grant;

    // Increment current_grants
    let template = &mut ctx.accounts.license_template;
    template.current_grants = template
        .current_grants
        .checked_add(1)
        .ok_or(KollectError::ArithmeticOverflow)?;
    template.updated_at = now;

    emit!(LicensePurchased {
        grant: grant.key(),
        template: template.key(),
        grantee_entity: grantee_entity.key(),
        origin_ip: template.ip_account,
        price_paid: price,
        platform_fee,
        net_to_owner,
        expiration,
    });

    Ok(())
}
