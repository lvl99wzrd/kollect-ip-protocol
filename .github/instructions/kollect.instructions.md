---
description: "Use when writing, modifying, or reviewing code in the kollect program (programs/kollect/). Covers the Licensing & Royalty layer: platform config, IP licensing, venue registration, playback commitments, settlement, and treasury management for the Mycelium IP Protocol."
applyTo: "programs/kollect/**"
---

# Kollect Program – Licensing & Royalty Layer Specification

The `kollect` program is a **separate on-chain program** that builds on top of `ip_core`.
It handles music IP licensing, venue-based playback tracking via hash commitments, royalty policy enforcement, and weekly settlement.

**NEVER edit files in `programs/ip_core/`.** Only reference `ip_core` accounts as read-only cross-program inputs.

---

## 1. Architectural Role

- `ip_core` = neutral, deterministic IP claim registry (read-only dependency)
- `kollect` = economic layer: licensing, pricing, playback commitments, royalty settlement, license templates & grants

`kollect` reads `ip_core` accounts (Entity, IpAccount, DerivativeLink) but NEVER writes to them.
All `kollect` state lives in PDAs derived from the `kollect` program ID.

`kollect` is the **License Program** that `ip_core` validates against when creating DerivativeLinks.
`LicenseGrant` accounts owned by `kollect` satisfy `ip_core`'s minimal license interface (`origin_ip`, `derivatives_allowed`, `expiration`, `bump`).

**License program validation in ip_core**: `ip_core`'s `create_derivative_link` and `update_derivative_license` accept `license_program_id` as a **caller-supplied instruction argument** — the `LICENSE_PROGRAM_ID` constant in `ip_core` is dead code. The caller passes `kollect`'s program ID, and `ip_core` validates the license account's owner matches. This means **no changes to `ip_core` are needed** for `kollect` to function as the license program.

**Thin interface accounts**: `ip_core` deserializes license accounts using Borsh `try_from_slice`, which **rejects trailing bytes**. This means `kollect` accounts with extra fields beyond what `ip_core` expects will fail deserialization. Therefore, `kollect` uses dedicated thin `License` and `LicenseGrant` accounts containing **exactly** the fields `ip_core` expects — no more, no less. The richer `LicenseTemplate` (business logic, pricing, grants) is a separate `kollect`-internal account.

---

## 2. Cross-Program Integration with ip_core

When an instruction requires an `ip_core` account:

- Pass it as an `UncheckedAccount` or typed `Account<T>` with `owner = ip_core::ID` constraint
- Validate ownership: `account.owner == ip_core::ID`
- Deserialize manually or use Anchor's `Account<>` with `owner` constraint
- NEVER use CPI to mutate `ip_core` state

**Entity multisig validation**: Always perform a cross-program read of the `Entity` account to get the current `controllers` and `signature_threshold`. Never cache or replicate controller lists — they may change at any time in `ip_core`.

Key `ip_core` references:

- `Entity` – PDA seeds `["entity", creator, handle]` — fields: `controllers`, `signature_threshold`
- `IpAccount` – PDA seeds `["ip", registrant_entity, content_hash]` — fields: `current_owner_entity`
- `DerivativeLink` – PDA seeds `["derivative", parent_ip, child_ip]` — fields: `license`, `parent_ip`, `child_ip`
- `ip_core` program ID: `CSSfTXVfCUmvZCEjPZxFne5EPewzTGCyYAybLNihLQM1`

---

## 3. Account Specifications

### 3.1 PlatformConfig (Singleton)

Platform-wide configuration. One instance per deployment.

**PDA Seeds:** `["platform_config"]`

| Field               | Type   | Mutability | Description                                           |
| ------------------- | ------ | ---------- | ----------------------------------------------------- |
| authority           | Pubkey | mutable    | Platform admin, can update config and submit playback |
| platform_fee_bps    | u16    | mutable    | Platform fee in basis points (e.g. 500 = 5%)          |
| base_price_per_play | u64    | mutable    | Default price per play in lamports/tokens             |
| settlement_currency | Pubkey | mutable    | SPL token mint for settlements                        |
| max_derivatives     | u16    | mutable    | Max derivative licenses per IP on this platform       |
| treasury            | Pubkey | mutable    | Platform treasury PDA reference                       |
| bump                | u8     | immutable  | PDA bump                                              |

