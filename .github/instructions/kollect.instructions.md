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

**PIL-based licensing**: `LicenseTemplate` accounts are global, reusable term sheets (Programmable IP License) that anyone can create. Templates are identified by auto-incrementing IDs managed by a `TemplateConfig` singleton counter. `License` accounts attach a template to a specific IP with business terms (price, grants, duration, derivative rev share). `LicenseGrant` accounts are per-entity proofs of purchase.

**CPI validation**: `ip_core`'s `create_derivative_link` invokes `kollect::validate_derivative_grant` via CPI, passing `[license_grant, license, parent_ip, grantee_entity]` as remaining accounts. `ip_core` delegates validation entirely to the license program — no thin interface or `try_from_slice` deserialization is needed.

---

## 2. Cross-Program Integration with ip_core

When an instruction requires an `ip_core` account:

- Pass it as an `UncheckedAccount` or typed `Account<T>` with `owner = ip_core::ID` constraint
- Validate ownership: `account.owner == ip_core::ID`
- Deserialize manually or use Anchor's `Account<>` with `owner` constraint
- NEVER use CPI to mutate `ip_core` state

**Entity controller validation**: Always perform a cross-program read of the `Entity` account to get the current `controller`. Never cache or replicate the controller — it may change at any time in `ip_core`. For multisig functionality, the controller can be set to an external multisig PDA (e.g., Squads).

Key `ip_core` references:

- `Entity` – PDA seeds `["entity", creator, &index.to_le_bytes()]` — fields: `controller: Pubkey`
- `IpAccount` – PDA seeds `["ip", registrant_entity, content_hash]` — fields: `current_owner_entity`
- `DerivativeLink` – PDA seeds `["derivative", parent_ip, child_ip]` — fields: `license`, `parent_ip`, `child_ip`
- `ip_core` program ID: `CSSfTXVfCUmvZCEjPZxFne5EPewzTGCyYAybLNihLQM1`

---

## 3. Account Specifications

### 3.1 PlatformConfig (Singleton)

Platform-wide configuration. One instance per deployment.

**PDA Seeds:** `["platform_config"]`

| Field                 | Type   | Mutability | Description                                                                |
| --------------------- | ------ | ---------- | -------------------------------------------------------------------------- |
| authority             | Pubkey | mutable    | Platform admin, can update config and submit playback                      |
| platform_fee_bps      | u16    | mutable    | Platform fee in basis points (e.g. 500 = 5%)                               |
| base_price_per_play   | u64    | mutable    | Default price per play in lamports/tokens                                  |
| currency              | Pubkey | immutable  | SPL token mint for all on-chain payments (license purchases + settlements) |
| max_derivatives_depth | u8     | mutable    | Max royalty chain depth during settlement                                  |
| max_license_types     | u16    | mutable    | Max license templates per IP on this platform                              |
| treasury              | Pubkey | mutable    | Platform treasury PDA reference                                            |
| bump                  | u8     | immutable  | PDA bump                                                                   |

### 3.2 PlatformTreasury

Platform-level fee collection.

**PDA Seeds:** `["platform_treasury"]`

| Field     | Type   | Mutability | Description                 |
| --------- | ------ | ---------- | --------------------------- |
| authority | Pubkey | mutable    | Can withdraw platform fees  |
| config    | Pubkey | immutable  | Reference to PlatformConfig |
| bump      | u8     | immutable  | PDA bump                    |

An Associated Token Account (ATA) for `config.currency` is created during `initialize_platform`.

### 3.3 IpConfig

Per-IP onboarding on the kollect platform. Not all `ip_core` IPs are registered here — only those approved by the **platform authority** (off-chain review gate). The platform authority calls `onboard_ip`.

**PDA Seeds:** `["ip_config", ip_account.key()]`

| Field                   | Type        | Mutability | Description                                      |
| ----------------------- | ----------- | ---------- | ------------------------------------------------ |
| ip_account              | Pubkey      | immutable  | Reference to ip_core IpAccount                   |
| owner_entity            | Pubkey      | mutable    | Current owning Entity (synced from ip_core)      |
| price_per_play_override | Option<u64> | mutable    | Overrides platform base_price_per_play if Some   |
| is_active               | bool        | mutable    | Whether this IP is actively licensed on platform |
| license_template_count  | u16         | mutable    | Number of license templates created for this IP  |
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

