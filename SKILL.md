---
name: kollect
description: "Comprehensive reference for the Kollect Solana program (Anchor 0.32+), the Licensing & Royalty layer of the Mycelium IP Protocol. Use when integrating with, calling, or building on top of Kollect: platform config, IP onboarding, entity treasury, venue registration, license templates, royalty policies, license purchase, playback commitments, weekly settlement, royalty chain distribution, SPL token transfers, PDA derivation, cross-program reads of ip_core accounts (Entity, IpAccount, DerivativeLink). Covers all 13 accounts, 22 instructions, pricing math, error/event models, and TypeScript/Rust PDA patterns."
---

# Kollect Program — Comprehensive Reference

## 1. Overview

**Kollect** is a Solana on-chain program built with **Anchor 0.32+** that implements the **Licensing & Royalty layer** for the **Mycelium IP Protocol**.

| Property           | Value                                                                        |
| ------------------ | ---------------------------------------------------------------------------- |
| **Program ID**     | `AktoxndpdZfTsAdqAUFsoBPvr6dN7EoCREqDUYKqarB8`                               |
| **Framework**      | Anchor 0.32.1                                                                |
| **Dependencies**   | `anchor-lang`, `anchor-spl`, `ip-core` (read-only), `solana-sha256-hasher`   |
| **Token Standard** | SPL Token (single currency per deployment, set in `PlatformConfig.currency`) |

Kollect handles:

- **Platform configuration** — global pricing, fees, and admin controls
- **IP onboarding** — registering `ip_core` IPs on the kollect platform
- **Entity treasuries** — per-entity royalty collection wallets
- **Venue management** — registering and configuring music playback venues
- **License templates & grants** — programmable license terms and purchase flow
- **Royalty policies** — derivative revenue sharing rules
- **Playback commitments** — daily hash commitments from venue sniffing devices
- **Settlement** — weekly royalty distribution with merkle proofs and royalty chain walks

---

## 2. Architecture

### Two-Program Model

```
┌──────────────────────┐     reads (never writes)     ┌─────────────────────┐
│       kollect        │ ──────────────────────────▶  │      ip_core        │
│  (economic layer)    │                               │  (neutral registry) │
│  Licensing, Royalty,  │                               │  Entity, IP, Links  │
│  Settlement, Pricing  │                               │  Metadata, Schemas  │
└──────────────────────┘                               └─────────────────────┘
```

- **`ip_core`** = neutral, deterministic IP claim registry. Contains no economic logic.
- **`kollect`** = economic layer: licensing, pricing, playback, settlement, royalty distribution.
- **Kollect reads `ip_core` accounts but NEVER writes to them** — no CPI mutations.
- All `kollect` accounts are PDAs derived from `kollect`'s program ID.
- Single SPL token currency model (set at platform initialization).

### Key Design Principles

1. **All accounts are PDA-derived** — no randomness, no nonce-based IDs, no auto-increment
2. **Fixed-size fields** — no unbounded `Vec` growth, no account realloc
3. **Checked arithmetic only** — `checked_mul`, `checked_div`, `checked_add`, `checked_sub`
4. **Entity controller validation** — always cross-program read `ip_core::Entity` for current `controller`; never cache
5. **Deterministic state machine** — same inputs always produce same outputs

---

## 3. ip_core Dependency

**ip_core Program ID:** `CSSfTXVfCUmvZCEjPZxFne5EPewzTGCyYAybLNihLQM1`

Kollect reads three `ip_core` account types:

### Entity

| Field      | Type   | Description                           |
| ---------- | ------ | ------------------------------------- |
| controller | Pubkey | Current controller (signer authority) |

**PDA Seeds:** `["entity", creator_pubkey, &entity_index.to_le_bytes()]` (derived from `ip_core` program ID)

### IpAccount

| Field                | Type   | Description                        |
| -------------------- | ------ | ---------------------------------- |
| current_owner_entity | Pubkey | Entity that currently owns this IP |

**PDA Seeds:** `["ip", registrant_entity_pubkey, content_hash_32bytes]` (derived from `ip_core` program ID)

### DerivativeLink

| Field     | Type   | Description               |
| --------- | ------ | ------------------------- |
| license   | Pubkey | License account reference |
| parent_ip | Pubkey | Origin IP                 |
| child_ip  | Pubkey | Derivative IP             |

**PDA Seeds:** `["derivative", parent_ip_pubkey, child_ip_pubkey]` (derived from `ip_core` program ID)

### Cross-Program Read Pattern

When an instruction requires an `ip_core` account:

- Pass it as an `UncheckedAccount` or typed `Account<T>` with `owner = ip_core::ID` constraint
- Validate ownership: `account.owner == ip_core::ID`
- **NEVER use CPI to mutate `ip_core` state**
- For entity controller validation: check `entity.controller` is a signer in `remaining_accounts`

```rust
// Example: validate entity controller in remaining_accounts
pub fn validate_entity_controller(
    entity: &Entity,
    remaining_accounts: &[AccountInfo],
) -> Result<()> {
    let is_signed = remaining_accounts
        .iter()
        .any(|a| a.is_signer && a.key() == entity.controller);
    require!(is_signed, KollectError::InsufficientSignatures);
    Ok(())
}
```

---

## 4. Cross-Program Integration — Thin Interface Accounts

