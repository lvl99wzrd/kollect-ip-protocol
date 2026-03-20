# Mycelium IP Protocol

A deterministic, neutral IP claim registry built on Solana.

## Overview

Mycelium IP Protocol provides on-chain infrastructure for registering intellectual property claims without imposing economic, governance, or arbitration logic. The protocol is intentionally minimal—it records claims deterministically but does not validate authorship or resolve disputes.

The protocol consists of two independent programs:

| Program     | Purpose                                                                    |
| ----------- | -------------------------------------------------------------------------- |
| **ip_core** | Core IP registry, entity management, metadata schemas, derivative tracking |
| **license** | Two-layer licensing model for IP usage rights                              |

### Design Philosophy

- **Neutral** — No governance mechanisms or arbitration logic
- **Deterministic** — All accounts are PDA-derived; no randomness
- **Minimal** — Records claims without judging authorship truth
- **Non-economic** — No royalty logic or payment distribution in core
- **Modular** — Programs do not share mutable state

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ip_core Program                          │
│  ┌──────────────┐  ┌─────────┐  ┌───────────────────────────┐  │
│  │ProtocolConfig│  │ Entity  │  │        IpAccount          │  │
│  │   Treasury   │  │(control)│  │ (registrant, content_hash)│  │
│  └──────────────┘  └─────────┘  └───────────────────────────┘  │
│                                                                 │
│  ┌──────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │  MetadataSchema  │  │ MetadataAccount│  │ DerivativeLink │  │
│  │   (id, version)  │  │   (revision)   │  │(parent ↔ child)│  │
│  └──────────────────┘  └────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       license Program                           │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐  │
│  │        License          │  │       LicenseGrant          │  │
│  │  (origin_ip → terms)    │  │  (license → grantee_entity) │  │
│  └─────────────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Programs

### Deployed Addresses (Devnet)

The protocol is currently deployed on **Solana Devnet**. Both programs share the same addresses on localnet and devnet.