An Associated Token Account (ATA) for `config.currency` is created during `initialize_entity_treasury`.

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

An Associated Token Account (ATA) for `config.currency` is created during `onboard_ip`.

### 3.6 VenueAccount

Registered venue that plays music tracked by the platform.

**PDA Seeds:** `["venue", &venue_id.to_le_bytes()]`

`venue_id` is a `u64` assigned by the off-chain platform. Deterministic from the off-chain venue record.

| Field             | Type     | Mutability | Description                                          |
| ----------------- | -------- | ---------- | ---------------------------------------------------- |
| venue_id          | u64      | immutable  | Off-chain platform venue identifier                  |
| authority         | Pubkey   | mutable    | Venue operator wallet                                |
| cid               | [u8; 96] | mutable    | Content identifier (IPFS CID or similar, fixed-size) |
| multiplier_bps    | u16      | mutable    | Venue price multiplier in bps (10000 = 1x)           |
| is_active         | bool     | mutable    | Whether venue is active on the platform              |
| total_commitments | u64      | mutable    | Total playback commitments submitted                 |
| registered_at     | i64      | immutable  | Unix timestamp                                       |
| updated_at        | i64      | mutable    | Unix timestamp                                       |
| bump              | u8       | immutable  | PDA bump                                             |

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

Record of a settlement batch for a venue. Multiple partial settlements are allowed per period via unique `settled_at` timestamps.

**PDA Seeds:** `["settlement", venue.key(), &period_start.to_le_bytes(), &settled_at.to_le_bytes()]`

`settled_at` is client-supplied and validated to be within 30 seconds of the on-chain clock. This enables multiple partial settlements for the same `period_start`.

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

### 3.9 TemplateConfig (Singleton)

Auto-incrementing counter for global license template IDs. Initialized alongside `PlatformConfig` during `initialize_platform`.

**PDA Seeds:** `["template_config"]`

| Field          | Type | Mutability | Description                            |
| -------------- | ---- | ---------- | -------------------------------------- |
| template_count | u64  | mutable    | Next template ID (monotonic increment) |
| bump           | u8   | immutable  | PDA bump                               |

Size: 8 (discriminator) + 8 + 1 = **17 bytes**.

### 3.10 LicenseTemplate (Global PIL)

Global, reusable license terms (Programmable IP License). Anyone can create a template — no IP or entity ownership required. Terms are immutable after creation; only `is_active` may be toggled to retire the template.

**PDA Seeds:** `["license_template", &template_id.to_le_bytes()]`

`template_id` is a `u64` assigned by `TemplateConfig.template_count` at creation time.

| Field                    | Type     | Mutability | Description                                           |
| ------------------------ | -------- | ---------- | ----------------------------------------------------- |
| template_id              | u64      | immutable  | Auto-assigned sequential ID                           |
| creator                  | Pubkey   | immutable  | Wallet that created the template (signer)             |
| template_name            | [u8; 64] | immutable  | Human-readable label (right-padded)                   |
| transferable             | bool     | immutable  | Whether license grants are transferable               |
| derivatives_allowed      | bool     | immutable  | Whether derivatives can be created                    |
| derivatives_reciprocal   | bool     | immutable  | Derivatives must use the same template                |
| derivatives_approval     | bool     | immutable  | Derivatives require IP owner approval                 |
| commercial_use           | bool     | immutable  | Commercial use of licensed IP allowed                 |
| commercial_attribution   | bool     | immutable  | Attribution required for commercial use               |
| commercial_rev_share_bps | u16      | immutable  | Min commercial revenue share (bps, floor for License) |
| derivative_rev_share_bps | u16      | immutable  | Min derivative revenue share (bps, floor for License) |
| uri                      | [u8; 96] | immutable  | Off-chain metadata URI (IPFS CID, right-padded)       |
| is_active                | bool     | mutable    | Creator can deactivate to prevent new Licenses        |
| created_at               | i64      | immutable  | Unix timestamp                                        |
| bump                     | u8       | immutable  | PDA bump                                              |