`ip_core` uses Borsh `try_from_slice` to deserialize license accounts, which **rejects trailing bytes**. Kollect creates dedicated thin accounts that match `ip_core`'s expected layout exactly.

### License (thin account for `ip_core::LicenseData`)

Created alongside a `LicenseTemplate`. Passed as the `license` account in `ip_core::create_derivative_link`.

**Layout (after 8-byte Anchor discriminator):**

| Field               | Type   | Bytes | Value                            |
| ------------------- | ------ | ----- | -------------------------------- |
| origin_ip           | Pubkey | 32    | = LicenseTemplate.ip_account     |
| authority           | Pubkey | 32    | = LicenseTemplate.creator_entity |
| derivatives_allowed | bool   | 1     | Always `true`                    |
| created_at          | i64    | 8     | = LicenseTemplate.created_at     |
| bump                | u8     | 1     | PDA bump                         |

**Total: 82 bytes** (8 + 74)

### LicenseGrant (thin account for `ip_core::LicenseGrantData`)

Created during `purchase_license`. Passed as the `license_grant` account in `ip_core::create_derivative_link`.

**Layout (after 8-byte Anchor discriminator):**

| Field      | Type   | Bytes | Value                                      |
| ---------- | ------ | ----- | ------------------------------------------ |
| license    | Pubkey | 32    | License PDA key                            |
| grantee    | Pubkey | 32    | Grantee Entity key                         |
| granted_at | i64    | 8     | Unix timestamp                             |
| expiration | i64    | 8     | 0 = perpetual, else `now + grant_duration` |
| bump       | u8     | 1     | PDA bump                                   |

**Total: 89 bytes** (8 + 81)

### How Derivatives Work with kollect as License Program

1. `ip_core::create_derivative_link` accepts `license_program_id` as an **instruction argument**
2. Caller passes `kollect`'s program ID as `license_program_id`
3. `ip_core` validates both `License` and `LicenseGrant` accounts are owned by `kollect::ID`
4. `ip_core` validates: `LicenseGrant.license == license.key()`, `License.origin_ip == parent_ip.key()`, `License.derivatives_allowed == true`, expiration check
5. No changes to `ip_core` are needed for kollect to function as the license program

---

## 5. Account Reference (13 Accounts)

All sizes include the 8-byte Anchor discriminator. All accounts are PDA-derived from kollect's program ID.

### 5.1 PlatformConfig (Singleton)

**PDA Seeds:** `["platform_config"]`

| Field                 | Type   | Mutability |
| --------------------- | ------ | ---------- |
| authority             | Pubkey | mutable    |
| platform_fee_bps      | u16    | mutable    |
| base_price_per_play   | u64    | mutable    |
| currency              | Pubkey | immutable  |
| max_derivatives_depth | u8     | mutable    |
| max_license_types     | u16    | mutable    |
| treasury              | Pubkey | mutable    |
| bump                  | u8     | immutable  |

### 5.2 PlatformTreasury

**PDA Seeds:** `["platform_treasury"]`

| Field     | Type   | Mutability |
| --------- | ------ | ---------- |
| authority | Pubkey | mutable    |
| config    | Pubkey | immutable  |
| bump      | u8     | immutable  |

An ATA for `config.currency` is created during `initialize_platform`.

### 5.3 IpConfig

Per-IP onboarding record. Only IPs approved by the platform authority are registered.

**PDA Seeds:** `["ip_config", ip_account_pubkey]`

| Field                   | Type          | Mutability |
| ----------------------- | ------------- | ---------- |
| ip_account              | Pubkey        | immutable  |
| owner_entity            | Pubkey        | mutable    |
| price_per_play_override | Option\<u64\> | mutable    |
| is_active               | bool          | mutable    |
| license_template_count  | u16           | mutable    |
| onboarded_at            | i64           | immutable  |
| updated_at              | i64           | mutable    |
| bump                    | u8            | immutable  |

### 5.4 IpTreasury

Per-IP royalty collection. Funds flow here during settlement.

**PDA Seeds:** `["ip_treasury", ip_account_pubkey]`

| Field           | Type   | Mutability |
| --------------- | ------ | ---------- |
| ip_account      | Pubkey | immutable  |
| ip_config       | Pubkey | immutable  |
| entity_treasury | Pubkey | immutable  |
| total_earned    | u64    | mutable    |
| total_settled   | u64    | mutable    |
| bump            | u8     | immutable  |

An ATA for `config.currency` is created during `onboard_ip`.

### 5.5 EntityTreasury

Per-entity treasury for collecting royalties from owned IPs.

**PDA Seeds:** `["entity_treasury", entity_pubkey]`

| Field           | Type   | Mutability |
| --------------- | ------ | ---------- |
| entity          | Pubkey | immutable  |
| authority       | Pubkey | mutable    |
| total_earned    | u64    | mutable    |
| total_withdrawn | u64    | mutable    |
| bump            | u8     | immutable  |

An ATA for `config.currency` is created during `initialize_entity_treasury`.

### 5.6 VenueAccount

Registered venue that plays music tracked by the platform.

**PDA Seeds:** `["venue", &venue_id.to_le_bytes()]` — `venue_id` is `u64`

| Field             | Type     | Mutability |
| ----------------- | -------- | ---------- |
| venue_id          | u64      | immutable  |
| authority         | Pubkey   | mutable    |
| cid               | [u8; 96] | mutable    |
| multiplier_bps    | u16      | mutable    |
| is_active         | bool     | mutable    |
| total_commitments | u64      | mutable    |
| registered_at     | i64      | immutable  |
| updated_at        | i64      | mutable    |
| bump              | u8       | immutable  |

