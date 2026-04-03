/// Maximum royalty chain depth for bottom-to-top distribution during settlement.
pub const MAX_ROYALTY_CHAIN_DEPTH: u8 = 3;

/// Settlement period duration in seconds (7 days).
pub const SETTLEMENT_PERIOD_SECONDS: i64 = 7 * 24 * 60 * 60;

/// Seconds in one day (UTC).
pub const SECONDS_PER_DAY: i64 = 24 * 60 * 60;

/// Basis points denominator (100% = 10_000).
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Maximum length of an IPFS CID stored for a venue (96 bytes covers CIDv1 base32).
pub const MAX_CID_LENGTH: usize = 96;

/// Maximum length of a license template name in bytes.
pub const MAX_TEMPLATE_NAME_LENGTH: usize = 64;

/// Maximum length of a license template URI in bytes (IPFS CIDv1 base32).
pub const MAX_URI_LENGTH: usize = 96;

/// Tolerance in seconds between settled_at and the on-chain clock during settlement.
pub const SETTLEMENT_TIMESTAMP_TOLERANCE: i64 = 30;