Size: 8 + 8 + 32 + 64 + 6×1 + 2 + 2 + 96 + 1 + 8 + 1 = **228 bytes**.

The `commercial_rev_share_bps` and `derivative_rev_share_bps` on the template are **minimum floors**: the per-IP `License` must set values ≥ these when attaching the template.

### 3.11 License (Per-IP Attachment)

Business terms attaching a `LicenseTemplate` to a specific IP. Created by the IP's entity controller. This is the account `ip_core` receives during derivative validation.

**PDA Seeds:** `["license", ip_account.key(), license_template.key()]`

| Field                    | Type   | Mutability | Description                                    |
| ------------------------ | ------ | ---------- | ---------------------------------------------- |
| ip_account               | Pubkey | immutable  | The IP this license covers (ip_core IpAccount) |
| ip_config                | Pubkey | immutable  | Must be onboarded on kollect                   |
| license_template         | Pubkey | immutable  | Reference to the global LicenseTemplate        |
| owner_entity             | Pubkey | immutable  | Entity that created this license (IP owner)    |
| price                    | u64    | mutable    | Price to purchase a grant (0 = free)           |
| max_grants               | u16    | immutable  | Max grants issuable (0 = unlimited)            |
| current_grants           | u16    | mutable    | Number of grants currently issued              |
| grant_duration           | i64    | mutable    | Duration in seconds (0 = perpetual)            |
| derivative_rev_share_bps | u16    | mutable    | Derivative revenue share (≥ template min)      |
| is_active                | bool   | mutable    | Whether new grants can be purchased            |
| created_at               | i64    | immutable  | Unix timestamp                                 |
| updated_at               | i64    | mutable    | Unix timestamp                                 |
| bump                     | u8     | immutable  | PDA bump                                       |

Size: 8 + 32 + 32 + 32 + 32 + 8 + 2 + 2 + 8 + 2 + 1 + 8 + 8 + 1 = **176 bytes**.

`current_grants` is a bounded counter (capped by `max_grants`). It is NOT used for PDA derivation.

All license purchase payments use `PlatformConfig.currency` — the license does not carry its own currency.

### 3.12 LicenseGrant

Per-entity proof of license purchase. Created during `purchase_license`.

**PDA Seeds:** `["license_grant", license.key(), grantee_entity.key()]`

One grant per license per entity.

| Field      | Type   | Mutability | Description                                             |
| ---------- | ------ | ---------- | ------------------------------------------------------- |
| license    | Pubkey | immutable  | License PDA key                                         |
| grantee    | Pubkey | immutable  | Grantee Entity key                                      |
| granted_at | i64    | immutable  | Unix timestamp                                          |
| expiration | i64    | immutable  | 0 = no expiration, computed from license.grant_duration |
| price_paid | u64    | immutable  | Gross price paid at time of purchase                    |
| bump       | u8     | immutable  | PDA bump                                                |

Size: 8 + 32 + 32 + 8 + 8 + 8 + 1 = **97 bytes**.

### 3.13 RoyaltySplit

Records the royalty distribution link between a derivative IP and its origin IP. Created when a derivative IP is onboarded on kollect and has a `DerivativeLink` in `ip_core`.

Royalties flow **bottom-to-top**: when a derivative earns revenue, a share goes to the origin, which may itself be a derivative owing a share upward.

**PDA Seeds:** `["royalty_split", derivative_ip.key(), origin_ip.key()]`

| Field             | Type   | Mutability | Description                                      |
| ----------------- | ------ | ---------- | ------------------------------------------------ |
| derivative_ip     | Pubkey | immutable  | The derivative IpAccount (ip_core)               |
| origin_ip         | Pubkey | immutable  | The parent/origin IpAccount (ip_core)            |
| license_grant     | Pubkey | immutable  | LicenseGrant under which derivative was created  |
| license           | Pubkey | immutable  | License governing the derivative terms           |
| share_bps         | u16    | immutable  | Snapshot of derivative_rev_share_bps at creation |
| total_distributed | u64    | mutable    | Cumulative amount distributed to origin          |
| created_at        | i64    | immutable  | Unix timestamp                                   |
| bump              | u8     | immutable  | PDA bump                                         |