### 5.7 PlaybackCommitment

Daily playback hash from a venue. Only platform authority may submit.

**PDA Seeds:** `["playback", venue_pubkey, &day_timestamp.to_le_bytes()]`

| Field           | Type     | Mutability |
| --------------- | -------- | ---------- |
| venue           | Pubkey   | immutable  |
| day_timestamp   | i64      | immutable  |
| commitment_hash | [u8; 32] | immutable  |
| total_plays     | u64      | immutable  |
| submitted_at    | i64      | immutable  |
| settled         | bool     | mutable    |
| bump            | u8       | immutable  |

`day_timestamp` = unix timestamp truncated to UTC midnight (divisible by 86400).

### 5.8 SettlementRecord

Record of a settlement batch for a venue.

**PDA Seeds:** `["settlement", venue_pubkey, &period_start.to_le_bytes(), &settled_at.to_le_bytes()]`

| Field            | Type     | Mutability |
| ---------------- | -------- | ---------- |
| venue            | Pubkey   | immutable  |
| period_start     | i64      | immutable  |
| period_end       | i64      | immutable  |
| total_plays      | u64      | immutable  |
| total_amount     | u64      | immutable  |
| platform_fee     | u64      | immutable  |
| commitment_count | u16      | immutable  |
| merkle_root      | [u8; 32] | immutable  |
| ip_count         | u16      | immutable  |
| settled_at       | i64      | immutable  |
| bump             | u8       | immutable  |

`settled_at` is client-supplied, validated within ±30 seconds of on-chain clock. Enables multiple partial settlements per period.

### 5.9 LicenseTemplate

Programmable license terms created by an IP owner. Kollect-internal business logic account.

**PDA Seeds:** `["license_template", ip_account_pubkey, template_name_32bytes]`

| Field          | Type     | Mutability |
| -------------- | -------- | ---------- |
| ip_account     | Pubkey   | immutable  |
| ip_config      | Pubkey   | immutable  |
| creator_entity | Pubkey   | immutable  |
| template_name  | [u8; 32] | immutable  |
| price          | u64      | mutable    |
| max_grants     | u16      | immutable  |
| current_grants | u16      | mutable    |
| grant_duration | i64      | mutable    |
| is_active      | bool     | mutable    |
| created_at     | i64      | immutable  |
| updated_at     | i64      | mutable    |
| bump           | u8       | immutable  |

`template_name` — e.g. `b"remix-standard"` right-padded to 32 bytes.

### 5.10 License (Thin Interface)

See §4. Created alongside a LicenseTemplate.

**PDA Seeds:** `["license", license_template_pubkey]`

1:1 with LicenseTemplate. Created during `create_license_template`, never updated.

### 5.11 LicenseGrant (Thin Interface)

See §4. Created during `purchase_license`.

**PDA Seeds:** `["license_grant", license_pubkey, grantee_entity_pubkey]`

One grant per license per entity.

### 5.12 RoyaltyPolicy

Per-LicenseTemplate royalty configuration.

**PDA Seeds:** `["royalty_policy", license_template_pubkey]`

| Field                | Type   | Mutability |
| -------------------- | ------ | ---------- |
| license_template     | Pubkey | immutable  |
| derivative_share_bps | u16    | mutable    |
| allow_remix          | bool   | mutable    |
| allow_cover          | bool   | mutable    |
| allow_sample         | bool   | mutable    |
| attribution_required | bool   | mutable    |
| commercial_use       | bool   | mutable    |
| created_at           | i64    | immutable  |
| updated_at           | i64    | mutable    |
| bump                 | u8     | immutable  |

### 5.13 RoyaltySplit

Revenue link between a derivative IP and its origin. Auto-created during `onboard_ip` when a DerivativeLink exists. Royalties flow **bottom-to-top**.

**PDA Seeds:** `["royalty_split", derivative_ip_pubkey, origin_ip_pubkey]`

| Field             | Type   | Mutability |
| ----------------- | ------ | ---------- |
| derivative_ip     | Pubkey | immutable  |
| origin_ip         | Pubkey | immutable  |
| license_grant     | Pubkey | immutable  |
| royalty_policy    | Pubkey | immutable  |
| share_bps         | u16    | immutable  |
| total_distributed | u64    | mutable    |
| created_at        | i64    | immutable  |
| bump              | u8     | immutable  |

`share_bps` is snapshotted from the RoyaltyPolicy at onboarding time.

---

## 6. PDA Seeds Quick Reference

All seeds are derived from **kollect's program ID** (`AktoxndpdZfTsAdqAUFsoBPvr6dN7EoCREqDUYKqarB8`).