Settlement period is **weekly** (platform-wide, hardcoded for POC — 7 days from period start).

### 3.2 PlatformTreasury

Platform-level fee collection.

**PDA Seeds:** `["platform_treasury"]`

| Field     | Type   | Mutability | Description                 |
| --------- | ------ | ---------- | --------------------------- |
| authority | Pubkey | mutable    | Can withdraw platform fees  |
| config    | Pubkey | immutable  | Reference to PlatformConfig |
| bump      | u8     | immutable  | PDA bump                    |

### 3.3 IpConfig

Per-IP onboarding on the kollect platform. Not all `ip_core` IPs are registered here — only those the Entity (IP owner) decides to onboard.

**PDA Seeds:** `["ip_config", ip_account.key()]`

| Field                   | Type        | Mutability | Description                                      |
| ----------------------- | ----------- | ---------- | ------------------------------------------------ |
| ip_account              | Pubkey      | immutable  | Reference to ip_core IpAccount                   |
| owner_entity            | Pubkey      | mutable    | Current owning Entity (synced from ip_core)      |
| price_per_play_override | Option<u64> | mutable    | Overrides platform base_price_per_play if Some   |
| is_active               | bool        | mutable    | Whether this IP is actively licensed on platform |
| onboarded_at            | i64         | immutable  | Unix timestamp                                   |
| updated_at              | i64         | mutable    | Unix timestamp                                   |
| bump                    | u8          | immutable  | PDA bump                                         |

### 3.4 EntityTreasury

Per-entity treasury for collecting royalties.

**PDA Seeds:** `["entity_treasury", entity.key()]`

| Field           | Type   | Mutability | Description                 |
| --------------- | ------ | ---------- | --------------------------- |
| entity          | Pubkey | immutable  | Reference to ip_core Entity |
| authority       | Pubkey | mutable    | Withdrawal authority        |
| total_earned    | u64    | mutable    | Cumulative earnings tracked |
| total_withdrawn | u64    | mutable    | Cumulative withdrawals      |
| bump            | u8     | immutable  | PDA bump                    |

### 3.5 IpTreasury

Per-IP treasury for collecting playback royalties.

**PDA Seeds:** `["ip_treasury", ip_account.key()]`

| Field           | Type   | Mutability | Description                    |
| --------------- | ------ | ---------- | ------------------------------ |
| ip_account      | Pubkey | immutable  | Reference to ip_core IpAccount |
| ip_config       | Pubkey | immutable  | Reference to IpConfig          |
| entity_treasury | Pubkey | immutable  | Parent EntityTreasury          |
| total_earned    | u64    | mutable    | Cumulative earnings            |
| total_settled   | u64    | mutable    | Cumulative settled to entity   |
| bump            | u8     | immutable  | PDA bump                       |

### 3.6 VenueAccount

Registered venue that plays music tracked by the platform.

**PDA Seeds:** `["venue", &venue_id.to_le_bytes()]`

`venue_id` is a `u64` assigned by the off-chain platform. Deterministic from the off-chain venue record.

| Field             | Type     | Mutability | Description                                                      |
| ----------------- | -------- | ---------- | ---------------------------------------------------------------- |
| venue_id          | u64      | immutable  | Off-chain platform venue identifier                              |
| authority         | Pubkey   | mutable    | Venue operator wallet                                            |
| name              | [u8; 64] | mutable    | Venue name (fixed-size, UTF-8 padded)                            |
| venue_type        | u8       | mutable    | Enum: Bar=0, Club=1, Restaurant=2, Retail=3, Arena=4, Festival=5 |
| capacity          | u32      | mutable    | Venue capacity (number of people)                                |
| operating_hours   | u8       | mutable    | Daily operating hours (1-24)                                     |
| multiplier_bps    | u16      | mutable    | Venue price multiplier in bps (10000 = 1x)                       |
| is_active         | bool     | mutable    | Whether venue is active on the platform                          |
| total_commitments | u64      | mutable    | Total playback commitments submitted                             |
| registered_at     | i64      | immutable  | Unix timestamp                                                   |
| updated_at        | i64      | mutable    | Unix timestamp                                                   |
| bump              | u8       | immutable  | PDA bump                                                         |