**Auto-created during `onboard_ip`**: When onboarding an IP that has a `DerivativeLink` in `ip_core`, the `onboard_ip` instruction automatically creates the `RoyaltySplit`. The instruction requires the `DerivativeLink`, `LicenseGrant`, `License`, and `RoyaltySplit` accounts as remaining accounts (4 accounts). If the IP is not a derivative (no `DerivativeLink` exists), no `RoyaltySplit` is created.

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
| onboard_ip       | IpConfig, IpTreasury, (RoyaltySplit if derivative) | platform authority                               |
| update_ip_config | IpConfig                                           | Entity controller(s) — cross-program read Entity |
| deactivate_ip    | IpConfig                                           | platform authority                               |
| reactivate_ip    | IpConfig                                           | platform authority                               |

### Entity Treasury

| Instruction                | Accounts Mutated                           | Authority                                        |
| -------------------------- | ------------------------------------------ | ------------------------------------------------ |
| initialize_entity_treasury | EntityTreasury                             | Entity controller(s) — cross-program read Entity |
| withdraw_entity_earnings   | Token accounts                             | treasury.authority                               |
| withdraw_ip_treasury       | IpTreasury, EntityTreasury, Token accounts | Entity controller(s) — cross-program read Entity |

### Venue Management

| Instruction             | Accounts Mutated | Authority          |
| ----------------------- | ---------------- | ------------------ |
| register_venue          | VenueAccount     | platform authority |
| update_venue            | VenueAccount     | venue.authority    |
| update_venue_multiplier | VenueAccount     | platform authority |
| deactivate_venue        | VenueAccount     | platform authority |
| reactivate_venue        | VenueAccount     | platform authority |

### Licensing

| Instruction               | Accounts Mutated                                    | Authority                                        |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| create_license_template   | LicenseTemplate, TemplateConfig                     | Any signer (global, no entity required)          |
| update_license_template   | LicenseTemplate                                     | Template creator wallet                          |
| create_license            | License, IpConfig                                   | Entity controller(s) — cross-program read Entity |
| update_license            | License                                             | Entity controller(s) — cross-program read Entity |
| purchase_license          | LicenseGrant, License, IpTreasury, PlatformTreasury | Grantee Entity controller(s)                     |
| validate_derivative_grant | — (read-only CPI handler)                           | ip_core via CPI                                  |

### Playback & Settlement

| Instruction     | Accounts Mutated                                                                        | Authority                                               |
| --------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| submit_playback | PlaybackCommitment, VenueAccount                                                        | platform authority                                      |
| settle_period   | SettlementRecord, PlaybackCommitments, IpTreasury(s), RoyaltySplit(s), PlatformTreasury | platform authority + venue authority (co-signer, payer) |

---

## 5. Pricing Model

Effective price per play for a track at a venue:

```
effective_price = (ip_config.price_per_play_override OR platform.base_price_per_play)
                  * venue.multiplier_bps / 10_000
```

Settlement amount per IP from `IpDistribution` instruction data:

```
gross = distribution.amount  (pre-computed off-chain per IP, before platform fee)
platform_fee = sum(all distributions.amount) * platform.platform_fee_bps / 10_000  (computed once on the total)
net_to_ip = distribution.amount - (distribution.amount's proportional share of platform_fee)
```

Play count validation:

```
sum(distributions.plays) == sum(commitments.total_plays)
total_bill = sum(distributions.amount) + platform_fee  (venue’s total payment)
```

Royalty split (if IP is a derivative):

```
royalty_to_origin = net_to_ip * royalty_split.share_bps / 10_000
net_to_derivative_owner = net_to_ip - royalty_to_origin
```

The royalty chain walks upward (max `MAX_ROYALTY_CHAIN_DEPTH` = 3 levels): if origin is also a derivative, its share is further split.

License purchase fee:

```
gross_license = license.price
platform_cut = gross_license * platform.platform_fee_bps / 10_000
net_to_ip_owner = gross_license - platform_cut
```

Platform takes `platform_fee_bps` on **both** playback settlement and license purchases (platform sponsors gas fees).

All arithmetic MUST use checked operations (`checked_mul`, `checked_div`, `checked_add`, `checked_sub`).

