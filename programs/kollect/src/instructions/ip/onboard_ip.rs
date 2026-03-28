use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use ip_core::state::{derivative_link::DerivativeLink, entity::Entity, ip_account::IpAccount};

use crate::error::KollectError;
use crate::events::{IpOnboarded, RoyaltySplitCreated};
use crate::state::{
    EntityTreasury, IpConfig, IpTreasury, License, PlatformConfig, RoyaltySplit,
};
use crate::utils::seeds::{
    ENTITY_TREASURY_SEED, IP_CONFIG_SEED, IP_TREASURY_SEED, LICENSE_GRANT_SEED,
    PLATFORM_CONFIG_SEED, ROYALTY_SPLIT_SEED,
};

#[derive(Accounts)]
pub struct OnboardIp<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ KollectError::InvalidAuthority,
    )]
    pub config: Account<'info, PlatformConfig>,

    /// The ip_core Entity that owns this IP.
    #[account(
        owner = ip_core::ID @ KollectError::InvalidIpCoreAccount,
    )]
    pub entity: Account<'info, Entity>,

    /// The ip_core IpAccount being onboarded.
    #[account(
        owner = ip_core::ID @ KollectError::InvalidIpCoreAccount,
        constraint = ip_account.current_owner_entity == entity.key() @ KollectError::IpOwnerMismatch,
    )]
    pub ip_account: Account<'info, IpAccount>,

    #[account(
        init,
        payer = authority,
        space = IpConfig::SIZE,
        seeds = [IP_CONFIG_SEED, ip_account.key().as_ref()],
        bump,
    )]
    pub ip_config: Account<'info, IpConfig>,

    #[account(
        init,
        payer = authority,
        space = IpTreasury::SIZE,
        seeds = [IP_TREASURY_SEED, ip_account.key().as_ref()],
        bump,
    )]
    pub ip_treasury: Account<'info, IpTreasury>,

    #[account(
        seeds = [ENTITY_TREASURY_SEED, entity.key().as_ref()],
        bump = entity_treasury.bump,
    )]
    pub entity_treasury: Account<'info, EntityTreasury>,

    #[account(
        constraint = currency_mint.key() == config.currency @ KollectError::InvalidCurrency,
    )]
    pub currency_mint: Account<'info, Mint>,

    /// ATA for the IP treasury to hold currency tokens.
    #[account(
        init,
        payer = authority,
        associated_token::mint = currency_mint,
        associated_token::authority = ip_treasury,
    )]
    pub ip_treasury_token_account: Account<'info, TokenAccount>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    // remaining_accounts when onboarding a derivative (empty otherwise):
    // [0] derivative_link (ip_core-owned)
    // [1] license_grant (PDA: [LICENSE_GRANT_SEED, license.key, entity.key])
    // [2] license (PDA: [LICENSE_SEED, ip_account.key, license_template.key])
    // [3] royalty_split (uninit PDA: [ROYALTY_SPLIT_SEED, child_ip.key, parent_ip.key])
}

pub fn handler<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, OnboardIp<'info>>,
    price_per_play_override: Option<u64>,
) -> Result<()> {
    let entity = &ctx.accounts.entity;
    // Infer derivative status from remaining_accounts presence
    let is_derivative = !ctx.remaining_accounts.is_empty();

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize IpConfig
    let ip_config = &mut ctx.accounts.ip_config;
    ip_config.ip_account = ctx.accounts.ip_account.key();
    ip_config.owner_entity = entity.key();
    ip_config.price_per_play_override = price_per_play_override;
    ip_config.is_active = true;
    ip_config.license_template_count = 0;
    ip_config.onboarded_at = now;
    ip_config.updated_at = now;
    ip_config.bump = ctx.bumps.ip_config;

    // Initialize IpTreasury
    let ip_treasury = &mut ctx.accounts.ip_treasury;
    ip_treasury.ip_account = ctx.accounts.ip_account.key();
    ip_treasury.ip_config = ip_config.key();
    ip_treasury.entity_treasury = ctx.accounts.entity_treasury.key();
    ip_treasury.total_earned = 0;
    ip_treasury.total_settled = 0;
    ip_treasury.bump = ctx.bumps.ip_treasury;

    emit!(IpOnboarded {
        ip_config: ip_config.key(),
        ip_account: ctx.accounts.ip_account.key(),
        owner_entity: entity.key(),
        price_override: price_per_play_override,
        is_derivative,
        onboarded_at: now,
    });

    // If remaining_accounts are present, this is a derivative — auto-create RoyaltySplit.
    if is_derivative {
        create_royalty_split_for_derivative(&ctx, now)?;
    }

    Ok(())
}

