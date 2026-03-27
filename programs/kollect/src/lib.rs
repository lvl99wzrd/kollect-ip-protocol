use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("P5UcEmMdxHvLFmkE743XzEg5pnN5csNb8jUxTWj6VoJ");

#[program]
pub mod kollect {
    use super::*;

    // -- Platform Management --

    pub fn initialize_platform(
        ctx: Context<InitializePlatform>,
        base_price_per_play: u64,
        platform_fee_bps: u16,
        settlement_currency: Pubkey,
        max_derivatives: u16,
    ) -> Result<()> {
        instructions::platform::initialize_platform::handler(
            ctx,
            base_price_per_play,
            platform_fee_bps,
            settlement_currency,
            max_derivatives,
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
        is_derivative: bool,
    ) -> Result<()> {
        instructions::ip::onboard_ip::handler(ctx, price_per_play_override, is_derivative)
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

    // -- Licensing --

    pub fn create_license_template(
        ctx: Context<CreateLicenseTemplate>,
        template_name: [u8; 32],
        price: u64,
        currency: Pubkey,
        max_grants: u16,
        grant_duration: i64,
    ) -> Result<()> {
        instructions::licensing::create_license_template::handler(
            ctx,
            template_name,
            price,
            currency,
            max_grants,
            grant_duration,
        )
    }

    pub fn update_license_template(
        ctx: Context<UpdateLicenseTemplate>,
        params: UpdateLicenseTemplateParams,
    ) -> Result<()> {
        instructions::licensing::update_license_template::handler(ctx, params)
    }

    pub fn create_royalty_policy(
        ctx: Context<CreateRoyaltyPolicy>,
        derivative_share_bps: u16,
        allow_remix: bool,
        allow_cover: bool,
        allow_sample: bool,
        attribution_required: bool,
        commercial_use: bool,
    ) -> Result<()> {
        instructions::licensing::create_royalty_policy::handler(
            ctx,
            derivative_share_bps,
            allow_remix,
            allow_cover,
            allow_sample,
            attribution_required,
            commercial_use,
        )
    }

    pub fn update_royalty_policy(
        ctx: Context<UpdateRoyaltyPolicy>,
        params: UpdateRoyaltyPolicyParams,
    ) -> Result<()> {
        instructions::licensing::update_royalty_policy::handler(ctx, params)
    }

    pub fn purchase_license(ctx: Context<PurchaseLicense>) -> Result<()> {
        instructions::licensing::purchase_license::handler(ctx)
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

    pub fn settle_period(
        ctx: Context<SettlePeriod>,
        period_start: i64,
        distributions: Vec<IpDistribution>,
    ) -> Result<()> {
        instructions::playback::settle_period::handler(ctx, period_start, distributions)
    }
}
