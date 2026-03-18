use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

use crate::error::IpCoreError;
use crate::events::IpCreated;
use crate::state::{Entity, IpAccount, ProtocolConfig, ProtocolTreasury, IP_ACCOUNT_SIZE};
use crate::utils::seeds::{CONFIG_SEED, ENTITY_SEED, IP_SEED, TREASURY_SEED};

/// Accounts required for create_ip instruction.
#[derive(Accounts)]
#[instruction(content_hash: [u8; 32])]
pub struct CreateIp<'info> {
    /// The IP account to create (PDA).
    #[account(
        init,
        payer = payer,
        space = IP_ACCOUNT_SIZE,
        seeds = [IP_SEED, registrant_entity.key().as_ref(), &content_hash],
        bump
    )]
    pub ip: Account<'info, IpAccount>,

    /// The entity registering this IP.
    #[account(
        seeds = [ENTITY_SEED, registrant_entity.creator.as_ref(), &registrant_entity.handle],
        bump = registrant_entity.bump
    )]
    pub registrant_entity: Account<'info, Entity>,

    /// Protocol configuration.
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, ProtocolConfig>,

    /// Protocol treasury.
    #[account(
        seeds = [TREASURY_SEED],
        bump = treasury.bump,
        constraint = treasury.config == config.key() @ IpCoreError::InvalidAuthority
    )]
    pub treasury: Account<'info, ProtocolTreasury>,

    /// Treasury's token account to receive the registration fee.
    #[account(
        mut,
        constraint = treasury_token_account.mint == config.registration_currency @ IpCoreError::InvalidTokenMint,
        constraint = treasury_token_account.owner == treasury.key() @ IpCoreError::InvalidTreasuryAuthority
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    /// Payer's token account to pay the registration fee.
    #[account(
        mut,
        constraint = payer_token_account.mint == config.registration_currency @ IpCoreError::InvalidTokenMint
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    /// The entity controller (must sign).
    #[account(
        constraint = controller.key() == registrant_entity.controller @ IpCoreError::Unauthorized
    )]
    pub controller: Signer<'info>,

    /// Payer for account creation and registration fee.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// SPL Token program.
    pub token_program: Program<'info, Token>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,
}

/// Create a new IP registration.
///
/// Requires payment of the registration fee to the protocol treasury.
///
/// # Arguments
/// * `ctx` - Context containing accounts
/// * `content_hash` - SHA-256 hash of the content being registered
///
/// # Errors
/// * `IpCoreError::Unauthorized` - Signer is not the entity controller
/// * `IpCoreError::InvalidTokenMint` - Token account mint doesn't match config
/// * `IpCoreError::InvalidTreasuryAuthority` - Treasury token account not owned by treasury
pub fn handler(ctx: Context<CreateIp>, content_hash: [u8; 32]) -> Result<()> {
    let registrant_entity = &ctx.accounts.registrant_entity;
    let config = &ctx.accounts.config;

    // Transfer registration fee BEFORE initializing the IP account
    if config.registration_fee > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer_token_account.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            config.registration_fee,
        )?;
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Initialize IP account
    let ip = &mut ctx.accounts.ip;
    ip.content_hash = content_hash;
    ip.registrant_entity = registrant_entity.key();
    ip.current_owner_entity = registrant_entity.key();
    ip.current_metadata_revision = 0;
    ip.created_at = now;
    ip.updated_at = now;
    ip.bump = ctx.bumps.ip;

    emit!(IpCreated {
        ip: ctx.accounts.ip.key(),
        content_hash,
        registrant_entity: registrant_entity.key(),
        registration_fee: config.registration_fee,
        created_at: now,
    });

    msg!("IP registered");

    Ok(())
}
