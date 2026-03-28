use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("GKMP1rbfBV7fDxmr1Pc5zB7uzDtSdx3rkZLfp4ao47DA");

#[program]
pub mod kollect {
    use super::*;

    // -- Platform Management --

    pub fn initialize_platform(
        ctx: Context<InitializePlatform>,
        base_price_per_play: u64,
        platform_fee_bps: u16,
        currency: Pubkey,
        max_derivatives_depth: u8,
        max_license_types: u16,
    ) -> Result<()> {
        instructions::platform::initialize_platform::handler(
            ctx,
            base_price_per_play,
            platform_fee_bps,
            currency,
            max_derivatives_depth,
            max_license_types,
        )
    }

    pub fn update_platform_config(
        ctx: Context<UpdatePlatformConfig>,
        params: UpdatePlatformConfigParams,
    ) -> Result<()> {
        instructions::platform::update_platform_config::handler(ctx, params)
    }

    pub fn withdraw_platform_fees(ctx: Context<WithdrawPlatformFees>, amount: u64) -> Result<()> {
        instructions::platform::withdraw_platform_fees::handler(ctx, amount)
    }

    // -- IP Onboarding --

    pub fn onboard_ip<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, OnboardIp<'info>>,
        price_per_play_override: Option<u64>,
    ) -> Result<()> {
        instructions::ip::onboard_ip::handler(ctx, price_per_play_override)
    }

    pub fn update_ip_config(
        ctx: Context<UpdateIpConfig>,
        new_price_per_play_override: Option<Option<u64>>,
    ) -> Result<()> {
        instructions::ip::update_ip_config::handler(ctx, new_price_per_play_override)
    }

    pub fn deactivate_ip(ctx: Context<DeactivateIp>) -> Result<()> {
        instructions::ip::deactivate_ip::handler(ctx)
    }

    pub fn reactivate_ip(ctx: Context<ReactivateIp>) -> Result<()> {
        instructions::ip::reactivate_ip::handler(ctx)
    }

    // -- Entity Treasury --

    pub fn initialize_entity_treasury(
        ctx: Context<InitializeEntityTreasury>,
        authority: Pubkey,
    ) -> Result<()> {
        instructions::entity::initialize_entity_treasury::handler(ctx, authority)
    }

    pub fn withdraw_entity_earnings(
        ctx: Context<WithdrawEntityEarnings>,
        amount: u64,
    ) -> Result<()> {
        instructions::entity::withdraw_entity_earnings::handler(ctx, amount)
    }

    // -- Venue Management --

    pub fn register_venue(
        ctx: Context<RegisterVenue>,
        venue_id: u64,
        params: RegisterVenueParams,
    ) -> Result<()> {
        instructions::venue::register_venue::handler(ctx, venue_id, params)
    }

    pub fn update_venue(ctx: Context<UpdateVenue>, params: UpdateVenueParams) -> Result<()> {
        instructions::venue::update_venue::handler(ctx, params)
    }

    pub fn update_venue_multiplier(
        ctx: Context<UpdateVenueMultiplier>,
        new_multiplier_bps: u16,
    ) -> Result<()> {
        instructions::venue::update_venue_multiplier::handler(ctx, new_multiplier_bps)
    }

    pub fn deactivate_venue(ctx: Context<DeactivateVenue>) -> Result<()> {
        instructions::venue::deactivate_venue::handler(ctx)
    }

    pub fn reactivate_venue(ctx: Context<ReactivateVenue>) -> Result<()> {
        instructions::venue::reactivate_venue::handler(ctx)
    }

    // -- Licensing --

    pub fn create_license_template(
        ctx: Context<CreateLicenseTemplate>,
        params: CreateLicenseTemplateParams,
    ) -> Result<()> {
        instructions::licensing::create_license_template::handler(ctx, params)
    }

    pub fn update_license_template(
        ctx: Context<UpdateLicenseTemplate>,
        params: UpdateLicenseTemplateParams,
    ) -> Result<()> {
        instructions::licensing::update_license_template::handler(ctx, params)
    }

    pub fn create_license(
        ctx: Context<CreateLicense>,
        params: CreateLicenseParams,
    ) -> Result<()> {
        instructions::licensing::create_license::handler(ctx, params)
    }

    pub fn update_license(
        ctx: Context<UpdateLicense>,
        params: UpdateLicenseParams,
    ) -> Result<()> {
        instructions::licensing::update_license::handler(ctx, params)
    }

    pub fn purchase_license(ctx: Context<PurchaseLicense>) -> Result<()> {
        instructions::licensing::purchase_license::handler(ctx)
    }

    pub fn validate_derivative_grant<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ValidateDerivativeGrant<'info>>,
    ) -> Result<()> {
        instructions::licensing::validate_derivative_grant::handler(ctx)
    }

    // -- Playback & Settlement --

    pub fn submit_playback(
        ctx: Context<SubmitPlayback>,
        day_timestamp: i64,
        commitment_hash: [u8; 32],
        total_plays: u64,
    ) -> Result<()> {
        instructions::playback::submit_playback::handler(
            ctx,
            day_timestamp,
            commitment_hash,
            total_plays,
        )
    }

    pub fn settle_period<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, SettlePeriod<'info>>,
        period_start: i64,
        settled_at: i64,
        distributions: Vec<IpDistribution>,
    ) -> Result<()> {
        instructions::playback::settle_period::handler(ctx, period_start, settled_at, distributions)
    }

    // -- Entity Withdrawals --

    pub fn withdraw_ip_treasury(ctx: Context<WithdrawIpTreasury>, amount: u64) -> Result<()> {
        instructions::entity::withdraw_ip_treasury::handler(ctx, amount)
    }
}