### 3.7 PlaybackCommitment

Daily playback hash commitment from a venue. Only the **platform authority** may submit these (data comes from the off-chain sniffing device via the platform backend).

**PDA Seeds:** `["playback", venue.key(), &day_timestamp.to_le_bytes()]`

`day_timestamp` = unix timestamp truncated to start-of-day (UTC midnight).

| Field           | Type     | Mutability | Description                                |
| --------------- | -------- | ---------- | ------------------------------------------ |
| venue           | Pubkey   | immutable  | Venue that generated this playback data    |
| day_timestamp   | i64      | immutable  | UTC day start (00:00:00) as unix timestamp |
| commitment_hash | [u8; 32] | immutable  | SHA-256 hash of daily playback data        |
| total_plays     | u64      | immutable  | Total play count for the day               |
| submitted_at    | i64      | immutable  | When the commitment was submitted on-chain |
| settled         | bool     | mutable    | Whether this commitment has been settled   |
| bump            | u8       | immutable  | PDA bump                                   |

### 3.8 SettlementRecord

Record of a weekly settlement batch for a venue.

**PDA Seeds:** `["settlement", venue.key(), &period_start.to_le_bytes()]`

| Field            | Type     | Mutability | Description                                   |
| ---------------- | -------- | ---------- | --------------------------------------------- |
| venue            | Pubkey   | immutable  | Venue being settled                           |
| period_start     | i64      | immutable  | Settlement period start timestamp (Monday)    |
| period_end       | i64      | immutable  | Settlement period end timestamp (Sunday)      |
| total_plays      | u64      | immutable  | Aggregate plays in this period                |
| total_amount     | u64      | immutable  | Total settlement amount                       |
| platform_fee     | u64      | immutable  | Platform fee deducted                         |
| commitment_count | u16      | immutable  | Number of PlaybackCommitments included        |
| merkle_root      | [u8; 32] | immutable  | Merkle root of all included commitment hashes |
| ip_count         | u16      | immutable  | Number of IPs in the distribution             |
| settled_at       | i64      | immutable  | When settlement was executed                  |
| bump             | u8       | immutable  | PDA bump                                      |

The `settle_period` instruction takes `Vec<IpDistribution>` as instruction data:

```rust
pub struct IpDistribution {
    pub ip_account: Pubkey,  // ip_core IpAccount
    pub amount: u64,         // gross amount earned by this IP (before royalty splits)
    pub plays: u64,          // play count for this IP
}
```

The on-chain logic validates that `sum(distributions.amount) == total_amount - platform_fee` and that all referenced IPs are onboarded. Per-IP revenue is recorded for clear reporting.

### 3.9 LicenseTemplate

Programmable license terms created by an IP owner for an onboarded IP. This is the `kollect`-internal configuration account with rich business logic fields.

**PDA Seeds:** `["license_template", ip_account.key(), template_name]`

`template_name` is a `[u8; 32]` unique label per IP (e.g. `b"remix-standard"` padded).

| Field          | Type     | Mutability | Description                                  |
| -------------- | -------- | ---------- | -------------------------------------------- |
| ip_account     | Pubkey   | immutable  | Origin IP (ip_core IpAccount)                |
| ip_config      | Pubkey   | immutable  | Must be onboarded on kollect                 |
| creator_entity | Pubkey   | immutable  | Entity that created this template (IP owner) |
| template_name  | [u8; 32] | immutable  | Unique name for this template                |
| price          | u64      | mutable    | Price to purchase a grant (0 = free)         |
| currency       | Pubkey   | mutable    | SPL token mint for purchase price            |
| max_grants     | u16      | mutable    | Max grants issuable (0 = unlimited)          |
| current_grants | u16      | mutable    | Number of grants currently issued            |
| grant_duration | i64      | mutable    | Duration in seconds (0 = perpetual)          |
| is_active      | bool     | mutable    | Whether new grants can be purchased          |
| created_at     | i64      | immutable  | Unix timestamp                               |
| updated_at     | i64      | mutable    | Unix timestamp                               |
| bump           | u8       | immutable  | PDA bump                                     |

`current_grants` is a bounded counter (capped by `max_grants`). It is NOT used for PDA derivation.

### 3.10 License (Thin Interface Account)

