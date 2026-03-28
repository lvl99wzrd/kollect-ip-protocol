use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{SETTLEMENT_PERIOD_SECONDS, SETTLEMENT_TIMESTAMP_TOLERANCE};
use crate::error::KollectError;
use crate::events::{PeriodSettled, RoyaltyDistributed};
use crate::state::{
    IpConfig, IpTreasury, PlatformConfig, PlatformTreasury, PlaybackCommitment, RoyaltySplit,
    SettlementRecord, VenueAccount,
};
use crate::utils::seeds::{
    IP_CONFIG_SEED, IP_TREASURY_SEED, PLATFORM_CONFIG_SEED, PLATFORM_TREASURY_SEED,
    ROYALTY_SPLIT_SEED, SETTLEMENT_SEED, VENUE_SEED,
};
use crate::utils::validation::calculate_bps;

/// Per-IP distribution data passed as instruction data.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct IpDistribution {
    pub ip_account: Pubkey,
    pub amount: u64,
    pub plays: u64,
}

#[derive(Accounts)]
#[instruction(period_start: i64, settled_at: i64)]
pub struct SettlePeriod<'info> {
    /// Platform authority — provides distribution data, co-signs.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Venue authority — funds the settlement.
    pub venue_authority: Signer<'info>,

    #[account(
        seeds = [PLATFORM_CONFIG_SEED],
        bump = config.bump,
        constraint = config.authority == authority.key() @ KollectError::InvalidAuthority,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(
        seeds = [VENUE_SEED, &venue.venue_id.to_le_bytes()],
        bump = venue.bump,
        constraint = venue.authority == venue_authority.key() @ KollectError::InvalidAuthority,
    )]
    pub venue: Account<'info, VenueAccount>,

    #[account(
        seeds = [PLATFORM_TREASURY_SEED],
        bump = platform_treasury.bump,
    )]
    pub platform_treasury: Account<'info, PlatformTreasury>,

    /// Venue's token account — source of settlement funds.
    #[account(
        mut,
        token::authority = venue_authority,
        token::mint = config.currency,
    )]
    pub venue_token_account: Account<'info, TokenAccount>,

    /// Platform treasury's token account — receives platform fee.
    #[account(
        mut,
        token::authority = platform_treasury,
        token::mint = config.currency,
    )]
    pub platform_treasury_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        space = SettlementRecord::SIZE,
        seeds = [
            SETTLEMENT_SEED,
            venue.key().as_ref(),
            &period_start.to_le_bytes(),
            &settled_at.to_le_bytes(),
        ],
        bump,
    )]
    pub settlement: Account<'info, SettlementRecord>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    // remaining_accounts layout:
    //   First: PlaybackCommitment accounts for the period (detected by size)
    //   Then per IP (repeating):
    //     [ip_config, ip_treasury, ip_treasury_token_account,
    //       per royalty depth: [royalty_split, origin_ip_treasury, origin_ip_token_account]]
}

