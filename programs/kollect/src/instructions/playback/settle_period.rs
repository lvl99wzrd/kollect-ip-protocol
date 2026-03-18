use anchor_lang::prelude::*;

use crate::constants::SETTLEMENT_PERIOD_SECONDS;
use crate::error::KollectError;
use crate::events::PeriodSettled;
use crate::state::{PlatformConfig, PlaybackCommitment, SettlementRecord, VenueAccount};
use crate::utils::seeds::{PLATFORM_CONFIG_SEED, SETTLEMENT_SEED, VENUE_SEED};
use crate::utils::validation::calculate_bps;

/// Per-IP distribution data passed as instruction data.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct IpDistribution {
    pub ip_account: Pubkey,
    pub amount: u64,
    pub plays: u64,
}

#[derive(Accounts)]
#[instruction(period_start: i64)]
pub struct SettlePeriod<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ KollectError::InvalidAuthority,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(
        seeds = [VENUE_SEED, &venue.venue_id.to_le_bytes()],
        bump = venue.bump,
    )]
    pub venue: Account<'info, VenueAccount>,

    #[account(
        init,
        payer = authority,
        space = SettlementRecord::SIZE,
        seeds = [SETTLEMENT_SEED, venue.key().as_ref(), &period_start.to_le_bytes()],
        bump,
    )]
    pub settlement: Account<'info, SettlementRecord>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: PlaybackCommitment accounts for the period,
    // followed by IpTreasury + RoyaltySplit accounts for distribution
}

pub fn handler(
    ctx: Context<SettlePeriod>,
    period_start: i64,
    distributions: Vec<IpDistribution>,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let period_end = period_start
        .checked_add(SETTLEMENT_PERIOD_SECONDS)
        .ok_or(KollectError::ArithmeticOverflow)?;

    // Verify period has ended
    require!(now >= period_end, KollectError::SettlementPeriodNotEnded);

    // Process PlaybackCommitments from remaining_accounts
    // Commitments come first in remaining_accounts
    let mut total_plays: u64 = 0;
    let mut commitment_count: u16 = 0;
    let mut commitment_hashes: Vec<[u8; 32]> = Vec::new();

    let venue_key = ctx.accounts.venue.key();

    for account_info in ctx.remaining_accounts.iter() {
        // Try to deserialize as PlaybackCommitment
        let data = account_info.try_borrow_data()?;
        if data.len() != PlaybackCommitment::SIZE {
            // Not a commitment — we've reached the treasury/split accounts
            break;
        }

        let commitment = PlaybackCommitment::try_deserialize(&mut &data[..]);
        let commitment = match commitment {
            Ok(c) => c,
            Err(_) => break, // Not a PlaybackCommitment
        };

        // Validate commitment belongs to this venue and period
        require!(
            commitment.venue == venue_key,
            KollectError::InvalidSettlementPeriod
        );
        require!(!commitment.settled, KollectError::CommitmentAlreadySettled);
        require!(
            commitment.day_timestamp >= period_start && commitment.day_timestamp < period_end,
            KollectError::InvalidSettlementPeriod
        );

        total_plays = total_plays
            .checked_add(commitment.total_plays)
            .ok_or(KollectError::ArithmeticOverflow)?;
        commitment_hashes.push(commitment.commitment_hash);
        commitment_count = commitment_count
            .checked_add(1)
            .ok_or(KollectError::ArithmeticOverflow)?;

        // Mark as settled
        drop(data);
        let mut data = account_info.try_borrow_mut_data()?;
        // The `settled` field offset: 8 (disc) + 32 (venue) + 8 (day) + 32 (hash) + 8 (plays) + 8 (submitted_at) = 96
        data[96] = 1; // true
    }

    require!(commitment_count > 0, KollectError::NoCommitmentsToSettle);

    // Compute merkle root from commitment hashes (simple hash chain for POC)
    let merkle_root = compute_merkle_root(&commitment_hashes);

    // Compute total settlement amount from distributions
    let total_distribution_amount: u64 = distributions
        .iter()
        .try_fold(0u64, |acc, d| acc.checked_add(d.amount))
        .ok_or(KollectError::ArithmeticOverflow)?;

    // Platform fee on total amount
    let platform_fee =
        calculate_bps(total_distribution_amount, ctx.accounts.config.platform_fee_bps)?;
    let total_amount = total_distribution_amount
        .checked_add(platform_fee)
        .ok_or(KollectError::ArithmeticOverflow)?;

    // Write settlement record
    let settlement = &mut ctx.accounts.settlement;
    settlement.venue = venue_key;
    settlement.period_start = period_start;
    settlement.period_end = period_end;
    settlement.total_plays = total_plays;
    settlement.total_amount = total_amount;
    settlement.platform_fee = platform_fee;
    settlement.commitment_count = commitment_count;
    settlement.merkle_root = merkle_root;
    settlement.ip_count = distributions.len() as u16;
    settlement.settled_at = now;
    settlement.bump = ctx.bumps.settlement;

    emit!(PeriodSettled {
        settlement: settlement.key(),
        venue: venue_key,
        period_start,
        period_end,
        total_plays,
        total_amount,
        platform_fee,
        ip_count: distributions.len() as u16,
    });

    Ok(())
}

/// Simple merkle root computation for POC.
/// Uses iterative hashing: H(H(h1 || h2) || h3) ...
fn compute_merkle_root(hashes: &[[u8; 32]]) -> [u8; 32] {
    if hashes.is_empty() {
        return [0u8; 32];
    }
    if hashes.len() == 1 {
        return hashes[0];
    }

    let mut current = hashes[0];
    for hash in &hashes[1..] {
        let mut combined = [0u8; 64];
        combined[..32].copy_from_slice(&current);
        combined[32..].copy_from_slice(hash);
        current = solana_sha256_hasher::hash(&combined).to_bytes();
    }
    current
}