Thin account created alongside a `LicenseTemplate`. Exists **solely** to satisfy `ip_core`'s `LicenseData` deserialization via `try_from_slice`.

`ip_core` uses `try_from_slice` which **rejects trailing bytes** — the account must contain exactly the fields `ip_core` expects, nothing more.

**PDA Seeds:** `["license", license_template.key()]`

1:1 relationship with `LicenseTemplate`. Created during `create_license_template`, never updated.

**Field layout matches `ip_core`'s `LicenseData` exactly (after 8-byte Anchor discriminator):**

| Field               | Type   | Mutability | Description                      |
| ------------------- | ------ | ---------- | -------------------------------- |
| origin_ip           | Pubkey | immutable  | = LicenseTemplate.ip_account     |
| authority           | Pubkey | immutable  | = LicenseTemplate.creator_entity |
| derivatives_allowed | bool   | immutable  | Always `true`                    |
| created_at          | i64    | immutable  | = LicenseTemplate.created_at     |
| bump                | u8     | immutable  | PDA bump                         |

Size: 8 (discriminator) + 32 + 32 + 1 + 8 + 1 = **82 bytes**.

Passed as the `license` account in `ip_core::create_derivative_link`.

### 3.11 LicenseGrant (Thin Interface Account)

Thin account created during `purchase_license`. Exists **solely** to satisfy `ip_core`'s `LicenseGrantData` deserialization via `try_from_slice`.

**PDA Seeds:** `["license_grant", license.key(), grantee_entity.key()]`

Note: seeds reference the `License` PDA (not LicenseTemplate), because `ip_core` validates `LicenseGrant.license == license_info.key()`.

One grant per license per entity. To obtain multiple license types from the same IP, the IP owner creates multiple `LicenseTemplate`s (each with its own `License`).

**Field layout matches `ip_core`'s `LicenseGrantData` exactly (after 8-byte Anchor discriminator):**

| Field      | Type   | Mutability | Description                                              |
| ---------- | ------ | ---------- | -------------------------------------------------------- |
| license    | Pubkey | immutable  | = License PDA key                                        |
| grantee    | Pubkey | immutable  | = grantee Entity key                                     |
| granted_at | i64    | immutable  | Unix timestamp                                           |
| expiration | i64    | immutable  | 0 = no expiration, computed from template.grant_duration |
| bump       | u8     | immutable  | PDA bump                                                 |

Size: 8 (discriminator) + 32 + 32 + 8 + 8 + 1 = **89 bytes**.

Passed as the `license_grant` account in `ip_core::create_derivative_link`.

Additional purchase metadata (`price_paid`, `platform_fee`) is emitted via `LicensePurchased` event — not stored on-chain since it's historical and derivable from the template's price at time of purchase.

### 3.12 RoyaltyPolicy

Per-LicenseTemplate royalty configuration. Defines how derivatives share revenue back to the origin IP.

**PDA Seeds:** `["royalty_policy", license_template.key()]`

| Field                | Type   | Mutability | Description                                  |
| -------------------- | ------ | ---------- | -------------------------------------------- |
| license_template     | Pubkey | immutable  | Parent LicenseTemplate                       |
| derivative_share_bps | u16    | mutable    | % of derivative revenue owed to origin (bps) |
| allow_remix          | bool   | mutable    | Derivative type: remix allowed               |
| allow_cover          | bool   | mutable    | Derivative type: cover allowed               |
| allow_sample         | bool   | mutable    | Derivative type: sample allowed              |
| attribution_required | bool   | mutable    | Whether derivative must credit origin        |
| commercial_use       | bool   | mutable    | Whether derivative can be used commercially  |
| created_at           | i64    | immutable  | Unix timestamp                               |
| updated_at           | i64    | mutable    | Unix timestamp                               |
| bump                 | u8     | immutable  | PDA bump                                     |

### 3.13 RoyaltySplit

Records the royalty distribution link between a derivative IP and its origin IP. Created when a derivative IP is onboarded on kollect and has a `DerivativeLink` in `ip_core`.

Royalties flow **bottom-to-top**: when a derivative earns revenue, a share goes to the origin, which may itself be a derivative owing a share upward.

**PDA Seeds:** `["royalty_split", derivative_ip.key(), origin_ip.key()]`