| Seed Constant            | Value                  | Dynamic Components                                                              |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------- |
| `PLATFORM_CONFIG_SEED`   | `b"platform_config"`   | —                                                                               |
| `PLATFORM_TREASURY_SEED` | `b"platform_treasury"` | —                                                                               |
| `IP_CONFIG_SEED`         | `b"ip_config"`         | `ip_account.key()`                                                              |
| `IP_TREASURY_SEED`       | `b"ip_treasury"`       | `ip_account.key()`                                                              |
| `ENTITY_TREASURY_SEED`   | `b"entity_treasury"`   | `entity.key()`                                                                  |
| `VENUE_SEED`             | `b"venue"`             | `&venue_id.to_le_bytes()` (u64)                                                 |
| `PLAYBACK_SEED`          | `b"playback"`          | `venue.key()`, `&day_timestamp.to_le_bytes()` (i64)                             |
| `SETTLEMENT_SEED`        | `b"settlement"`        | `venue.key()`, `&period_start.to_le_bytes()`, `&settled_at.to_le_bytes()` (i64) |
| `LICENSE_TEMPLATE_SEED`  | `b"license_template"`  | `ip_account.key()`, `template_name` ([u8; 32])                                  |
| `LICENSE_SEED`           | `b"license"`           | `license_template.key()`                                                        |
| `LICENSE_GRANT_SEED`     | `b"license_grant"`     | `license.key()`, `grantee_entity.key()`                                         |
| `ROYALTY_POLICY_SEED`    | `b"royalty_policy"`    | `license_template.key()`                                                        |
| `ROYALTY_SPLIT_SEED`     | `b"royalty_split"`     | `derivative_ip.key()`, `origin_ip.key()`                                        |

---

## 7. Instruction Reference (22 Instructions)

### 7.1 Platform Management

| Instruction              | Arguments                                                                                                                      | Authority                 | Creates/Mutates                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | -------------------------------------- |
| `initialize_platform`    | `base_price_per_play: u64`, `platform_fee_bps: u16`, `currency: Pubkey`, `max_derivatives_depth: u8`, `max_license_types: u16` | Initial deployer (signer) | PlatformConfig, PlatformTreasury + ATA |
| `update_platform_config` | `UpdatePlatformConfigParams` (all optional: authority, base_price, fee_bps, depth, license_types)                              | config.authority          | PlatformConfig                         |
| `withdraw_platform_fees` | `amount: u64`                                                                                                                  | treasury.authority        | Token transfers                        |

### 7.2 IP Onboarding

| Instruction        | Arguments                                          | Authority                                    | Creates/Mutates                                          |
| ------------------ | -------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| `onboard_ip`       | `price_per_play_override: Option<u64>`             | Platform authority only                      | IpConfig, IpTreasury + ATA, (RoyaltySplit if derivative) |
| `update_ip_config` | `new_price_per_play_override: Option<Option<u64>>` | Entity controller (via `remaining_accounts`) | IpConfig                                                 |
| `deactivate_ip`    | —                                                  | Platform authority                           | IpConfig.is_active → false                               |
| `reactivate_ip`    | —                                                  | Platform authority                           | IpConfig.is_active → true                                |

**`onboard_ip` derivative handling:** When the IP has a `DerivativeLink` in `ip_core`, the instruction automatically creates a `RoyaltySplit`. Requires `DerivativeLink`, `LicenseGrant`, `License`, and `RoyaltyPolicy` as additional inputs.

### 7.3 Entity Treasury

| Instruction                  | Arguments           | Authority                                    | Creates/Mutates                                                       |
| ---------------------------- | ------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `initialize_entity_treasury` | `authority: Pubkey` | Entity controller (via `remaining_accounts`) | EntityTreasury + ATA                                                  |
| `withdraw_entity_earnings`   | `amount: u64`       | treasury.authority                           | Token transfer, EntityTreasury.total_withdrawn                        |
| `withdraw_ip_treasury`       | `amount: u64`       | Entity controller (via `remaining_accounts`) | IpTreasury.total_settled, EntityTreasury.total_earned, token transfer |

**Withdrawal constraints:**

- `withdraw_ip_treasury`: `amount ≤ (ip_treasury.total_earned - ip_treasury.total_settled)`
- `withdraw_entity_earnings`: `amount ≤ (entity_treasury.total_earned - entity_treasury.total_withdrawn)`

### 7.4 Venue Management

| Instruction               | Arguments                                                               | Authority          | Creates/Mutates                |
| ------------------------- | ----------------------------------------------------------------------- | ------------------ | ------------------------------ |
| `register_venue`          | `venue_id: u64`, `RegisterVenueParams` (cid, multiplier_bps, authority) | Platform authority | VenueAccount                   |
| `update_venue`            | `UpdateVenueParams` (cid)                                               | venue.authority    | VenueAccount                   |
| `update_venue_multiplier` | `new_multiplier_bps: u16`                                               | Platform authority | VenueAccount.multiplier_bps    |
| `deactivate_venue`        | —                                                                       | Platform authority | VenueAccount.is_active → false |
| `reactivate_venue`        | —                                                                       | Platform authority | VenueAccount.is_active → true  |

`venue_id` is a `u64` assigned by the off-chain platform. Deterministic from the off-chain venue record.

### 7.5 Licensing

| Instruction               | Arguments                                                                                                                                         | Authority                 | Creates/Mutates                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| `create_license_template` | `template_name: [u8; 32]`, `price: u64`, `max_grants: u16`, `grant_duration: i64`                                                                 | Entity controller         | LicenseTemplate, License (thin)                                        |
| `update_license_template` | `UpdateLicenseTemplateParams` (price, grant_duration, is_active)                                                                                  | Entity controller         | LicenseTemplate                                                        |
| `create_royalty_policy`   | `derivative_share_bps: u16`, `allow_remix: bool`, `allow_cover: bool`, `allow_sample: bool`, `attribution_required: bool`, `commercial_use: bool` | Entity controller         | RoyaltyPolicy                                                          |
| `update_royalty_policy`   | `UpdateRoyaltyPolicyParams`                                                                                                                       | Entity controller         | RoyaltyPolicy                                                          |
| `purchase_license`        | — (accounts carry all context)                                                                                                                    | Grantee entity controller | LicenseGrant (thin), LicenseTemplate.current_grants++, token transfers |