/// Creates a RoyaltySplit when onboarding a derivative IP.
/// Expects remaining_accounts:
///   [0] derivative_link   — ip_core-owned DerivativeLink for child_ip
///   [1] license_grant     — PDA [LICENSE_GRANT_SEED, license.key, entity.key]
///   [2] license           — PDA [LICENSE_SEED, parent_ip.key, license_template.key]
///   [3] royalty_split     — uninit PDA [ROYALTY_SPLIT_SEED, child_ip.key, parent_ip.key]
fn create_royalty_split_for_derivative<'a, 'b, 'c, 'info>(
    ctx: &Context<'a, 'b, 'c, 'info, OnboardIp<'info>>,
    now: i64,
) -> Result<()> {
    let ip_account = &ctx.accounts.ip_account;
    let entity = &ctx.accounts.entity;
    let remaining = ctx.remaining_accounts;

    require!(remaining.len() >= 4, KollectError::InvalidDerivativeLink);

    let derivative_link_info = &remaining[0];
    let license_grant_info = &remaining[1];
    let license_info = &remaining[2];
    let royalty_split_info = &remaining[3];

    // Validate derivative_link is owned by ip_core
    require!(
        derivative_link_info.owner == &ip_core::ID,
        KollectError::InvalidIpCoreAccount
    );

    // Deserialize the derivative link
    let derivative_link_data = derivative_link_info.try_borrow_data()?;
    let derivative_link = DerivativeLink::try_deserialize(&mut &derivative_link_data[..])
        .map_err(|_| error!(KollectError::InvalidDerivativeLink))?;

    // Validate the derivative link references our IP as child
    require!(
        derivative_link.child_ip == ip_account.key(),
        KollectError::InvalidDerivativeLink
    );

    // Validate derivative link's license field references the provided license grant.
    require!(
        derivative_link.license == license_grant_info.key(),
        KollectError::InvalidDerivativeLink
    );

    // Validate the License account is owned by this program
    require!(
        license_info.owner == ctx.program_id,
        KollectError::InvalidLicenseTemplate
    );

    // Deserialize License and validate relationships
    let license_data = license_info.try_borrow_data()?;
    let license = License::try_deserialize(&mut &license_data[..])
        .map_err(|_| error!(KollectError::InvalidLicenseTemplate))?;

    // License must reference the parent IP
    require!(
        license.ip_account == derivative_link.parent_ip,
        KollectError::InvalidLicenseTemplate
    );

    // Verify the LicenseGrant PDA for this entity under the license
    let (expected_grant_key, _) = Pubkey::find_program_address(
        &[
            LICENSE_GRANT_SEED,
            license_info.key().as_ref(),
            entity.key().as_ref(),
        ],
        ctx.program_id,
    );
    require!(
        license_grant_info.key() == expected_grant_key,
        KollectError::InvalidLicenseTemplate
    );

    // Derive expected RoyaltySplit PDA
    let parent_ip = derivative_link.parent_ip;
    let (expected_split_key, split_bump) = Pubkey::find_program_address(
        &[
            ROYALTY_SPLIT_SEED,
            ip_account.key().as_ref(),
            parent_ip.as_ref(),
        ],
        ctx.program_id,
    );
    require!(
        *royalty_split_info.key == expected_split_key,
        KollectError::InvalidRoyaltySplitPda
    );

    // Create the RoyaltySplit account via system program
    let space = RoyaltySplit::SIZE;
    let rent = Rent::get()?.minimum_balance(space);

    anchor_lang::system_program::create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::CreateAccount {
                from: ctx.accounts.authority.to_account_info(),
                to: royalty_split_info.clone(),
            },
            &[&[
                ROYALTY_SPLIT_SEED,
                ip_account.key().as_ref(),
                parent_ip.as_ref(),
                &[split_bump],
            ]],
        ),
        rent,
        space as u64,
        ctx.program_id,
    )?;

    // Serialize the RoyaltySplit data into the new account
    let mut split_data = royalty_split_info.try_borrow_mut_data()?;
    let split = RoyaltySplit {
        derivative_ip: ip_account.key(),
        origin_ip: parent_ip,
        license_grant: license_grant_info.key(),
        license: license_info.key(),
        share_bps: license.derivative_rev_share_bps,
        total_distributed: 0,
        created_at: now,
        bump: split_bump,
    };
    let discriminator = RoyaltySplit::DISCRIMINATOR;
    split_data[..8].copy_from_slice(discriminator);
    let serialized = split.try_to_vec()?;
    split_data[8..8 + serialized.len()].copy_from_slice(&serialized);

    emit!(RoyaltySplitCreated {
        split: expected_split_key,
        derivative_ip: ip_account.key(),
        origin_ip: parent_ip,
        share_bps: license.derivative_rev_share_bps,
    });

    Ok(())
}