| Field             | Type   | Mutability | Description                                     |
| ----------------- | ------ | ---------- | ----------------------------------------------- |
| derivative_ip     | Pubkey | immutable  | The derivative IpAccount (ip_core)              |
| origin_ip         | Pubkey | immutable  | The parent/origin IpAccount (ip_core)           |
| license_grant     | Pubkey | immutable  | LicenseGrant under which derivative was created |
| royalty_policy    | Pubkey | immutable  | RoyaltyPolicy governing the split               |
| share_bps         | u16    | immutable  | Snapshot of derivative_share_bps at creation    |
| total_distributed | u64    | mutable    | Cumulative amount distributed to origin         |
| created_at        | i64    | immutable  | Unix timestamp                                  |
| bump              | u8     | immutable  | PDA bump                                        |

**Auto-created during `onboard_ip`**: When onboarding an IP that has a `DerivativeLink` in `ip_core`, the `onboard_ip` instruction automatically creates the `RoyaltySplit`. The instruction requires the `DerivativeLink`, `LicenseGrant`, and `RoyaltyPolicy` accounts as additional inputs. If the IP is not a derivative (no `DerivativeLink` exists), no `RoyaltySplit` is created.

During settlement, the system walks the RoyaltySplit chain for each IP:

1. IP earns gross revenue from playback
2. If IP has a RoyaltySplit as derivative → deduct `share_bps` and credit origin's IpTreasury
3. Origin may itself have a RoyaltySplit → continue upward
4. Chain depth is bounded by `MAX_ROYALTY_CHAIN_DEPTH` (hardcoded constant = **3**)

---

## 4. Instruction Set

### Platform Management

| Instruction            | Accounts Mutated                 | Authority          |
| ---------------------- | -------------------------------- | ------------------ |
| initialize_platform    | PlatformConfig, PlatformTreasury | Initial deployer   |
| update_platform_config | PlatformConfig                   | config.authority   |
| withdraw_platform_fees | Token accounts                   | treasury.authority |

### IP Onboarding (on kollect)

| Instruction      | Accounts Mutated                                   | Authority                                        |
| ---------------- | -------------------------------------------------- | ------------------------------------------------ |
| onboard_ip       | IpConfig, IpTreasury, (RoyaltySplit if derivative) | Entity controller(s) — cross-program read Entity |
| update_ip_config | IpConfig                                           | Entity controller(s) — cross-program read Entity |
| deactivate_ip    | IpConfig                                           | Entity controller(s) — cross-program read Entity |

### Entity Treasury

| Instruction                | Accounts Mutated | Authority                                        |
| -------------------------- | ---------------- | ------------------------------------------------ |
| initialize_entity_treasury | EntityTreasury   | Entity controller(s) — cross-program read Entity |
| withdraw_entity_earnings   | Token accounts   | treasury.authority                               |

### Venue Management

| Instruction             | Accounts Mutated | Authority          |
| ----------------------- | ---------------- | ------------------ |
| register_venue          | VenueAccount     | platform authority |
| update_venue            | VenueAccount     | venue.authority    |
| update_venue_multiplier | VenueAccount     | platform authority |
| deactivate_venue        | VenueAccount     | platform authority |

### Licensing

| Instruction             | Accounts Mutated                                            | Authority                                        |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| create_license_template | LicenseTemplate, License                                    | Entity controller(s) — cross-program read Entity |
| update_license_template | LicenseTemplate                                             | Entity controller(s) — cross-program read Entity |
| create_royalty_policy   | RoyaltyPolicy                                               | Entity controller(s) — cross-program read Entity |
| update_royalty_policy   | RoyaltyPolicy                                               | Entity controller(s) — cross-program read Entity |
| purchase_license        | LicenseGrant, LicenseTemplate, IpTreasury, PlatformTreasury | Grantee Entity controller(s)                     |

### Playback & Settlement

| Instruction     | Accounts Mutated                                                                        | Authority          |
| --------------- | --------------------------------------------------------------------------------------- | ------------------ |
| submit_playback | PlaybackCommitment, VenueAccount                                                        | platform authority |
| settle_period   | SettlementRecord, PlaybackCommitments, IpTreasury(s), RoyaltySplit(s), PlatformTreasury | platform authority |

---

## 5. Pricing Model

Effective price per play for a track at a venue:

```
effective_price = (ip_config.price_per_play_override OR platform.base_price_per_play)
                  * venue.multiplier_bps / 10_000
```

Settlement amount per IP from `IpDistribution` instruction data:

```
gross = distribution.amount  (pre-computed off-chain per IP)
platform_fee = gross * platform.platform_fee_bps / 10_000
net_to_ip = gross - platform_fee
```

Royalty split (if IP is a derivative):

```
royalty_to_origin = net_to_ip * royalty_split.share_bps / 10_000
net_to_derivative_owner = net_to_ip - royalty_to_origin
```

The royalty chain walks upward (max `MAX_ROYALTY_CHAIN_DEPTH` = 3 levels): if origin is also a derivative, its share is further split.

License purchase fee:

```
gross_license = license_template.price
platform_cut = gross_license * platform.platform_fee_bps / 10_000
net_to_ip_owner = gross_license - platform_cut
```

Platform takes `platform_fee_bps` on **both** playback settlement and license purchases (platform sponsors gas fees).

All arithmetic MUST use checked operations (`checked_mul`, `checked_div`, `checked_add`, `checked_sub`).

---

## 6. Settlement Flow

1. **Daily**: Off-chain sniffing device reports playback data to platform backend → platform backend hashes `{ track, count }[]` → platform authority calls `submit_playback` with commitment hash + total play count
2. **Weekly**: Platform authority calls `settle_period` for a venue + week range
   - Passes `Vec<IpDistribution>` as instruction data (per-IP breakdown)
   - Validates all referenced IPs are onboarded and active
   - Validates `sum(distributions.amount)` matches expected total from commitments
   - Computes merkle root of included commitment hashes
   - For each IP: deducts platform fee, checks RoyaltySplit chain, distributes royalties bottom-to-top
   - Credits net amounts to each IpTreasury
   - Marks PlaybackCommitments as settled
   - Creates SettlementRecord

---

## 7. Venue Multiplier Rules

The `multiplier_bps` field adjusts pricing based on venue characteristics.
Only the **platform authority** can set/override this via `update_venue_multiplier` (venue evaluator determines the multiplier off-chain).
`10_000` = 1.0x (no adjustment). Range: 1–65_535 (0.01% to 6.55x).

Suggested defaults (not enforced on-chain):

- Bar: 10_000 (1.0x)
- Club: 15_000 (1.5x)
- Restaurant: 8_000 (0.8x)
- Retail: 5_000 (0.5x)
- Arena: 25_000 (2.5x)
- Festival: 30_000 (3.0x)

---

## 8. License & Royalty Flow

### Creating a License

1. Entity onboards their IP via `onboard_ip`
2. Entity creates a `LicenseTemplate` with terms (price, duration, max grants)
3. Entity creates a `RoyaltyPolicy` attached to the template (revenue share %, allowed derivative types)

### Purchasing a License

1. Another Entity calls `purchase_license` referencing a `LicenseTemplate`
2. Payment (if price > 0):
   - Platform takes `platform_fee_bps` cut → transfers to `PlatformTreasury` token account
   - Remainder transfers to origin IP's `IpTreasury` token account