| Program     | Program ID                                     | Explorer                                                                                                                   |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **ip_core** | `ARoG6DV6Mx4w44tM9QGYoMaqXUBM6zCwyMBRDLt5vAap` | [View on Solana Explorer](https://explorer.solana.com/address/ARoG6DV6Mx4w44tM9QGYoMaqXUBM6zCwyMBRDLt5vAap?cluster=devnet) |
| **license** | `8iA7LYmvxr3SL8ZzTAZtbXfcGGjMpNQz116oeSiAEt1Q` | [View on Solana Explorer](https://explorer.solana.com/address/8iA7LYmvxr3SL8ZzTAZtbXfcGGjMpNQz116oeSiAEt1Q?cluster=devnet) |

> **Note:** These are devnet deployments for development and testing. Mainnet addresses will be published upon mainnet launch.

---

### ip_core

**Program ID:** `ARoG6DV6Mx4w44tM9QGYoMaqXUBM6zCwyMBRDLt5vAap`

The core registry program handles IP registration, entity management, and derivative tracking.

#### Account Types

| Account                | PDA Seeds                                 | Description                                              |
| ---------------------- | ----------------------------------------- | -------------------------------------------------------- |
| `ProtocolConfig`       | `["config"]`                              | Protocol settings, fee configuration, treasury reference |
| `ProtocolTreasury`     | `["treasury"]`                            | Authority over SPL token accounts for fees               |
| `CreatorEntityCounter` | `["entity_counter", creator]`             | Per-creator sequential entity index counter              |
| `Entity`               | `["entity", creator, index]`              | On-chain identity with single controller                 |
| `IpAccount`            | `["ip", registrant_entity, content_hash]` | IP registration with ownership tracking                  |
| `MetadataSchema`       | `["metadata_schema", id, version]`        | Defines metadata structure                               |
| `MetadataAccount`      | `["metadata", type, parent, revision]`    | Versioned metadata for entities/IPs                      |
| `DerivativeLink`       | `["derivative", parent_ip, child_ip]`     | Links derivative IP to parent with license reference     |

#### Instructions

**Protocol Management**

- `initialize_config` — Initialize protocol configuration
- `update_config` — Update config parameters
- `initialize_treasury` — Set up protocol treasury
- `withdraw_treasury` — Withdraw from treasury

**Entity Management**

- `create_entity` — Create on-chain identity
- `transfer_entity_control` — Transfer entity control to new controller

**Metadata**

- `create_metadata_schema` — Define metadata structure
- `create_entity_metadata` — Attach metadata to entity
- `create_ip_metadata` — Attach metadata to IP

**IP Registration**

- `create_ip` — Register new IP claim
- `transfer_ip` — Transfer IP ownership

**Derivatives**

- `create_derivative_link` — Link derivative to parent IP
- `update_derivative_license` — Update license reference on derivative

#### Constants

| Constant               | Value | Description                       |
| ---------------------- | ----- | --------------------------------- |
| `MAX_SCHEMA_ID_LENGTH` | 32    | Maximum schema identifier length  |
| `MAX_VERSION_LENGTH`   | 16    | Maximum version string length     |
| `MAX_CID_LENGTH`       | 96    | Maximum content identifier length |

---

### license

**Program ID:** `8iA7LYmvxr3SL8ZzTAZtbXfcGGjMpNQz116oeSiAEt1Q`

The license program implements a two-layer licensing model for IP usage rights.

#### Account Types

| Account        | PDA Seeds                                    | Size     | Description                                 |
| -------------- | -------------------------------------------- | -------- | ------------------------------------------- |
| `License`      | `["license", origin_ip]`                     | 82 bytes | License terms for an IP (permanent, per-IP) |
| `LicenseGrant` | `["license_grant", license, grantee_entity]` | 89 bytes | Grant of rights to specific entity          |

#### Instructions

- `create_license` — Create license terms for an IP (non-derivative IPs only)
- `update_license` — Update `derivatives_allowed` flag
- `revoke_license` — Close license account
- `create_license_grant` — Grant rights to an entity
- `revoke_license_grant` — Revoke a grant

#### Licensing Rules

- **Derivative IPs cannot create independent licenses** — They inherit parent licensing terms
- **Grant expiration**: `0` = permanent, `> 0` = Unix timestamp when grant expires

## Getting Started

### Prerequisites

- Rust 1.89.0 (`rust-toolchain.toml` enforces this)
- Solana CLI
- Anchor 0.32.1
- Node.js 18+
- Yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/mycelium-ip-protocol.git
cd mycelium-ip-protocol

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

# Run specific test file
yarn run ts-mocha -p ./tsconfig.json -t 1000000 "tests/02_ip.test.ts"
```

## Testing

Tests are organized by domain:

| Test File               | Coverage                           |
| ----------------------- | ---------------------------------- |
| `00_protocol.test.ts`   | Protocol initialization and config |
| `01_entity.test.ts`     | Entity creation and management     |
| `02_ip.test.ts`         | IP registration and transfer       |
| `03_metadata.test.ts`   | Metadata schemas and accounts      |
| `04_license.test.ts`    | License management                 |
| `05_derivative.test.ts` | Derivative linking                 |

Run all tests:

```bash
anchor test
```

## Protocol Invariants

These invariants must never be violated:

1. **IP PDA is deterministic** — Derived from `(registrant_entity, content_hash)`
2. **Content hash is immutable** — Cannot be changed after IP creation
3. **Ownership transfer preserves PDA** — IP address never changes
4. **Registry is neutral** — Does not determine authorship truth
5. **No economic logic in core** — Royalty/payment distribution handled externally

## Project Structure

```
mycelium-ip-protocol/
├── programs/
│   ├── ip_core/
│   │   └── src/
│   │       ├── lib.rs              # Program entry point
│   │       ├── error.rs            # Error definitions
│   │       ├── constants/          # Protocol constants
│   │       ├── instructions/       # Instruction handlers
│   │       ├── state/              # Account structures
│   │       └── utils/              # Helper functions
│   └── license/
│       └── src/
│           ├── lib.rs
│           ├── error.rs
│           ├── constants/
│           ├── instructions/
│           ├── state/
│           └── utils/
├── tests/                          # TypeScript integration tests
├── target/
│   ├── idl/                        # Generated IDL files
│   └── types/                      # Generated TypeScript types
├── Anchor.toml                     # Anchor configuration
├── Cargo.toml                      # Workspace configuration
└── package.json                    # Node dependencies
```

## Contributing

Contributions are welcome. Please ensure:

1. All tests pass (`anchor test`)
2. Code follows existing patterns and conventions
3. New instructions include appropriate tests
4. Protocol invariants are preserved

## License

[Add license information here]
