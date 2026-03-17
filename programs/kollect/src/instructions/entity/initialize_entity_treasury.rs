use anchor_lang::prelude::*;
use ip_core::state::entity::Entity;

use crate::error::KollectError;
use crate::events::EntityTreasuryInitialized;
use crate::state::EntityTreasury;
use crate::utils::seeds::ENTITY_TREASURY_SEED;
use crate::utils::validation::validate_entity_multisig;

#[derive(Accounts)]
pub struct InitializeEntityTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        owner = ip_core::ID @ KollectError::InvalidIpCoreAccount,
    )]
    pub entity: Account<'info, Entity>,

    #[account(
        init,
        payer = payer,
        space = EntityTreasury::SIZE,
        seeds = [ENTITY_TREASURY_SEED, entity.key().as_ref()],
        bump,
    )]
    pub entity_treasury: Account<'info, EntityTreasury>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: entity controller signers
}

pub fn handler(ctx: Context<InitializeEntityTreasury>, authority: Pubkey) -> Result<()> {
    let entity = &ctx.accounts.entity;
    validate_entity_multisig(entity, ctx.remaining_accounts)?;

    let treasury = &mut ctx.accounts.entity_treasury;
    treasury.entity = entity.key();
    treasury.authority = authority;
    treasury.total_earned = 0;
    treasury.total_withdrawn = 0;
    treasury.bump = ctx.bumps.entity_treasury;

    emit!(EntityTreasuryInitialized {
        entity_treasury: treasury.key(),
        entity: entity.key(),
        authority,
    });

    Ok(())
}