---

## 6. Settlement Flow

1. **Daily**: Off-chain sniffing device reports playback data to platform backend → platform backend hashes `{ track, count }[]` → platform authority calls `submit_playback` with commitment hash + total play count
2. **Settlement** (anytime during or after the week): Platform authority and venue authority co-sign `settle_period` for a venue + period
   - **Dual-signer model**: Platform authority provides distribution data; venue authority funds the settlement
   - Passes `period_start: i64`, `settled_at: i64`, and `Vec<IpDistribution>` as instruction data
   - `settled_at` is client-supplied, validated within 30 seconds of on-chain clock
   - Multiple partial settlements per period are allowed (each creates a unique `SettlementRecord` via `settled_at` in PDA seeds)
   - No `period_end` check — venues settle week-to-date at any time
   - Validates `sum(distributions.plays) == sum(commitments.total_plays)`
   - Computes merkle root of included commitment hashes
   - **Token flow**:
     a. Platform fee: single transfer from venue’s token account → `PlatformTreasury` ATA
     b. Per-IP distribution: for each IP in distributions, walk the RoyaltySplit chain (up to `MAX_ROYALTY_CHAIN_DEPTH`=3):
     - If IP is a derivative: deduct `share_bps` and transfer royalties to origin IP’s `IpTreasury` ATA (recurse upward)
     - Transfer remaining net to the IP’s own `IpTreasury` ATA
       c. Update counters: `IpTreasury.total_earned`, `RoyaltySplit.total_distributed`, `PlatformTreasury` balance
   - Marks PlaybackCommitments as settled
   - Creates SettlementRecord
   - Deactivated IPs may still receive settlement (revenue earned while active is distributable)

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

1. Any wallet creates a `LicenseTemplate` with PIL terms (derivatives, commercial use, rev share floors, etc.) — no IP or entity required
2. Platform authority onboards an IP via `onboard_ip` (after off-chain review)
3. Entity controller creates a `License` attaching a `LicenseTemplate` to their IP, setting price, grants, duration, and `derivative_rev_share_bps` (≥ template’s floor)

### Purchasing a License

1. Another Entity calls `purchase_license` referencing a `License`
2. Payment (if price > 0):
   - Platform takes `platform_fee_bps` cut → transfers to `PlatformTreasury` token account
   - Remainder transfers to origin IP's `IpTreasury` token account (updates `IpTreasury.total_earned`)
3. A `LicenseGrant` is created:
   - `LicenseGrant.license` = `License` PDA key
   - `LicenseGrant.expiration` = if license.grant_duration > 0: `now + grant_duration`, else `0`
   - `LicenseGrant.price_paid` = gross price at time of purchase
4. `License.current_grants` increments (bounded by `max_grants`)
5. `LicensePurchased` event emits `price_paid` and `platform_fee`

### Creating a Derivative

1. Grantee uses `ip_core::create_derivative_link` passing:
   - `license_program_id` = `kollect`'s program ID (instruction argument)
   - `license_grant` and `license` as accounts
2. `ip_core` invokes `kollect::validate_derivative_grant` via CPI with `[license_grant, license, parent_ip, grantee_entity]`
3. `kollect` validates: grant not expired, license active, derivatives allowed on the template, grantee matches
4. Grantee onboards the derivative IP on kollect via `onboard_ip` (platform authority initiates after review)
   - If `DerivativeLink` exists in `ip_core` for this IP, `onboard_ip` **automatically creates a `RoyaltySplit`**
   - Requires `DerivativeLink`, `LicenseGrant`, `License`, and `RoyaltySplit` as remaining accounts (4 accounts)
   - `share_bps` is snapshotted from the `License.derivative_rev_share_bps` at onboarding time
   - Caller passes `kollect`'s program ID as the `license_program_id` argument
5. `ip_core` invokes `kollect::validate_derivative_grant` via CPI:
   - `kollect` validates: grant not expired, license active, derivatives allowed on template, grantee matches entity
