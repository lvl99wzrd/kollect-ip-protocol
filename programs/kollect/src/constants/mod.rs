/// Maximum royalty chain depth for bottom-to-top distribution during settlement.
pub const MAX_ROYALTY_CHAIN_DEPTH: u8 = 3;

/// Settlement period duration in seconds (7 days).
pub const SETTLEMENT_PERIOD_SECONDS: i64 = 7 * 24 * 60 * 60;

/// Seconds in one day (UTC).
pub const SECONDS_PER_DAY: i64 = 24 * 60 * 60;

/// Basis points denominator (100% = 10_000).
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Maximum length of a venue name in bytes.
pub const MAX_VENUE_NAME_LENGTH: usize = 64;

/// Maximum length of a license template name in bytes.
pub const MAX_TEMPLATE_NAME_LENGTH: usize = 32;

/// Maximum operating hours per day for a venue.
pub const MAX_OPERATING_HOURS: u8 = 24;

/// Venue type enum upper bound (inclusive).
pub const MAX_VENUE_TYPE: u8 = 5;