### 7.6 Playback & Settlement

| Instruction       | Arguments                                                                    | Authority                                          | Creates/Mutates                                                                                        |
| ----------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `submit_playback` | `day_timestamp: i64`, `commitment_hash: [u8; 32]`, `total_plays: u64`        | Platform authority                                 | PlaybackCommitment, VenueAccount.total_commitments                                                     |
| `settle_period`   | `period_start: i64`, `settled_at: i64`, `distributions: Vec<IpDistribution>` | Platform authority + venue authority (dual-signer) | SettlementRecord, PlaybackCommitments (settled=true), IpTreasury(s), RoyaltySplit(s), PlatformTreasury |

**`IpDistribution` struct** (instruction data):

```rust
pub struct IpDistribution {
    pub ip_account: Pubkey,  // ip_core IpAccount
    pub amount: u64,         // gross amount before royalty splits
    pub plays: u64,          // play count for this IP
}
```

---

## 8. Pricing & Math

All arithmetic MUST use checked operations.

### Effective Price Per Play

```
effective_price = (ip_config.price_per_play_override OR platform.base_price_per_play)
                  × venue.multiplier_bps / 10_000
```

### Settlement Amounts

```
total_amount = sum(distributions.amount) + platform_fee
platform_fee = sum(distributions.amount) × platform.platform_fee_bps / 10_000
```

**Validation:**

```
sum(distributions.plays) == sum(commitments.total_plays)
```

### License Purchase Fee

```
gross_license = license_template.price
platform_cut  = gross_license × platform.platform_fee_bps / 10_000
net_to_ip     = gross_license - platform_cut
```

### Royalty Split (per IP during settlement)

```
royalty_to_origin = net_to_ip × royalty_split.share_bps / 10_000
net_to_derivative = net_to_ip - royalty_to_origin
```

Chain walks upward (max `MAX_ROYALTY_CHAIN_DEPTH` = 3 levels).

### Basis Points Helper

```rust
pub fn calculate_bps(amount: u64, bps: u16) -> Result<u64> {
    amount
        .checked_mul(bps as u64)
        .and_then(|v| v.checked_div(10_000))
        .ok_or_else(|| error!(KollectError::ArithmeticOverflow))
}
```

---

## 9. Settlement Flow

### Daily: Submit Playback Commitments

1. Off-chain sniffing device reports playback data to platform backend
2. Backend hashes `{ track, count }[]` into a SHA-256 commitment
3. Platform authority calls `submit_playback` with `(venue, day_timestamp, commitment_hash, total_plays)`
4. `day_timestamp` must be aligned to UTC midnight (divisible by 86400)
5. One commitment per venue per day (PDA enforces uniqueness)

### Settlement: `settle_period`

Settlement can happen at any time (no end-of-period wait required). Multiple partial settlements per period allowed.