6. Grantee onboards the derivative IP on kollect via `onboard_ip` (platform authority initiates after review)
   - If `DerivativeLink` exists in `ip_core` for this IP, `onboard_ip` **automatically creates a `RoyaltySplit`**
   - Requires `DerivativeLink`, `LicenseGrant`, `License`, and `RoyaltySplit` as remaining accounts (4 accounts)
   - `share_bps` is snapshotted from the `License.derivative_rev_share_bps` at onboarding time

### Royalty Distribution (Bottom-to-Top)

During settlement, for each IP in the `IpDistribution` list:

1. If the IP has a `RoyaltySplit` (it's a derivative):
   - Deduct `share_bps` from its net earnings
   - Credit the origin IP's `IpTreasury` (updates `IpTreasury.total_earned` and `RoyaltySplit.total_distributed`)
   - Recursively check if origin also has a `RoyaltySplit`
2. Remaining net goes to the IP's own `IpTreasury`
3. `IpTreasury` funds can be withdrawn to the `EntityTreasury` by the entity controller via `withdraw_ip_treasury`

---

## 9. Design Constraints

- All accounts MUST be PDA-derived. No randomness, no nonce-based IDs.
- `LicenseTemplate` uses auto-incrementing IDs via `TemplateConfig` singleton counter.
- `current_grants` on License is a bounded counter (not used for PDA derivation).
- All PDAs derived from `kollect` program ID (never `ip_core`'s).
- Fixed-size fields preferred. No unbounded `Vec` growth.
- `IpDistribution` in `settle_period` is instruction data (bounded by transaction size limits).
- No account realloc unless strictly required.
- All timestamps use `Clock::get()?.unix_timestamp`.
- All fee/price/royalty arithmetic uses checked operations.
- `ip_core` accounts are READ-ONLY inputs — never CPI-mutate them.
- Entity controller: always cross-program read `Entity` from `ip_core` for current `controller`. Never cache. For multisig, the controller can be set to an external multisig PDA (e.g., Squads).
- Settlement period: weekly boundaries (hardcoded for POC). Payment can occur anytime — no `period_end` wait required. Multiple partial settlements per period allowed.
- `MAX_ROYALTY_CHAIN_DEPTH` = 3 (hardcoded constant). Settlement will not walk royalty chains deeper than 3 levels.
- Platform fee (`platform_fee_bps`) applies to both playback settlements and license purchases (platform sponsors gas fees).
- Single currency for POC: all on-chain payments (license purchases + settlements) use `PlatformConfig.currency`.
- Deactivated IPs can still receive settlement — revenue earned while active is distributable.
- Associated Token Accounts (ATAs) for the platform currency are created at init time: `initialize_platform`, `initialize_entity_treasury`, `onboard_ip`.
- `onboard_ip` and `deactivate_ip` are admin-gated (platform authority only). `update_ip_config` remains entity-controller-gated.
- `RoyaltySplit` is auto-created during `onboard_ip` when a `DerivativeLink` exists — no separate instruction.
- `License` and `LicenseGrant` accounts are validated by `kollect::validate_derivative_grant` via CPI from `ip_core` — no thin interface or `try_from_slice` deserialization.
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
- CommitmentAlreadySettled
- NoCommitmentsToSettle
- InvalidSettlementPeriod
- DistributionAmountMismatch (sum of IpDistribution amounts != expected total)
- ArithmeticOverflow
- EntityTreasuryNotInitialized
- InsufficientSignatures
- LicenseTemplateNotActive
- LicenseNotActive
- MaxGrantsReached
- LicenseAlreadyGranted (duplicate grant for same license + entity)
- LicenseExpired
- InvalidLicenseTemplate (template not active or wrong reference)
- RoyaltySplitAlreadyExists
- InvalidDerivativeLink (no DerivativeLink in ip_core)
- RoyaltyChainTooDeep (exceeds MAX_ROYALTY_CHAIN_DEPTH = 3)
- InsufficientPayment (license purchase price not met)
- InvalidCurrency (wrong SPL mint for payment)
- PlayCountMismatch (sum of distributions.plays != sum of commitments.total_plays)
- InvalidSettlementTimestamp (settled_at not within tolerance of on-chain clock)
- InvalidRoyaltySplitPda (royalty split PDA mismatch)
- MaxLicenseTypesReached (IP has reached max_license_types from config)
- InvalidGrantDuration (grant duration value invalid)
- InvalidShareBps (share basis points exceeds 10000 or below template minimum)
- BpsBelowTemplateMinimum (License derivative_rev_share_bps < template floor)
- IpAlreadyActive (reactivating an already active IP)
- VenueAlreadyActive (reactivating an already active venue)
- InsufficientVenueBalance (venue token account has insufficient funds for settlement)
- InvalidCid (empty or invalid content identifier)

---

## 11. Event Model

Emit events for all state changes:

### Platform

- **PlatformInitialized**: config, authority, base_price_per_play, platform_fee_bps
- **PlatformConfigUpdated**: config, authority, base_price_per_play, platform_fee_bps, max_derivatives_depth, max_license_types
- **PlatformFeesWithdrawn**: treasury, amount, destination

### IP Onboarding

- **IpOnboarded**: ip_config, ip_account, owner_entity, price_override, is_derivative, onboarded_at
- **IpConfigUpdated**: ip_config, price_per_play_override, updated_at
- **IpDeactivated**: ip_config, deactivated_at
- **IpReactivated**: ip_config, reactivated_at

### Entity Treasury

- **EntityTreasuryInitialized**: entity_treasury, entity, authority
- **EntityEarningsWithdrawn**: entity_treasury, amount, destination
- **IpTreasuryWithdrawn**: ip_treasury, entity_treasury, amount

### Venue

- **VenueRegistered**: venue, venue_id, authority, cid, registered_at
- **VenueUpdated**: venue, cid, updated_at
- **VenueMultiplierUpdated**: venue, old_multiplier, new_multiplier, updated_by
- **VenueDeactivated**: venue, deactivated_at
- **VenueReactivated**: venue, reactivated_at

### Licensing

- **LicenseTemplateCreated**: template, creator, template_name, template_id, derivatives_allowed, commercial_use, derivative_rev_share_bps, commercial_rev_share_bps, uri
- **LicenseTemplateUpdated**: template, is_active, updated_at
- **LicenseCreated**: license, ip_account, license_template, owner_entity, price, max_grants, grant_duration, derivative_rev_share_bps
- **LicenseUpdated**: license, price, grant_duration, is_active, derivative_rev_share_bps, updated_at
- **LicensePurchased**: grant, license, grantee_entity, origin_ip, price_paid, platform_fee, net_to_owner, expiration
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
    │   ├── template_config.rs
    │   ├── ip_config.rs
    │   ├── ip_treasury.rs
    │   ├── entity_treasury.rs
    │   ├── venue_account.rs
    │   ├── playback_commitment.rs
    │   ├── settlement_record.rs
    │   ├── license_template.rs
    │   ├── license.rs
    │   ├── license_grant.rs
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
    │   │   ├── withdraw_entity_earnings.rs
    │   │   └── withdraw_ip_treasury.rs
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
    │   │   ├── create_license.rs
    │   │   ├── update_license.rs
    │   │   ├── purchase_license.rs
    │   │   └── validate_derivative_grant.rs
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
- Test entity controller threshold enforcement via cross-program read
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
- Test partial settlement: multiple SettlementRecords with different `settled_at` for same `period_start`
- Test dual-signer settlement (platform authority + venue authority)
- Test deactivated IP can still receive settlement
- Test `withdraw_ip_treasury` flow: entity controller withdraws from IpTreasury to EntityTreasury
- Test ATA creation in `initialize_platform`, `initialize_entity_treasury`, and `onboard_ip`
- Test admin-only `onboard_ip` (entity controller must be rejected)
- Test admin-only `deactivate_ip` (entity controller must be rejected)
- Test partial settlement: multiple SettlementRecords with different `settled_at` for same `period_start`
- Test dual-signer settlement (platform authority + venue authority)
- Test deactivated IP can still receive settlement
- Test `withdraw_ip_treasury` flow: entity controller withdraws from IpTreasury to EntityTreasury
- Test ATA creation in `initialize_platform`, `initialize_entity_treasury`, and `onboard_ip`
- Test admin-only `onboard_ip` (entity controller must be rejected)
- Test admin-only `deactivate_ip` (entity controller must be rejected)