pub fn handler<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, SettlePeriod<'info>>,
    period_start: i64,
    settled_at: i64,
    distributions: Vec<IpDistribution>,
) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Validate settled_at is within tolerance of on-chain clock
    let time_diff = now
        .checked_sub(settled_at)
        .ok_or(KollectError::ArithmeticOverflow)?;
    require!(
        time_diff.abs() <= SETTLEMENT_TIMESTAMP_TOLERANCE,
        KollectError::InvalidSettlementTimestamp
    );

    let period_end = period_start
        .checked_add(SETTLEMENT_PERIOD_SECONDS)
        .ok_or(KollectError::ArithmeticOverflow)?;

    // --- Phase 1: Process PlaybackCommitments ---
    let mut total_plays: u64 = 0;
    let mut commitment_count: u16 = 0;
    let mut commitment_hashes: Vec<[u8; 32]> = Vec::new();

    let venue_key = ctx.accounts.venue.key();
    let mut remaining_idx: usize = 0;

    for (i, account_info) in ctx.remaining_accounts.iter().enumerate() {
        let data = account_info.try_borrow_data()?;
        if data.len() != PlaybackCommitment::SIZE {
            remaining_idx = i;
            break;
        }

        let commitment = match PlaybackCommitment::try_deserialize(&mut &data[..]) {
            Ok(c) => c,
            Err(_) => {
                remaining_idx = i;
                break;
            }
        };

        // Validate commitment belongs to this venue and falls within the period
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

        // Mark as settled via proper deserialize-mutate-serialize (no hardcoded offset)
        drop(data);
        let mut data_mut = account_info.try_borrow_mut_data()?;
        let mut commitment_settled = PlaybackCommitment::try_deserialize(&mut &data_mut[..])?;
        commitment_settled.settled = true;
        let disc = PlaybackCommitment::DISCRIMINATOR;
        data_mut[..8].copy_from_slice(disc);
        let serialized = commitment_settled.try_to_vec()?;
        data_mut[8..8 + serialized.len()].copy_from_slice(&serialized);

        remaining_idx = i + 1;
    }

    require!(commitment_count > 0, KollectError::NoCommitmentsToSettle);

    // Validate play counts match
    let total_distribution_plays: u64 = distributions
        .iter()
        .try_fold(0u64, |acc, d| acc.checked_add(d.plays))
        .ok_or(KollectError::ArithmeticOverflow)?;
    require!(
        total_distribution_plays == total_plays,
        KollectError::PlayCountMismatch
    );

    // Build balanced sorted Merkle root from commitment hashes
    let merkle_root = compute_merkle_root(&commitment_hashes);

    // --- Phase 2: Compute settlement totals ---
    let total_distribution_amount: u64 = distributions
        .iter()
        .try_fold(0u64, |acc, d| acc.checked_add(d.amount))
        .ok_or(KollectError::ArithmeticOverflow)?;

    let platform_fee = calculate_bps(
        total_distribution_amount,
        ctx.accounts.config.platform_fee_bps,
    )?;
    let total_amount = total_distribution_amount
        .checked_add(platform_fee)
        .ok_or(KollectError::ArithmeticOverflow)?;

    // Pre-check: ensure venue has sufficient balance before initiating any transfers
    require!(
        ctx.accounts.venue_token_account.amount >= total_amount,
        KollectError::InsufficientVenueBalance
    );

    // --- Phase 3: Transfer platform fee ---
    if platform_fee > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.venue_token_account.to_account_info(),
                    to: ctx
                        .accounts
                        .platform_treasury_token_account
                        .to_account_info(),
                    authority: ctx.accounts.venue_authority.to_account_info(),
                },
            ),
            platform_fee,
        )?;
    }

    // --- Phase 4: Distribute per-IP amounts ---
    let ip_remaining = &ctx.remaining_accounts[remaining_idx..];
    let mut ip_idx: usize = 0;

    for distribution in &distributions {
        require!(
            ip_idx + 3 <= ip_remaining.len(),
            KollectError::IpNotOnboarded
        );

        let ip_config_info = &ip_remaining[ip_idx];
        let ip_treasury_info = &ip_remaining[ip_idx + 1];
        let ip_treasury_token_info = &ip_remaining[ip_idx + 2];
        ip_idx += 3;

        // Validate IpConfig PDA
        let (expected_ip_config, _) = Pubkey::find_program_address(
            &[IP_CONFIG_SEED, distribution.ip_account.as_ref()],
            ctx.program_id,
        );
        require!(
            *ip_config_info.key == expected_ip_config,
            KollectError::IpNotOnboarded
        );

        // Deserialize IpConfig and verify distribution.amount matches on-chain price
        let ip_config_data = ip_config_info.try_borrow_data()?;
        let ip_config = IpConfig::try_deserialize(&mut &ip_config_data[..])
            .map_err(|_| error!(KollectError::IpNotOnboarded))?;
        let base_price = ip_config
            .price_per_play_override
            .unwrap_or(ctx.accounts.config.base_price_per_play);
        let effective_price_per_play =
            calculate_bps(base_price, ctx.accounts.venue.multiplier_bps)?;
        let expected_amount = effective_price_per_play
            .checked_mul(distribution.plays)
            .ok_or(KollectError::ArithmeticOverflow)?;
        require!(
            distribution.amount == expected_amount,
            KollectError::DistributionAmountMismatch
        );
        drop(ip_config_data);

        // Validate IpTreasury PDA
        let (expected_ip_treasury, _) = Pubkey::find_program_address(
            &[IP_TREASURY_SEED, distribution.ip_account.as_ref()],
            ctx.program_id,
        );
        require!(
            *ip_treasury_info.key == expected_ip_treasury,
            KollectError::IpNotOnboarded
        );

        let mut net_to_ip = distribution.amount;

        // Walk royalty chain bottom-to-top
        let mut current_ip = distribution.ip_account;
        for _depth in 0..ctx.accounts.config.max_derivatives_depth {
            if ip_idx >= ip_remaining.len() {
                break;
            }

            // Peek at the next account to detect a RoyaltySplit
            let maybe_split_info = &ip_remaining[ip_idx];
            let split_data = maybe_split_info.try_borrow_data()?;
            if split_data.len() != RoyaltySplit::SIZE {
                drop(split_data);
                break;
            }

            let split = match RoyaltySplit::try_deserialize(&mut &split_data[..]) {
                Ok(s) => s,
                Err(_) => {
                    drop(split_data);
                    break;
                }
            };

            if split.derivative_ip != current_ip {
                drop(split_data);
                break;
            }

            let origin_ip = split.origin_ip;
            let share_bps = split.share_bps;
            drop(split_data);

            // Validate RoyaltySplit PDA for current_ip → origin_ip
            let (expected_split_pda, _) = Pubkey::find_program_address(
                &[ROYALTY_SPLIT_SEED, current_ip.as_ref(), origin_ip.as_ref()],
                ctx.program_id,
            );
            require!(
                maybe_split_info.key() == expected_split_pda,
                KollectError::InvalidRoyaltySplitPda
            );

            require!(
                ip_idx + 3 <= ip_remaining.len(),
                KollectError::RoyaltyChainTooDeep
            );

            let split_info = &ip_remaining[ip_idx];
            let origin_treasury_info = &ip_remaining[ip_idx + 1];
            let origin_token_info = &ip_remaining[ip_idx + 2];
            ip_idx += 3;

            // Validate origin IpTreasury PDA
            let (expected_origin_treasury, _) = Pubkey::find_program_address(
                &[IP_TREASURY_SEED, origin_ip.as_ref()],
                ctx.program_id,
            );
            require!(
                *origin_treasury_info.key == expected_origin_treasury,
                KollectError::IpNotOnboarded
            );

            // Validate origin token account: correct mint and authority (origin treasury)
            {
                let token_data = origin_token_info.try_borrow_data()?;
                require!(token_data.len() >= 64, KollectError::InvalidCurrency);
                let mint_bytes: [u8; 32] = token_data[0..32]
                    .try_into()
                    .map_err(|_| error!(KollectError::InvalidCurrency))?;
                let owner_bytes: [u8; 32] = token_data[32..64]
                    .try_into()
                    .map_err(|_| error!(KollectError::InvalidCurrency))?;
                require!(
                    Pubkey::from(mint_bytes) == ctx.accounts.config.currency,
                    KollectError::InvalidCurrency
                );
                require!(
                    Pubkey::from(owner_bytes) == *origin_treasury_info.key,
                    KollectError::Unauthorized
                );
            }

            let royalty_amount = calculate_bps(net_to_ip, share_bps)?;

            if royalty_amount > 0 {
                // Transfer royalty from venue → origin IP treasury token account
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.venue_token_account.to_account_info(),
                            to: origin_token_info.clone(),
                            authority: ctx.accounts.venue_authority.to_account_info(),
                        },
                    ),
                    royalty_amount,
                )?;

                // Update origin IpTreasury.total_earned
                let mut origin_data = origin_treasury_info.try_borrow_mut_data()?;
                let mut origin_treasury = IpTreasury::try_deserialize(&mut &origin_data[..])
                    .map_err(|_| error!(KollectError::IpNotOnboarded))?;
                origin_treasury.total_earned = origin_treasury
                    .total_earned
                    .checked_add(royalty_amount)
                    .ok_or(KollectError::ArithmeticOverflow)?;
                let serialized = origin_treasury.try_to_vec()?;
                origin_data[8..8 + serialized.len()].copy_from_slice(&serialized);
                drop(origin_data);

                // Update RoyaltySplit.total_distributed
                let mut split_data_mut = split_info.try_borrow_mut_data()?;
                let mut split_account = RoyaltySplit::try_deserialize(&mut &split_data_mut[..])
                    .map_err(|_| error!(KollectError::InvalidDerivativeLink))?;
                split_account.total_distributed = split_account
                    .total_distributed
                    .checked_add(royalty_amount)
                    .ok_or(KollectError::ArithmeticOverflow)?;
                let split_serialized = split_account.try_to_vec()?;
                split_data_mut[8..8 + split_serialized.len()].copy_from_slice(&split_serialized);
                drop(split_data_mut);

                net_to_ip = net_to_ip
                    .checked_sub(royalty_amount)
                    .ok_or(KollectError::ArithmeticOverflow)?;

                emit!(RoyaltyDistributed {
                    from_ip: current_ip,
                    to_ip: origin_ip,
                    amount: royalty_amount,
                    split: *split_info.key,
                });
            }

            current_ip = origin_ip;
        }

        // Transfer net_to_ip from venue → this IP's treasury token account
        if net_to_ip > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.venue_token_account.to_account_info(),
                        to: ip_treasury_token_info.clone(),
                        authority: ctx.accounts.venue_authority.to_account_info(),
                    },
                ),
                net_to_ip,
            )?;
        }

        // Update IpTreasury.total_earned using net amount (not gross distribution.amount)
        let mut treasury_data = ip_treasury_info.try_borrow_mut_data()?;
        let mut ip_treasury = IpTreasury::try_deserialize(&mut &treasury_data[..])
            .map_err(|_| error!(KollectError::IpNotOnboarded))?;
        ip_treasury.total_earned = ip_treasury
            .total_earned
            .checked_add(net_to_ip)
            .ok_or(KollectError::ArithmeticOverflow)?;
        let treasury_serialized = ip_treasury.try_to_vec()?;
        treasury_data[8..8 + treasury_serialized.len()].copy_from_slice(&treasury_serialized);
        drop(treasury_data);
    }

    // --- Phase 5: Write settlement record ---
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
    settlement.settled_at = settled_at;
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

/// Compute a balanced binary Merkle root from commitment hashes.
/// Hashes are sorted first for determinism regardless of submission order.
/// At each level, pairs of nodes are hashed together; if the count is odd,
/// the last node is paired with itself (standard binary Merkle extension).
fn compute_merkle_root(hashes: &[[u8; 32]]) -> [u8; 32] {
    if hashes.is_empty() {
        return [0u8; 32];
    }
    if hashes.len() == 1 {
        return hashes[0];
    }

    let mut layer: Vec<[u8; 32]> = hashes.to_vec();
    layer.sort_unstable();

    while layer.len() > 1 {
        let mut next_layer: Vec<[u8; 32]> = Vec::new();
        let mut i = 0;
        while i < layer.len() {
            let left = layer[i];
            let right = if i + 1 < layer.len() {
                layer[i + 1]
            } else {
                layer[i] // duplicate last node for odd count
            };
            let mut combined = [0u8; 64];
            combined[..32].copy_from_slice(&left);
            combined[32..].copy_from_slice(&right);
            next_layer.push(solana_sha256_hasher::hash(&combined).to_bytes());
            i += 2;
        }
        layer = next_layer;
    }

    layer[0]
}