1. **Validate inputs**: `settled_at` within ±30 seconds of on-chain clock; `period_start` is a Monday
2. **Collect commitments**: gather all unsettled `PlaybackCommitment`s for this venue within the period
3. **Build merkle root**: balanced binary merkle tree of commitment hashes
4. **Validate distributions**: `sum(distributions.plays) == sum(commitments.total_plays)`; all IPs must be onboarded
5. **Platform fee transfer**: single SPL transfer from venue's token account → PlatformTreasury ATA
6. **Per-IP distribution with royalty chain walk**:
   - For each IP in `distributions`:
     - If IP has a `RoyaltySplit` (it's a derivative): deduct `share_bps`, transfer to origin IP's `IpTreasury` ATA
     - Recurse upward (origin may also be a derivative)
     - Chain depth bounded by `MAX_ROYALTY_CHAIN_DEPTH` = 3
     - Transfer remaining net to the IP's own `IpTreasury` ATA
7. **Update counters**: `IpTreasury.total_earned`, `RoyaltySplit.total_distributed`
8. **Mark commitments settled**: `PlaybackCommitment.settled = true`
9. **Create SettlementRecord** with merkle root, totals, IP count

**Dual-signer model**: Platform authority provides distribution data; venue authority funds the settlement and co-signs.

**Deactivated IPs** can still receive settlement — revenue earned while active is distributable.

---

## 10. Licensing Flow

### End-to-End Sequence

```
1. Platform authority onboards IP    →  onboard_ip         →  IpConfig + IpTreasury
2. Entity creates license terms      →  create_license_template  →  LicenseTemplate + License (thin)
3. Entity creates royalty policy     →  create_royalty_policy     →  RoyaltyPolicy
4. Another entity purchases license  →  purchase_license    →  LicenseGrant (thin) + token transfers
5. Grantee creates derivative in ip_core  →  ip_core::create_derivative_link
6. Platform onboards derivative      →  onboard_ip         →  IpConfig + IpTreasury + RoyaltySplit (auto)
```

### License Purchase Details

1. Grantee entity controller calls `purchase_license`
2. If `price > 0`: SPL token transfer from buyer to:
   - Platform treasury: `price × platform_fee_bps / 10_000`
   - IP treasury (origin IP): remainder
3. `LicenseGrant` thin account created with expiration = `now + grant_duration` (or 0 for perpetual)
4. `LicenseTemplate.current_grants` incremented (bounded by `max_grants`; 0 = unlimited)
5. `LicensePurchased` event emitted with `price_paid`, `platform_fee`, `net_to_owner`

### Creating a Derivative

1. Grantee calls `ip_core::create_derivative_link` passing:
   - `license` = the `License` PDA (thin account, owned by `kollect`)
   - `license_grant` = the `LicenseGrant` PDA (thin account, owned by `kollect`)
   - `license_program_id` = `kollect`'s program ID (instruction argument)
2. `ip_core` validates ownership, structure, expiration
3. Platform onboards derivative via `onboard_ip` → auto-creates `RoyaltySplit`

### Royalty Distribution (Bottom-to-Top)

During settlement, for each derivative IP:

```
Depth 0: derivative_D earns 1000
         → RoyaltySplit(D→C): 15% → 150 to C's IpTreasury
         → D keeps 850

Depth 1: C's 150 is checked
         → RoyaltySplit(C→B): 15% → 22 to B's IpTreasury
         → C keeps 128

Depth 2: B's 22 is checked
         → RoyaltySplit(B→A): 15% → 3 to A's IpTreasury
         → B keeps 19

(max depth reached, chain stops)
```

---

## 11. Constants

| Constant                         | Value    | Description                                         |
| -------------------------------- | -------- | --------------------------------------------------- |
| `MAX_ROYALTY_CHAIN_DEPTH`        | `3`      | Max levels for royalty chain walk during settlement |
| `SETTLEMENT_PERIOD_SECONDS`      | `604800` | 7 days in seconds                                   |
| `SECONDS_PER_DAY`                | `86400`  | 24 × 60 × 60                                        |
| `BPS_DENOMINATOR`                | `10_000` | 100% in basis points                                |
| `MAX_CID_LENGTH`                 | `96`     | IPFS CIDv1 base32 max bytes                         |
| `MAX_TEMPLATE_NAME_LENGTH`       | `32`     | License template name max bytes                     |
| `SETTLEMENT_TIMESTAMP_TOLERANCE` | `30`     | ±30 seconds for `settled_at` validation             |

---

## 12. Error Reference

### Platform

| Error                        | Description                     |
| ---------------------------- | ------------------------------- |
| `PlatformAlreadyInitialized` | Platform config already exists  |
| `Unauthorized`               | Signer lacks required authority |
| `InvalidAuthority`           | Invalid authority pubkey        |

### IP Onboarding

| Error                  | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `IpNotRegistered`      | ip_core IpAccount doesn't exist or wrong owner |
| `IpAlreadyOnboarded`   | IpConfig already exists for this IP            |
| `IpNotActive`          | IP is deactivated on kollect                   |
| `IpNotOnboarded`       | IpConfig doesn't exist                         |
| `IpOwnerMismatch`      | Entity doesn't own the IP in ip_core           |
| `InvalidIpCoreAccount` | Account owner ≠ ip_core program                |
| `IpAlreadyActive`      | Reactivating an already active IP              |

### Venue

| Error                    | Description                          |
| ------------------------ | ------------------------------------ |
| `VenueAlreadyRegistered` | Venue PDA already exists             |
| `VenueNotActive`         | Venue is deactivated                 |
| `InvalidVenueType`       | Invalid venue type value             |
| `InvalidCapacity`        | Invalid capacity value               |
| `InvalidOperatingHours`  | Invalid operating hours              |
| `InvalidMultiplier`      | multiplier_bps must be > 0           |
| `VenueAlreadyActive`     | Reactivating an already active venue |

### Playback & Settlement

| Error                        | Description                                             |
| ---------------------------- | ------------------------------------------------------- |
| `PlaybackAlreadySubmitted`   | Duplicate day commitment for venue                      |
| `InvalidDayTimestamp`        | Not aligned to UTC midnight                             |
| `PlayCountMismatch`          | sum(distributions.plays) ≠ sum(commitments.total_plays) |
| `InvalidSettlementTimestamp` | settled_at not within ±30s of clock                     |
| `CommitmentAlreadySettled`   | Commitment already marked settled                       |
| `NoCommitmentsToSettle`      | No unsettled commitments in period                      |
| `InvalidSettlementPeriod`    | Invalid period boundaries                               |
| `DistributionAmountMismatch` | Distribution amounts ≠ expected total                   |

### Finance

| Error                          | Description                                     |
| ------------------------------ | ----------------------------------------------- |
| `ArithmeticOverflow`           | Checked arithmetic overflow                     |
| `InsufficientPayment`          | License purchase price not met                  |
| `InsufficientVenueBalance`     | Venue token account insufficient for settlement |
| `InvalidCurrency`              | Wrong SPL mint for payment                      |
| `EntityTreasuryNotInitialized` | EntityTreasury doesn't exist                    |
| `InsufficientSignatures`       | Entity controller not signed                    |

### Licensing

| Error                      | Description                                |
| -------------------------- | ------------------------------------------ |
| `LicenseTemplateNotActive` | Template is deactivated                    |
| `MaxGrantsReached`         | Template has issued max_grants             |
| `LicenseAlreadyGranted`    | Duplicate grant for same template + entity |
| `LicenseExpired`           | License grant has expired                  |
| `InvalidLicenseTemplate`   | IP not onboarded or wrong owner            |
| `InvalidGrantDuration`     | Invalid duration value                     |
| `MaxLicenseTypesReached`   | IP reached max_license_types from config   |

### Royalty & Derivative

| Error                        | Description                         |
| ---------------------------- | ----------------------------------- |
| `RoyaltyPolicyAlreadyExists` | Policy already exists for template  |
| `RoyaltySplitAlreadyExists`  | Split already exists for this pair  |
| `InvalidDerivativeLink`      | No DerivativeLink in ip_core        |
| `RoyaltyChainTooDeep`        | Exceeds MAX_ROYALTY_CHAIN_DEPTH (3) |
| `InvalidRoyaltySplitPda`     | RoyaltySplit PDA mismatch           |
| `InvalidShareBps`            | Basis points exceeds 10000          |
| `InvalidCid`                 | Empty or invalid content identifier |

---

## 13. Event Reference

### Platform Events

```rust
PlatformInitialized     { config, authority, base_price_per_play, platform_fee_bps }
PlatformConfigUpdated   { config, authority, base_price_per_play, platform_fee_bps, max_derivatives_depth, max_license_types }
PlatformFeesWithdrawn   { treasury, amount, destination }
```

### IP Onboarding Events

```rust
IpOnboarded       { ip_config, ip_account, owner_entity, price_override: Option<u64>, is_derivative, onboarded_at }
IpConfigUpdated   { ip_config, price_per_play_override: Option<u64>, updated_at }
IpDeactivated     { ip_config, deactivated_at }
IpReactivated     { ip_config, reactivated_at }
```

### Entity Treasury Events

```rust
EntityTreasuryInitialized  { entity_treasury, entity, authority }
EntityEarningsWithdrawn    { entity_treasury, amount, destination }
IpTreasuryWithdrawn        { ip_treasury, entity_treasury, amount }
```

### Venue Events

```rust
VenueRegistered        { venue, venue_id, authority, cid: [u8; 96], registered_at }
VenueUpdated           { venue, cid: [u8; 96], updated_at }
VenueMultiplierUpdated { venue, old_multiplier, new_multiplier, updated_by }
VenueDeactivated       { venue, deactivated_at }
VenueReactivated       { venue, reactivated_at }
```

### Licensing Events

```rust
LicenseTemplateCreated  { template, license, ip_account, creator_entity, template_name: [u8; 32], price, max_grants }
LicenseTemplateUpdated  { template, price, max_grants, grant_duration, is_active, updated_at }
RoyaltyPolicyCreated    { policy, template, derivative_share_bps, allow_remix, allow_cover, allow_sample }
RoyaltyPolicyUpdated    { policy, derivative_share_bps, allow_remix, allow_cover, allow_sample, attribution_required, commercial_use, updated_at }
LicensePurchased        { grant, template, grantee_entity, origin_ip, price_paid, platform_fee, net_to_owner, expiration }
RoyaltySplitCreated     { split, derivative_ip, origin_ip, share_bps }
```

### Playback & Settlement Events

```rust
PlaybackSubmitted   { commitment, venue, day_timestamp, commitment_hash: [u8; 32], total_plays }
PeriodSettled       { settlement, venue, period_start, period_end, total_plays, total_amount, platform_fee, ip_count }
RoyaltyDistributed  { from_ip, to_ip, amount, split }
```

---

## 14. TypeScript PDA Derivation

### Buffer Helpers

```typescript
function i64Buffer(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(value));
  return buf;
}

function u64Buffer(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function templateNameBuffer(name: string): Buffer {
  const buf = Buffer.alloc(32);
  buf.write(name, "utf-8");
  return buf;
}
```

### PDA Derivation Examples

```typescript
import { PublicKey } from "@solana/web3.js";

const KOLLECT_PROGRAM_ID = new PublicKey(
  "AktoxndpdZfTsAdqAUFsoBPvr6dN7EoCREqDUYKqarB8",
);

// Platform (singletons)
const [platformConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("platform_config")],
  KOLLECT_PROGRAM_ID,
);
const [platformTreasury] = PublicKey.findProgramAddressSync(
  [Buffer.from("platform_treasury")],
  KOLLECT_PROGRAM_ID,
);

// Per-entity
const [entityTreasury] = PublicKey.findProgramAddressSync(
  [Buffer.from("entity_treasury"), entityPda.toBuffer()],
  KOLLECT_PROGRAM_ID,
);

// Per-IP
const [ipConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("ip_config"), ipAccountPda.toBuffer()],
  KOLLECT_PROGRAM_ID,
);
const [ipTreasury] = PublicKey.findProgramAddressSync(
  [Buffer.from("ip_treasury"), ipAccountPda.toBuffer()],
  KOLLECT_PROGRAM_ID,
);

// Venue
const [venuePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("venue"), u64Buffer(venueId)],
  KOLLECT_PROGRAM_ID,
);

// Playback
const [playbackPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("playback"), venuePda.toBuffer(), i64Buffer(dayTimestamp)],
  KOLLECT_PROGRAM_ID,
);

// Settlement
const [settlementPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("settlement"),
    venuePda.toBuffer(),
    i64Buffer(periodStart),
    i64Buffer(settledAt),
  ],
  KOLLECT_PROGRAM_ID,
);

// Licensing
const [licenseTemplate] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("license_template"),
    ipAccountPda.toBuffer(),
    templateNameBuffer("remix-standard"),
  ],
  KOLLECT_PROGRAM_ID,
);
const [license] = PublicKey.findProgramAddressSync(
  [Buffer.from("license"), licenseTemplate.toBuffer()],
  KOLLECT_PROGRAM_ID,
);
const [licenseGrant] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("license_grant"),
    license.toBuffer(),
    granteeEntityPda.toBuffer(),
  ],
  KOLLECT_PROGRAM_ID,
);

// Royalty
const [royaltyPolicy] = PublicKey.findProgramAddressSync(
  [Buffer.from("royalty_policy"), licenseTemplate.toBuffer()],
  KOLLECT_PROGRAM_ID,
);
const [royaltySplit] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("royalty_split"),
    derivativeIpPda.toBuffer(),
    originIpPda.toBuffer(),
  ],
  KOLLECT_PROGRAM_ID,
);
```

---

## 15. Coding Constraints

When writing code that integrates with or extends kollect:

1. **Anchor 0.32+** — Use explicit `#[account(seeds = [...], bump)]` constraints
2. **Checked arithmetic** — Never use unchecked `+`, `-`, `*`, `/`; always `checked_*`
3. **No unbounded Vec** — All collections bounded by transaction size or constants
4. **Fixed-size fields** — No dynamic strings; use `[u8; N]` arrays (CID = 96, template name = 32)
5. **No account realloc** — Accounts are fixed size at creation
6. **Read-only ip_core** — Cross-program reads only, no CPI mutations
7. **Entity controller pattern** — Pass controller signer in `remaining_accounts`, validate against `Entity.controller`
8. **PDA-only identity** — No randomness, no nonce-based derivation, no clock-based uniqueness
9. **Timestamps** — Always `Clock::get()?.unix_timestamp`
10. **Basis points** — Use `u16` for bps values, `BPS_DENOMINATOR = 10_000` for calculations
11. **Token transfers** — All use `PlatformConfig.currency` mint; ATAs created at init time
12. **Immutable fields** — Never mutate fields marked immutable in account specs

### Folder Structure

```
programs/kollect/src/
├── lib.rs                          # Program entry — routing only, no logic
├── error.rs                        # KollectError enum
├── events.rs                       # All event structs
├── constants/mod.rs                # All constants
├── state/                          # One file per account struct
│   ├── mod.rs
│   ├── platform_config.rs
│   ├── platform_treasury.rs
│   ├── ip_config.rs
│   ├── ip_treasury.rs
│   ├── entity_treasury.rs
│   ├── venue_account.rs
│   ├── playback_commitment.rs
│   ├── settlement_record.rs
│   ├── license_template.rs
│   ├── license.rs
│   ├── license_grant.rs
│   ├── royalty_policy.rs
│   └── royalty_split.rs
├── instructions/                   # One file per instruction
│   ├── mod.rs
│   ├── platform/                   # initialize, update_config, withdraw_fees
│   ├── ip/                         # onboard, update, deactivate, reactivate
│   ├── entity/                     # init_treasury, withdraw_earnings, withdraw_ip_treasury
│   ├── venue/                      # register, update, update_multiplier, deactivate, reactivate
│   ├── licensing/                  # create_template, update_template, create_policy, update_policy, purchase
│   └── playback/                   # submit_playback, settle_period
└── utils/
    ├── mod.rs
    ├── seeds.rs                    # PDA seed constants
    └── validation.rs               # validate_entity_controller, validate_day_timestamp, calculate_bps
```

---

## 16. Testing Patterns

### Test File Convention

Tests live in `tests/kollect/` with numbered files:

```
tests/kollect/
├── setup.ts                 # PDA derivation helpers, test utilities, ip_core bootstrapping
├── 00_platform.test.ts      # Platform init, update, withdraw
├── 01_entity_treasury.test.ts
├── 02_venue.test.ts
├── 03_ip_onboarding.test.ts
├── 04_licensing.test.ts
├── 05_playback.test.ts
├── 06_royalty_depth.test.ts # Derivative chain depth 2 and 3
├── 07_withdrawals.test.ts
```

### Key Test Patterns

**Entity controller in remaining_accounts:**

```typescript
await program.methods
  .updateIpConfig(newOverride)
  .accounts({ entity, ipConfig, config })
  .remainingAccounts([
    {
      pubkey: entityControllerKeypair.publicKey,
      isSigner: true,
      isWritable: false,
    },
  ])
  .signers([entityControllerKeypair])
  .rpc();
```

**Dual-signer settlement:**

```typescript
await program.methods
  .settlePeriod(periodStart, settledAt, distributions)
  .accounts({ platformAuthority, venue, venueAuthority, platformTreasury, ... })
  .signers([platformAuthorityKeypair, venueAuthorityKeypair])
  .rpc();
```

**Withdrawal balance assertions:**

```typescript
// IP Treasury: amount ≤ (total_earned - total_settled)
// Entity Treasury: amount ≤ (total_earned - total_withdrawn)
```

**ATA creation verification:**
ATAs are created during `initialize_platform`, `initialize_entity_treasury`, and `onboard_ip` — assert they exist and have correct mint.
