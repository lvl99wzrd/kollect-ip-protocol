use anchor_lang::prelude::*;

// -- Platform Events --

#[event]
pub struct PlatformInitialized {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub base_price_per_play: u64,
    pub platform_fee_bps: u16,
}

#[event]
pub struct PlatformConfigUpdated {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub base_price_per_play: u64,
    pub platform_fee_bps: u16,
    pub max_derivatives_depth: u8,
    pub max_license_types: u16,
}

#[event]
pub struct PlatformFeesWithdrawn {
    pub treasury: Pubkey,
    pub amount: u64,
    pub destination: Pubkey,
}

// -- IP Onboarding Events --

#[event]
pub struct IpOnboarded {
    pub ip_config: Pubkey,
    pub ip_account: Pubkey,
    pub owner_entity: Pubkey,
    pub price_override: Option<u64>,
    pub is_derivative: bool,
    pub onboarded_at: i64,
}

#[event]
pub struct IpConfigUpdated {
    pub ip_config: Pubkey,
    pub price_per_play_override: Option<u64>,
    pub updated_at: i64,
}

#[event]
pub struct IpDeactivated {
    pub ip_config: Pubkey,
    pub deactivated_at: i64,
}

#[event]
pub struct IpReactivated {
    pub ip_config: Pubkey,
    pub reactivated_at: i64,
}

// -- Entity Treasury Events --

#[event]
pub struct EntityTreasuryInitialized {
    pub entity_treasury: Pubkey,
    pub entity: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct EntityEarningsWithdrawn {
    pub entity_treasury: Pubkey,
    pub amount: u64,
    pub destination: Pubkey,
}

// -- Venue Events --

#[event]
pub struct VenueRegistered {
    pub venue: Pubkey,
    pub venue_id: u64,
    pub authority: Pubkey,
    pub cid: [u8; 96],
    pub registered_at: i64,
}

#[event]
pub struct VenueUpdated {
    pub venue: Pubkey,
    pub cid: [u8; 96],
    pub updated_at: i64,
}

#[event]
pub struct VenueMultiplierUpdated {
    pub venue: Pubkey,
    pub old_multiplier: u16,
    pub new_multiplier: u16,
    pub updated_by: Pubkey,
}

#[event]
pub struct VenueDeactivated {
    pub venue: Pubkey,
    pub deactivated_at: i64,
}

#[event]
pub struct VenueReactivated {
    pub venue: Pubkey,
    pub reactivated_at: i64,
}

// -- Licensing Events --

#[event]
pub struct LicenseTemplateCreated {
    pub template: Pubkey,
    pub template_id: u64,
    pub creator: Pubkey,
    pub template_name: [u8; 64],
    pub derivatives_allowed: bool,
    pub commercial_use: bool,
    pub derivative_rev_share_bps: u16,
}

#[event]
pub struct LicenseTemplateUpdated {
    pub template: Pubkey,
    pub is_active: bool,
    pub updated_at: i64,
}

#[event]
pub struct LicenseCreated {
    pub license: Pubkey,
    pub ip_account: Pubkey,
    pub license_template: Pubkey,
    pub owner_entity: Pubkey,
    pub price: u64,
    pub max_grants: u16,
    pub derivative_rev_share_bps: u16,
}

#[event]
pub struct LicenseUpdated {
    pub license: Pubkey,
    pub price: u64,
    pub grant_duration: i64,
    pub is_active: bool,
    pub derivative_rev_share_bps: u16,
    pub updated_at: i64,
}

#[event]
pub struct LicensePurchased {
    pub grant: Pubkey,
    pub license: Pubkey,
    pub grantee_entity: Pubkey,
    pub origin_ip: Pubkey,
    pub price_paid: u64,
    pub platform_fee: u64,
    pub net_to_owner: u64,
    pub expiration: i64,
}

#[event]
pub struct RoyaltySplitCreated {
    pub split: Pubkey,
    pub derivative_ip: Pubkey,
    pub origin_ip: Pubkey,
    pub share_bps: u16,
}

// -- Playback & Settlement Events --

#[event]
pub struct PlaybackSubmitted {
    pub commitment: Pubkey,
    pub venue: Pubkey,
    pub day_timestamp: i64,
    pub commitment_hash: [u8; 32],
    pub total_plays: u64,
}

#[event]
pub struct PeriodSettled {
    pub settlement: Pubkey,
    pub venue: Pubkey,
    pub period_start: i64,
    pub period_end: i64,
    pub total_plays: u64,
    pub total_amount: u64,
    pub platform_fee: u64,
    pub ip_count: u16,
}

#[event]
pub struct RoyaltyDistributed {
    pub from_ip: Pubkey,
    pub to_ip: Pubkey,
    pub amount: u64,
    pub split: Pubkey,
}

#[event]
pub struct IpTreasuryWithdrawn {
    pub ip_treasury: Pubkey,
    pub entity_treasury: Pubkey,
    pub amount: u64,
}
