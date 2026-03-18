use anchor_lang::prelude::*;
use ip_core::state::{derivative_link::DerivativeLink, entity::Entity, ip_account::IpAccount};

use crate::error::KollectError;
use crate::events::{IpOnboarded, RoyaltySplitCreated};
use crate::state::{
    EntityTreasury, IpConfig, IpTreasury, LicenseGrant, RoyaltyPolicy, RoyaltySplit,
};
use crate::utils::seeds::{
    ENTITY_TREASURY_SEED, IP_CONFIG_SEED, IP_TREASURY_SEED, ROYALTY_SPLIT_SEED,
};
use crate::utils::validation::validate_entity_controller;

#[derive(Accounts)]
pub struct OnboardIp<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

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
        payer = payer,
        space = IpConfig::SIZE,
        seeds = [IP_CONFIG_SEED, ip_account.key().as_ref()],
        bump,
    )]
    pub ip_config: Account<'info, IpConfig>,

    #[account(
        init,
        payer = payer,
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

    pub system_program: Program<'info, System>,
    // remaining_accounts: entity controller signer
}

/// Accounts needed only when onboarding a derivative IP (optional).
#[derive(Accounts)]
pub struct OnboardDerivativeAccounts<'info> {
    /// DerivativeLink from ip_core proving derivative relationship.
    #[account(
        owner = ip_core::ID @ KollectError::InvalidIpCoreAccount,
    )]
    pub derivative_link: Account<'info, DerivativeLink>,

    /// The LicenseGrant under which the derivative was created.
    pub license_grant: Account<'info, LicenseGrant>,

    /// The RoyaltyPolicy governing how revenue is shared back to origin.
    pub royalty_policy: Account<'info, RoyaltyPolicy>,
}

pub fn handler<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, OnboardIp<'info>>,
    price_per_play_override: Option<u64>,
    is_derivative: bool,
) -> Result<()> {
    let entity = &ctx.accounts.entity;
    validate_entity_controller(entity, ctx.remaining_accounts)?;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize IpConfig
    let ip_config = &mut ctx.accounts.ip_config;
    ip_config.ip_account = ctx.accounts.ip_account.key();
    ip_config.owner_entity = entity.key();
    ip_config.price_per_play_override = price_per_play_override;
    ip_config.is_active = true;
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

    // If this is a derivative, auto-create a RoyaltySplit.
    // The derivative accounts are passed as additional remaining_accounts
    // after the entity controller signers.
    if is_derivative {
        create_royalty_split_for_derivative(&ctx, now)?;
    }

    Ok(())
}

/// Creates a RoyaltySplit when onboarding a derivative IP.
/// Expects the following accounts in `remaining_accounts` after entity signers:
/// [derivative_link, license_grant, royalty_policy, royalty_split (init)]
fn create_royalty_split_for_derivative<'a, 'b, 'c, 'info>(
    ctx: &Context<'a, 'b, 'c, 'info, OnboardIp<'info>>,
    now: i64,
) -> Result<()> {
    let ip_account = &ctx.accounts.ip_account;

    // The remaining_accounts layout after controller signer:
    // We need derivative_link, license_grant, royalty_policy, royalty_split (uninit)
    // Single controller signer is always at index 0
    let derivative_accounts = &ctx.remaining_accounts[1..];

    require!(
        derivative_accounts.len() >= 4,
        KollectError::InvalidDerivativeLink
    );

    let derivative_link_info = &derivative_accounts[0];
    let _license_grant_info = &derivative_accounts[1];
    let royalty_policy_info = &derivative_accounts[2];
    let royalty_split_info = &derivative_accounts[3];

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

    // Deserialize royalty policy
    let royalty_policy_data = royalty_policy_info.try_borrow_data()?;
    let royalty_policy = RoyaltyPolicy::try_deserialize(&mut &royalty_policy_data[..])
        .map_err(|_| error!(KollectError::InvalidLicenseTemplate))?;

    // Derive expected PDA for the royalty_split
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
        KollectError::RoyaltySplitAlreadyExists
    );

    // Create the RoyaltySplit account via system program
    let space = RoyaltySplit::SIZE;
    let rent = Rent::get()?.minimum_balance(space);

    anchor_lang::system_program::create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::CreateAccount {
                from: ctx.accounts.payer.to_account_info(),
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

    // Write the RoyaltySplit data
    let mut split_data = royalty_split_info.try_borrow_mut_data()?;
    let split = RoyaltySplit {
        derivative_ip: ip_account.key(),
        origin_ip: parent_ip,
        license_grant: derivative_link.license,
        royalty_policy: royalty_policy_info.key(),
        share_bps: royalty_policy.derivative_share_bps,
        total_distributed: 0,
        created_at: now,
        bump: split_bump,
    };
    // Write discriminator + data
    let discriminator = RoyaltySplit::DISCRIMINATOR;
    split_data[..8].copy_from_slice(discriminator);
    let serialized = split.try_to_vec()?;
    split_data[8..8 + serialized.len()].copy_from_slice(&serialized);

    emit!(RoyaltySplitCreated {
        split: expected_split_key,
        derivative_ip: ip_account.key(),
        origin_ip: parent_ip,
        share_bps: royalty_policy.derivative_share_bps,
    });

    Ok(())
}