3. A thin `LicenseGrant` is created (matching `ip_core`'s `LicenseGrantData` exactly)
   - `LicenseGrant.license` = `License` PDA (the thin account, not the template)
   - `LicenseGrant.expiration` = if template.grant_duration > 0: `now + grant_duration`, else `0`
4. `LicenseTemplate.current_grants` increments (bounded by `max_grants`)
5. `LicensePurchased` event emits `price_paid` and `platform_fee` (not stored on grant account)

### Creating a Derivative

1. Grantee uses `ip_core::create_derivative_link` passing **two accounts**:
   - `license` = the `License` PDA (thin account, owned by `kollect`)
   - `license_grant` = the `LicenseGrant` PDA (thin account, owned by `kollect`)
   - Caller passes `kollect`'s program ID as the `license_program_id` argument
2. `ip_core` validates (all pass because the thin accounts match exactly):
   - Both accounts owned by `kollect::ID`
   - `LicenseGrant.license == license.key()`
   - `License.origin_ip == parent_ip.key()`
   - `License.derivatives_allowed == true`
   - `LicenseGrant.expiration` is 0 or in the future
   - `LicenseGrant.grantee == child_owner_entity.key()`
3. Grantee onboards the derivative IP on kollect via `onboard_ip`
   - If `DerivativeLink` exists in `ip_core` for this IP, `onboard_ip` **automatically creates a `RoyaltySplit`**
   - Requires `DerivativeLink`, `LicenseGrant`, `License`, and `RoyaltyPolicy` as additional inputs
   - `share_bps` is snapshotted from the `RoyaltyPolicy` at onboarding time

### Royalty Distribution (Bottom-to-Top)

During settlement, for each IP in the `IpDistribution` list:

1. If the IP has a `RoyaltySplit` (it's a derivative):
   - Deduct `share_bps` from its net earnings
   - Credit the origin IP's `IpTreasury`
   - Recursively check if origin also has a `RoyaltySplit`
2. Remaining net goes to the IP's own `IpTreasury`
3. `IpTreasury` funds can be withdrawn to the `EntityTreasury` by the entity

---

## 9. Design Constraints

- All accounts MUST be PDA-derived. No randomness, no auto-increment IDs.
- `current_grants` on LicenseTemplate is a bounded counter (not used for PDA derivation).
- All PDAs derived from `kollect` program ID (never `ip_core`'s).
- Fixed-size fields preferred. No unbounded `Vec` growth.
- `IpDistribution` in `settle_period` is instruction data (bounded by transaction size limits).
- No account realloc unless strictly required.
- All timestamps use `Clock::get()?.unix_timestamp`.
- All fee/price/royalty arithmetic uses checked operations.
- `ip_core` accounts are READ-ONLY inputs — never CPI-mutate them.
- Entity multisig: always cross-program read `Entity` from `ip_core` for current controllers/threshold. Never cache.
- Settlement period: weekly (hardcoded for POC).
- `MAX_ROYALTY_CHAIN_DEPTH` = 3 (hardcoded constant). Settlement will not walk royalty chains deeper than 3 levels.
- Platform fee (`platform_fee_bps`) applies to both playback settlements and license purchases.
- `RoyaltySplit` is auto-created during `onboard_ip` when a `DerivativeLink` exists — no separate instruction.
- `License` and `LicenseGrant` are thin interface accounts matching `ip_core`'s deserialization exactly (`try_from_slice` rejects trailing bytes).
- No governance mechanisms in the program itself.

---

## 10. Error Model

Define errors specific to `kollect`:

- PlatformAlreadyInitialized
- Unauthorized
- InvalidAuthority
- IpNotRegistered (ip_core IpAccount doesn't exist or wrong owner)
- IpAlreadyOnboarded (IpConfig already exists)
- IpNotActive
- IpNotOnboarded (IpConfig doesn't exist)
- IpOwnerMismatch (entity doesn't own the IP in ip_core)
- InvalidIpCoreAccount (owner != ip_core program)
- VenueAlreadyRegistered
- VenueNotActive
- InvalidVenueType
- InvalidCapacity
- InvalidOperatingHours
- InvalidMultiplier
- PlaybackAlreadySubmitted (duplicate day commitment for venue)
- InvalidDayTimestamp (not aligned to UTC midnight)
- SettlementPeriodNotEnded
- CommitmentAlreadySettled
- NoCommitmentsToSettle
- InvalidSettlementPeriod
- DistributionAmountMismatch (sum of IpDistribution amounts != expected total)
- ArithmeticOverflow
- EntityTreasuryNotInitialized
- InsufficientSignatures
- LicenseTemplateNotActive
- MaxGrantsReached
- LicenseAlreadyGranted (duplicate grant for same template + entity)
- LicenseExpired
- InvalidLicenseTemplate (IP not onboarded or wrong owner)
- RoyaltyPolicyAlreadyExists
- RoyaltySplitAlreadyExists
- InvalidDerivativeLink (no DerivativeLink in ip_core)
- RoyaltyChainTooDeep (exceeds MAX_ROYALTY_CHAIN_DEPTH = 3)
- InsufficientPayment (license purchase price not met)
- InvalidCurrency (wrong SPL mint for payment)

---

## 11. Event Model

Emit events for all state changes:

### Platform

- **PlatformInitialized**: config, authority, base_price_per_play, platform_fee_bps
- **PlatformConfigUpdated**: config, changed fields
- **PlatformFeesWithdrawn**: treasury, amount, destination

### IP Onboarding

- **IpOnboarded**: ip_config, ip_account, owner_entity, price_override, is_derivative, onboarded_at
- **IpConfigUpdated**: ip_config, changed fields
- **IpDeactivated**: ip_config, deactivated_at

### Entity Treasury

- **EntityTreasuryInitialized**: entity_treasury, entity, authority
- **EntityEarningsWithdrawn**: entity_treasury, amount, destination

### Venue

- **VenueRegistered**: venue, venue_id, authority, venue_type, capacity, registered_at
- **VenueUpdated**: venue, changed fields
- **VenueMultiplierUpdated**: venue, old_multiplier, new_multiplier, updated_by
- **VenueDeactivated**: venue, deactivated_at

### Licensing

- **LicenseTemplateCreated**: template, license, ip_account, creator_entity, template_name, price, max_grants
- **LicenseTemplateUpdated**: template, changed fields
- **RoyaltyPolicyCreated**: policy, template, derivative_share_bps, allow_remix, allow_cover, allow_sample
- **RoyaltyPolicyUpdated**: policy, changed fields
- **LicensePurchased**: grant, template, grantee_entity, origin_ip, price_paid, platform_fee, net_to_owner, expiration
- **RoyaltySplitCreated**: split, derivative_ip, origin_ip, share_bps (emitted during onboard_ip when derivative)

### Playback & Settlement

- **PlaybackSubmitted**: commitment, venue, day_timestamp, commitment_hash, total_plays
- **PeriodSettled**: settlement, venue, period_start, period_end, total_plays, total_amount, platform_fee, ip_count
- **RoyaltyDistributed**: from_ip, to_ip, amount, split

---

## 12. Folder Structure

```
programs/kollect/
├── Cargo.toml
└── src/
    ├── lib.rs
    ├── error.rs
    ├── events.rs
    ├── constants/
    │   └── mod.rs
    ├── state/
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
    ├── instructions/
    │   ├── mod.rs
    │   ├── platform/
    │   │   ├── mod.rs
    │   │   ├── initialize_platform.rs
    │   │   ├── update_platform_config.rs
    │   │   └── withdraw_platform_fees.rs
    │   ├── ip/
    │   │   ├── mod.rs
    │   │   ├── onboard_ip.rs
    │   │   ├── update_ip_config.rs
    │   │   └── deactivate_ip.rs
    │   ├── entity/
    │   │   ├── mod.rs
    │   │   ├── initialize_entity_treasury.rs
    │   │   └── withdraw_entity_earnings.rs
    │   ├── venue/
    │   │   ├── mod.rs
    │   │   ├── register_venue.rs
    │   │   ├── update_venue.rs
    │   │   ├── update_venue_multiplier.rs
    │   │   └── deactivate_venue.rs
    │   ├── licensing/
    │   │   ├── mod.rs
    │   │   ├── create_license_template.rs
    │   │   ├── update_license_template.rs
    │   │   ├── create_royalty_policy.rs
    │   │   ├── update_royalty_policy.rs
    │   │   └── purchase_license.rs
    │   └── playback/
    │       ├── mod.rs
    │       ├── submit_playback.rs
    │       └── settle_period.rs
    └── utils/
        ├── mod.rs
        ├── seeds.rs
        └── validation.rs
```

---

## 13. Testing Guidelines

- Each instruction needs a corresponding test in `tests/`
- Test files follow the pattern `XX_feature.test.ts`
- Validate all PDA derivations match seeds spec
- Test entity multisig threshold enforcement via cross-program read
- Test settlement math with edge cases (overflow, zero plays, rounding)
- Test royalty bottom-to-top chain distribution (2-3 levels deep)
- Test cross-program account validation (ip_core ownership checks)
- Test deactivation prevents further operations
- Test duplicate commitment rejection (same venue + same day)
- Test license purchase flow end-to-end (template → grant → derivative link → onboard_ip auto-creates royalty split)
- Test platform fee deduction on license purchase
- Test max_grants enforcement
- Test license expiration
- Test royalty chain depth capped at 3 levels
- Test IpDistribution validation in settle_period (sum check, onboarding check)
- Test venue multiplier override by platform authority only
