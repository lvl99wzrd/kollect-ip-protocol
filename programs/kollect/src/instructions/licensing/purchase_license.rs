use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use ip_core::state::entity::Entity;

use crate::error::KollectError;
use crate::events::LicensePurchased;
use crate::state::{
    IpConfig, IpTreasury, License, LicenseGrant, PlatformConfig, PlatformTreasury,
};
use crate::utils::seeds::{
    IP_CONFIG_SEED, IP_TREASURY_SEED, LICENSE_GRANT_SEED, LICENSE_SEED,
    PLATFORM_CONFIG_SEED, PLATFORM_TREASURY_SEED,
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
        seeds = [LICENSE_SEED, license.ip_account.as_ref(), license.license_template.as_ref()],
        bump = license.bump,
        constraint = license.is_active @ KollectError::LicenseNotActive,
    )]
    pub license: Box<Account<'info, License>>,

    /// The LicenseGrant created for the grantee.
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
        token::mint = config.currency,
    )]
    pub payer_token_account: Box<Account<'info, TokenAccount>>,

    /// Platform treasury token account to receive platform fee.
    #[account(
        mut,
        token::authority = platform_treasury,
        token::mint = config.currency,
    )]
    pub platform_token_account: Box<Account<'info, TokenAccount>>,

    /// IpConfig for the licensed IP (validates onboarding).
    #[account(
        seeds = [IP_CONFIG_SEED, license.ip_account.as_ref()],
        bump = ip_config.bump,
    )]
    pub ip_config: Box<Account<'info, IpConfig>>,

    /// IpTreasury to receive the net payment.
    #[account(
        mut,
        seeds = [IP_TREASURY_SEED, license.ip_account.as_ref()],
        bump = ip_treasury.bump,
    )]
    pub ip_treasury: Box<Account<'info, IpTreasury>>,

    /// IpTreasury's token account to receive net payment.
    #[account(
        mut,
        token::authority = ip_treasury,
        token::mint = config.currency,
    )]
    pub ip_treasury_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: grantee entity controller signer
}

pub fn handler(ctx: Context<PurchaseLicense>) -> Result<()> {
    let grantee_entity = &ctx.accounts.grantee_entity;
    validate_entity_controller(grantee_entity, ctx.remaining_accounts)?;

    let license = &ctx.accounts.license;

    // Check max_grants
    if license.max_grants > 0 {
        require!(
            license.current_grants < license.max_grants,
            KollectError::MaxGrantsReached
        );
    }

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let price = license.price;
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

        // Transfer net to IP treasury
        if net_to_owner > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.payer_token_account.to_account_info(),
                        to: ctx.accounts.ip_treasury_token_account.to_account_info(),
                        authority: ctx.accounts.payer.to_account_info(),
                    },
                ),
                net_to_owner,
            )?;

            // Update IpTreasury counter
            ctx.accounts.ip_treasury.total_earned = ctx
                .accounts
                .ip_treasury
                .total_earned
                .checked_add(net_to_owner)
                .ok_or(KollectError::ArithmeticOverflow)?;
        }
    }

    // Compute expiration
    let expiration = if license.grant_duration > 0 {
        now.checked_add(license.grant_duration)
            .ok_or(KollectError::ArithmeticOverflow)?
    } else {
        0 // perpetual
    };

    // Initialize LicenseGrant
    let grant = &mut ctx.accounts.license_grant;
    grant.license = ctx.accounts.license.key();
    grant.grantee = grantee_entity.key();
    grant.granted_at = now;
    grant.expiration = expiration;
    grant.price_paid = price;
    grant.bump = ctx.bumps.license_grant;

    // Increment current_grants
    let license = &mut ctx.accounts.license;
    license.current_grants = license
        .current_grants
        .checked_add(1)
        .ok_or(KollectError::ArithmeticOverflow)?;
    license.updated_at = now;

    emit!(LicensePurchased {
        grant: grant.key(),
        license: license.key(),
        grantee_entity: grantee_entity.key(),
        origin_ip: license.ip_account,
        price_paid: price,
        platform_fee,
        net_to_owner,
        expiration,
    });

    Ok(())
}
