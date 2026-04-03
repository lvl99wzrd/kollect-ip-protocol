# Kollect – IP Licensing & Royalties

The licensing, playback tracking, and royalty settlement layer for intellectual property on Solana — built on top of the [Mycelium IP Protocol](https://github.com/mycelium-ip/mycelium-ip-protocol).

> **Looking for the Mycelium IP Protocol core registry (`ip_core`)?**
> All documentation for the core IP claim registry — entity management, IP registration, metadata schemas, derivative tracking — lives at **[github.com/mycelium-ip/mycelium-ip-protocol](https://github.com/mycelium-ip/mycelium-ip-protocol)**.

---

## Relationship to ip_core

Kollect is a separate on-chain program that reads `ip_core` accounts (`Entity`, `IpAccount`, `DerivativeLink`) but **never writes to them**. When a derivative IP is created in `ip_core`, it invokes `kollect::validate_derivative_grant` via CPI to verify the license grant — making Kollect the license program that `ip_core` delegates validation to.

---

## Overview

Kollect implements the economic layer for Mycelium IP Protocol. It covers five domains:

- **PIL-based Licensing** — Global reusable license templates (Programmable IP License) → per-IP licenses with business terms → per-entity license grants as proof of purchase
- **Venue Playback Tracking** — Registered venues submit daily hash commitments of playback data, anchoring off-chain usage reports on-chain
- **Settlement & Royalty Distribution** — Weekly settlement batches distribute revenue from venues to IP treasuries, with bottom-to-top royalty chain walks for derivative IPs (max depth 3)
- **Treasury Management** — Platform, entity, and per-IP treasuries collect and distribute fees, earnings, and royalties via SPL token accounts
- **Cross-Program Integration** — Read-only references to `ip_core` for entity controller validation, IP ownership checks, and derivative link verification

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            kollect Program                                   │
│                                                                              │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────────────┐  │
│  │ PlatformConfig   │  │ PlatformTreasury │  │ TemplateConfig (counter)   │  │
│  │ (authority, fees)│  │ (fee collection) │  │ (next template_id)        │  │
│  └─────────────────┘  └──────────────────┘  └────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                        Licensing Layer                                 │  │
│  │  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────┐   │  │
│  │  │ LicenseTemplate │→ │ License          │→ │ LicenseGrant        │   │  │
│  │  │ (global PIL)    │  │ (IP + terms)     │  │ (entity proof)      │   │  │
│  │  └─────────────────┘  └──────────────────┘  └─────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                     IP & Entity Treasuries                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────────┐  │  │
│  │  │ IpConfig     │  │ IpTreasury   │  │ EntityTreasury              │  │  │
│  │  │ (onboarding) │  │ (per-IP $)   │→ │ (per-entity $, withdrawal) │  │  │
│  │  └──────────────┘  └──────────────┘  └─────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                    Playback & Settlement                               │  │
│  │  ┌──────────────┐  ┌────────────────────┐  ┌──────────────────────┐   │  │
│  │  │ VenueAccount │→ │PlaybackCommitment  │→ │ SettlementRecord     │   │  │
│  │  │ (venue data) │  │ (daily hash)       │  │ (weekly batch)       │   │  │
│  │  └──────────────┘  └────────────────────┘  └──────────────────────┘   │  │
│  │                                                                        │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │  │
│  │  │ RoyaltySplit (derivative → origin, bottom-to-top distribution)  │  │  │
│  │  └──────────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
        ▲ read-only references
        │
┌───────┴──────────────────────────────────────────────────────────────────────┐
│  ip_core Program (external)                                                  │
│  Entity │ IpAccount │ DerivativeLink                                         │
│  → github.com/mycelium-ip/mycelium-ip-protocol                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Deployed Addresses (Devnet)

| Program     | Program ID                                       | Explorer                                                                                                                     |
| ----------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **kollect** | `GKMP1rbfBV7fDxmr1Pc5zB7uzDtSdx3rkZLfp4ao47DA`  | [View on Solana Explorer](https://explorer.solana.com/address/GKMP1rbfBV7fDxmr1Pc5zB7uzDtSdx3rkZLfp4ao47DA?cluster=devnet)   |
| **ip_core** | `ARoG6DV6Mx4w44tM9QGYoMaqXUBM6zCwyMBRDLt5vAap`  | See [mycelium-ip-protocol](https://github.com/mycelium-ip/mycelium-ip-protocol) for details                                  |

> **Note:** These are devnet deployments for development and testing. Mainnet addresses will be published upon mainnet launch.

---

## Account Types

All accounts are PDA-derived from the `kollect` program ID. No randomness or nonce-based identity derivation.

| Account                | PDA Seeds                                                            | Description                                             |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| `PlatformConfig`       | `["platform_config"]`                                                | Platform-wide settings: authority, fees, pricing, currency, treasury reference |
| `PlatformTreasury`     | `["platform_treasury"]`                                              | Platform-level fee collection authority                  |
| `TemplateConfig`       | `["template_config"]`                                                | Auto-incrementing counter for global license template IDs |
| `LicenseTemplate`      | `["license_template", &template_id.to_le_bytes()]`                   | Global reusable PIL terms (derivatives, commercial use, rev-share floors) |
| `License`              | `["license", ip_account.key(), license_template.key()]`              | Per-IP license attaching a template with business terms (price, grants, duration) |
| `LicenseGrant`         | `["license_grant", license.key(), grantee_entity.key()]`             | Per-entity proof of license purchase (one grant per license per entity) |
| `IpConfig`             | `["ip_config", ip_account.key()]`                                    | Per-IP onboarding on kollect (price override, active status, template count) |
| `IpTreasury`           | `["ip_treasury", ip_account.key()]`                                  | Per-IP earnings account (playback royalties, license purchase revenue) |
| `EntityTreasury`       | `["entity_treasury", entity.key()]`                                  | Per-entity treasury for aggregated earnings and withdrawal |
| `VenueAccount`         | `["venue", &venue_id.to_le_bytes()]`                                 | Registered venue with pricing multiplier and metadata   |
| `PlaybackCommitment`   | `["playback", venue.key(), &day_timestamp.to_le_bytes()]`            | Daily SHA-256 hash commitment of venue playback data    |
| `SettlementRecord`     | `["settlement", venue.key(), &period_start.to_le_bytes(), &settled_at.to_le_bytes()]` | Record of a settlement batch with merkle root and distribution data |
| `RoyaltySplit`         | `["royalty_split", derivative_ip.key(), origin_ip.key()]`            | Royalty distribution link between derivative and origin IP (auto-created during onboarding) |

---

## Instructions

### Platform Management

| Instruction              | Description                                     | Authority          |
| ------------------------ | ----------------------------------------------- | ------------------ |
| `initialize_platform`    | Initialize PlatformConfig, PlatformTreasury, and TemplateConfig | Initial deployer   |
| `update_platform_config` | Update fees, pricing, depth limits, treasury    | config.authority   |
| `withdraw_platform_fees` | Withdraw collected fees from platform treasury  | treasury.authority |

### IP Onboarding

| Instruction       | Description                                                                      | Authority          |
| ----------------- | -------------------------------------------------------------------------------- | ------------------ |
| `onboard_ip`      | Register an ip_core IP on kollect (creates IpConfig, IpTreasury, and RoyaltySplit if derivative) | platform authority |
| `update_ip_config` | Update price-per-play override                                                  | Entity controller  |
| `deactivate_ip`   | Deactivate an IP on the platform                                                 | platform authority |
| `reactivate_ip`   | Reactivate a previously deactivated IP                                           | platform authority |

### Entity Treasury

| Instruction                | Description                                          | Authority         |
| -------------------------- | ---------------------------------------------------- | ----------------- |
| `initialize_entity_treasury` | Create EntityTreasury with ATA for platform currency | Entity controller |
| `withdraw_entity_earnings` | Withdraw earnings from EntityTreasury                | treasury.authority |
| `withdraw_ip_treasury`     | Settle IP earnings to EntityTreasury                 | Entity controller |

### Venue Management

| Instruction             | Description                                        | Authority          |
| ----------------------- | -------------------------------------------------- | ------------------ |
| `register_venue`        | Register a new venue with ID from off-chain system | platform authority |
| `update_venue`          | Update venue metadata (CID, operator)              | venue.authority    |
| `update_venue_multiplier` | Set/change venue pricing multiplier              | platform authority |
| `deactivate_venue`      | Deactivate a venue                                 | platform authority |
| `reactivate_venue`      | Reactivate a previously deactivated venue          | platform authority |

### Licensing

| Instruction                 | Description                                                          | Authority                        |
| --------------------------- | -------------------------------------------------------------------- | -------------------------------- |
| `create_license_template`   | Create a global reusable PIL template (no IP/entity required)        | Any signer                       |
| `update_license_template`   | Toggle `is_active` on a template                                     | Template creator                 |
| `create_license`            | Attach a template to an IP with business terms                       | Entity controller (IP owner)     |
| `update_license`            | Update price, grant duration, active status, derivative rev share    | Entity controller (IP owner)     |
| `purchase_license`          | Purchase a license grant (payment split to IP treasury + platform)   | Grantee entity controller        |
| `validate_derivative_grant` | CPI handler invoked by ip_core to validate derivative creation       | ip_core via CPI                  |

### Playback & Settlement

| Instruction       | Description                                                                    | Authority                        |
| ----------------- | ------------------------------------------------------------------------------ | -------------------------------- |
| `submit_playback` | Submit daily playback hash commitment for a venue                              | platform authority               |
| `settle_period`   | Settle a weekly period — distributes revenue to IP treasuries with royalty splits | platform authority + venue authority (co-signer, payer) |

---

## Licensing Flow

### 1. Create a License Template

Any wallet creates a `LicenseTemplate` with PIL terms — derivatives allowed, commercial use, attribution requirements, revenue share floors, and an off-chain metadata URI. Templates are global and reusable; no IP or entity ownership required.

### 2. Create a License for an IP

After the platform authority onboards an IP via `onboard_ip` (gated by off-chain review), the IP's entity controller creates a `License` attaching a `LicenseTemplate` to their specific IP. The license sets business terms: price, max grants, grant duration, and `derivative_rev_share_bps` (must be >= the template's floor).

### 3. Purchase a License

Another entity calls `purchase_license` referencing a `License`. If the price is > 0:

- Platform takes `platform_fee_bps` cut → transferred to `PlatformTreasury` token account
- Remainder → transferred to the origin IP's `IpTreasury` token account

A `LicenseGrant` is created with expiration computed from `license.grant_duration` (0 = perpetual). `License.current_grants` increments (bounded by `max_grants`).

### 4. Create a Derivative

The grantee uses `ip_core::create_derivative_link`, passing `kollect`'s program ID as `license_program_id`. `ip_core` invokes `kollect::validate_derivative_grant` via CPI, which validates: grant not expired, license active, derivatives allowed on the template, and grantee matches the entity.

When the derivative IP is subsequently onboarded on kollect via `onboard_ip`, a `RoyaltySplit` is **automatically created** — snapshotting the `derivative_rev_share_bps` from the license at that moment.

---

## Playback & Settlement Flow

### Daily: Submit Playback Commitments

Off-chain sniffing devices report playback data to the platform backend. The backend hashes the daily `{ track, count }[]` data and the platform authority calls `submit_playback` with the SHA-256 commitment hash and total play count for each venue.

### Settlement: Distribute Revenue

Settlement can occur at any time during or after the week. The platform authority and venue authority **co-sign** `settle_period`, passing:

- `period_start` (weekly boundary timestamp)
- `settled_at` (client-supplied, validated within 30s of on-chain clock)
- `Vec<IpDistribution>` with per-IP `{ ip_account, amount, plays }`

Multiple partial settlements per period are supported (each creates a unique `SettlementRecord` via `settled_at` in PDA seeds).

**On-chain validation:**
- `sum(distributions.plays) == sum(commitments.total_plays)`
- Computes merkle root of included commitment hashes
- Marks `PlaybackCommitment` accounts as settled

**Token flow:**
1. **Platform fee** — single transfer from venue's token account → `PlatformTreasury` ATA
2. **Per-IP distribution** — for each IP, walk the `RoyaltySplit` chain (up to `MAX_ROYALTY_CHAIN_DEPTH` = 3 levels):
   - If IP is a derivative: deduct `share_bps` → transfer royalty to origin IP's `IpTreasury` ATA, recurse upward
   - Transfer remaining net to the IP's own `IpTreasury` ATA
3. **Counter updates** — `IpTreasury.total_earned`, `RoyaltySplit.total_distributed`

Deactivated IPs may still receive settlement — revenue earned while active is distributable.

---

## Pricing Model

**Effective price per play:**

```
effective_price = (ip_config.price_per_play_override OR platform.base_price_per_play)
                  * venue.multiplier_bps / 10_000
```

**Venue multiplier** (`multiplier_bps`): `10_000` = 1.0x (no adjustment). Set by the platform authority. Range: 1-65,535 (0.01% to 6.55x).

**Platform fee** (`platform_fee_bps`): applied to **both** playback settlement revenue and license purchase payments. The platform sponsors gas fees.

**Royalty split** (derivatives):

```
royalty_to_origin = net_to_ip * royalty_split.share_bps / 10_000
net_to_derivative_owner = net_to_ip - royalty_to_origin
```

The royalty chain walks upward (max 3 levels): if the origin is also a derivative, its share is further split.

---

## Constants

| Constant                       | Value      | Description                                       |
| ------------------------------ | ---------- | ------------------------------------------------- |
| `MAX_ROYALTY_CHAIN_DEPTH`      | 3          | Max bottom-to-top royalty distribution depth       |
| `SETTLEMENT_PERIOD_SECONDS`    | 604,800    | Settlement cycle duration (7 days)                 |
| `SECONDS_PER_DAY`             | 86,400     | UTC day boundary for playback commitments          |
| `BPS_DENOMINATOR`             | 10,000     | Basis points denominator (100%)                    |
| `MAX_CID_LENGTH`              | 96 bytes   | IPFS CIDv1 base32 max size (venue CID)            |
| `MAX_TEMPLATE_NAME_LENGTH`    | 64 bytes   | License template name limit                        |
| `MAX_URI_LENGTH`              | 96 bytes   | License template URI max size                      |
| `SETTLEMENT_TIMESTAMP_TOLERANCE` | 30 seconds | Clock tolerance for `settled_at` validation     |

---

## Design Constraints

- All accounts are **PDA-derived** — no randomness, no nonce-based IDs
- All fee/price/royalty arithmetic uses **checked operations** (`checked_mul`, `checked_div`, `checked_add`, `checked_sub`)
- `ip_core` accounts are **read-only** inputs — never CPI-mutate them
- Entity controller is always resolved via **cross-program read** of `Entity` from `ip_core` (never cached)
- **Single currency** for POC: all on-chain payments use `PlatformConfig.currency`
- **Fixed-size fields** preferred — no unbounded `Vec` growth
- `IpDistribution` in `settle_period` is instruction data (bounded by transaction size limits)
- ATAs for platform currency are created at init time (`initialize_platform`, `initialize_entity_treasury`, `onboard_ip`)
- `onboard_ip` and `deactivate_ip` are **admin-gated** (platform authority only)
- `RoyaltySplit` is auto-created during `onboard_ip` when a `DerivativeLink` exists — no separate instruction
- No governance mechanisms in the program itself

---

## Testing

Tests are organized under `tests/kollect/`:

| Test File                    | Coverage                                |
| ---------------------------- | --------------------------------------- |
| `00_platform.test.ts`        | Platform initialization and config      |
| `01_entity_treasury.test.ts` | Entity treasury creation and management |
| `02_venue.test.ts`           | Venue registration and updates          |
| `03_ip_onboarding.test.ts`   | IP onboarding lifecycle                 |
| `04_licensing.test.ts`       | License templates, licenses, and grants |
| `05_playback.test.ts`        | Playback commitment submission          |
| `06_royalty_depth.test.ts`   | Royalty chain depth validation           |
| `07_withdrawals.test.ts`     | Treasury withdrawal flows               |

Run all tests:

```bash
anchor test
```

Run a specific test file:

```bash
yarn run ts-mocha -p ./tsconfig.json -t 1000000 "tests/kollect/04_licensing.test.ts"
```

---

## Getting Started

### Prerequisites

- Rust 1.89.0 (`rust-toolchain.toml` enforces this)
- Solana CLI
- Anchor 0.32+
- Node.js 18+
- Yarn

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd kollect

# Install dependencies
yarn install

# Build programs
anchor build

# Run tests
anchor test
```

### Development

```bash
# Start local validator
solana-test-validator

# Build programs
anchor build

# Deploy to localnet
anchor deploy
```

---

## Project Structure

```
kollect/
├── programs/
│   ├── ip_core/                    # Core IP registry (see mycelium-ip-protocol repo)
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── error.rs
│   │       ├── constants/
│   │       ├── instructions/
│   │       ├── state/
│   │       └── utils/
│   └── kollect/                    # Licensing & royalty layer
│       └── src/
│           ├── lib.rs              # Program entry point (23 instructions)
│           ├── error.rs            # Error definitions
│           ├── events.rs           # Event definitions
│           ├── constants/          # Protocol constants
│           ├── instructions/       # Instruction handlers
│           │   ├── platform/       # Platform management
│           │   ├── ip/             # IP onboarding
│           │   ├── entity/         # Entity treasury & withdrawals
│           │   ├── venue/          # Venue management
│           │   ├── licensing/      # License templates, licenses, grants, CPI validation
│           │   └── playback/       # Playback commitments & settlement
│           ├── state/              # Account structures
│           └── utils/              # Helper functions
├── scripts/
│   └── kollect/                    # Kollect-specific CLI scripts
├── tests/
│   └── kollect/                    # Kollect integration tests
├── target/
│   ├── idl/                        # Generated IDL files
│   └── types/                      # Generated TypeScript types
├── Anchor.toml
├── Cargo.toml
└── package.json
```

---

## Contributing

Contributions are welcome. Please ensure:

1. All tests pass (`anchor test`)
2. Code follows existing patterns and conventions
3. New instructions include appropriate tests
4. Protocol invariants are preserved
5. `ip_core` is **never modified** from this repository

## License

[Add license information here]
