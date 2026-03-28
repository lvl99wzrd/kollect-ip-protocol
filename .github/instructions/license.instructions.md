---
applyTo: "programs/license/**"
---

# Mycelium IP Protocol – License Program – Canonical Account & Instruction Specification

This document defines all accounts, invariants, constraints, and instruction mappings for the License program.

Any instruction violating these constraints must fail.

All PDAs must be derived using the current program_id.

---

# DESIGN OVERVIEW

The License program implements a **two-layer model**:

1. **License** — Global per IP (`["license", origin_ip]`), defines terms
2. **LicenseGrant** — Per grantee (`["license_grant", license, grantee_entity]`), tracks who acquired the license

This separation enables:

- One license definition per IP asset
- Multiple grantees per license
- Independent grant expiration from license terms
- `ip_core`'s `create_derivative_link` to validate grantee holds a valid license grant

---

# GLOBAL PROTOCOL INVARIANTS

1. No account may contain royalty, governance, revenue, or economic distribution logic.
2. All timestamps use `Clock::get()?.unix_timestamp`.
3. No PDA may be reinitialized.
4. All accounts must include a `bump: u8`.
5. No account may grow dynamically without explicit bounded limits.
6. All cross-account references must be validated on every instruction.
7. No instruction may mutate fields not explicitly listed as mutable.
8. License program validates existence and structural correctness only — no economic enforcement.
9. Derivative IPs cannot create independent licenses — they inherit parent IP's licensing terms.

---

# CONSTANT LIMITS

Defined in shared constants module:

- LICENSE_SEED = "license"
- LICENSE_GRANT_SEED = "license_grant"

No additional fields required for minimal v1.

Copilot must never invent dynamic sizing.

---

# ERROR MODEL (Canonical)

Define explicit errors:

- LicenseAlreadyExists
- LicenseGrantAlreadyExists
- Unauthorized
- InvalidOriginIp
- DerivativeCannotCreateLicense
- LicenseNotFound
- LicenseGrantNotFound
- GrantExpired
- DerivativesNotAllowed
- InvalidAuthority
- InvalidGrantee
- InvalidLicense

---

# IP_CORE INTEGRATION MODEL

## Design Principle

- `ip_core`'s `create_derivative_link` and `update_derivative_license` require license validation.
- `ip_core` delegates all validation to this program via CPI — it never deserializes license accounts.
- This program exposes a `validate_derivative_grant` instruction that `ip_core` invokes.

## CPI Endpoint: `validate_derivative_grant`

Called by `ip_core` before creating or updating a derivative link.

### Accounts (all read-only, non-signer)

| #   | Account        | Description                        |
| --- | -------------- | ---------------------------------- |
| 0   | license_grant  | The LicenseGrant PDA               |
| 1   | license        | The License PDA                    |
| 2   | parent_ip      | The parent IPAccount               |
| 3   | grantee_entity | The Entity creating the derivative |

### Instruction Data

8-byte Anchor discriminator only (`sha256("global:validate_derivative_grant")[..8]`).

### Validation Rules

1. `license_grant` PDA validated via seeds `["license_grant", license, grantee_entity]`.
2. `license` PDA validated via seeds `["license", parent_ip]`.
3. `license.derivatives_allowed == true`.
4. If `license_grant.expiration != 0`, then `expiration > Clock::get()?.unix_timestamp`.
5. `license_grant.grantee == grantee_entity`.

Failure of any rule → returns an error (which `ip_core` maps to `LicenseValidationFailed`).

---

# INSTRUCTION → ACCOUNT MUTATION MAP

| Instruction               | Accounts Mutated     |
| ------------------------- | -------------------- |
| create_license            | License              |
| update_license            | License              |
| revoke_license            | License (close)      |
| create_license_grant      | LicenseGrant         |
| revoke_license_grant      | LicenseGrant (close) |
| validate_derivative_grant | None (read-only CPI) |

Any instruction not listed is invalid.

---

# 1. License

## PDA Seeds

```
["license", origin_ip]
```

## Fields

- origin_ip: Pubkey
- authority: Pubkey
- derivatives_allowed: bool
- created_at: i64
- bump: u8

## Space Calculation

```
8 (discriminator) + 32 (origin_ip) + 32 (authority) + 1 (derivatives_allowed) + 8 (created_at) + 1 (bump) = 82 bytes
```

## Invariants

- `origin_ip` must reference a valid IPAccount owned by `ip_core`.
- `origin_ip` must NOT be a derivative IP (has no parent DerivativeLink where child_ip == origin_ip).
- Derivative IPs inherit licensing terms from their parent — they cannot create independent licenses.
- `authority` is the Entity that owns the IP at creation time.
- `authority` is immutable after creation.
- `origin_ip` is immutable after creation.
- License never expires (terms are permanent).
- Only one license may exist per IP.

## Instructions

### create_license

- Derives PDA from:
  ```
  ["license", origin_ip]
  ```
- Fails if PDA already exists.
- Requires IP owner Entity controller signature.
- Validates:
  - `origin_ip` exists and is owned by `ip_core` program.
  - `origin_ip` is NOT a derivative (query for DerivativeLink where child_ip == origin_ip must fail).
  - Signer controls the IP owner Entity.
- Sets:
  - `authority` = current IP owner Entity
  - `derivatives_allowed` = provided value
  - `created_at` = current timestamp
  - `bump` = canonical bump

### update_license

- Requires `authority` Entity controller signature.
- May update:
  - `derivatives_allowed`
- Must NOT mutate:
  - `origin_ip`
  - `authority`
  - `created_at`
  - `bump`
- Updates are immediate and affect future grants.

### revoke_license (Optional)

- Requires `authority` Entity controller signature.
- Closes License account.
- Refunds rent to authority signer.
- Consideration: Should only be allowed if no active grants exist.

---

# 2. LicenseGrant

## PDA Seeds

```
["license_grant", license, grantee_entity]
```

## Fields

- license: Pubkey
- grantee: Pubkey
- granted_at: i64
- expiration: i64
- bump: u8

## Space Calculation

```
8 (discriminator) + 32 (license) + 32 (grantee) + 8 (granted_at) + 8 (expiration) + 1 (bump) = 89 bytes
```

## Invariants

- `license` must reference a valid License account owned by this program.
- `grantee` must reference a valid Entity account owned by `ip_core`.
- `expiration = 0` means no expiration (permanent grant).
- `expiration > 0` means unix timestamp after which grant is invalid.
- One grant per (license, grantee) pair.
- `license` is immutable.
- `grantee` is immutable.
- `granted_at` is immutable.

## Instructions

### create_license_grant

- Derives PDA from:
  ```
  ["license_grant", license, grantee_entity]
  ```
- Fails if PDA already exists.
- Requires License `authority` Entity controller signature (IP owner grants licenses).
- Validates:
  - `license` exists and is owned by this program.
  - `grantee` exists and is owned by `ip_core` program.
- Sets:
  - `license` = provided license Pubkey
  - `grantee` = provided grantee Entity
  - `granted_at` = current timestamp
  - `expiration` = provided value (0 = no expiration)
  - `bump` = canonical bump
- Optional: Payment logic can be added here (deferred for v1).

### revoke_license_grant

- Requires License `authority` Entity controller signature.
- Closes LicenseGrant account.
- Refunds rent to authority signer.
- Does NOT require grantee consent.

---

# ACCOUNT SIZE REQUIREMENT

Every account struct must include:

- 8 bytes discriminator
- All fixed fields
- 1 byte bump

Anchor space must be calculated explicitly.

Copilot must not assume auto-sizing.

---

# STATE TRANSITION SAFETY RULES

1. Every instruction must validate all PDAs via seeds.
2. All cross-account Pubkeys must match stored references.
3. No instruction may:
   - Reallocate account size
   - Change immutable fields
   - Mutate unrelated accounts
4. All cross-program references (IPAccount, Entity, DerivativeLink) must be validated via owner check.
5. All arithmetic must use checked_add.

---

# DERIVATIVE IP LICENSING CHAIN

Derivative IPs inherit licensing from their parent IP:

1. A derivative IP cannot create its own License.
2. To create a derivative of a derivative, the creator must hold a valid LicenseGrant for the **root** (non-derivative) IP in the chain.
3. `ip_core` enforces this by traversing the derivative chain to the root IP when validating license grants.

This ensures:

- Chain of rights is preserved.
- Original IP owner maintains licensing authority.
- Derivative creators cannot bypass original license terms.

---

# PROGRAM FOLDER STRUCTURE

```
programs/license/
├── Cargo.toml
└── src/
    ├── lib.rs
    │
    ├── constants/
    │   └── mod.rs
    │
    ├── error.rs
    │
    ├── state/
    │   ├── mod.rs
    │   ├── license.rs
    │   └── license_grant.rs
    │
    ├── instructions/
    │   ├── mod.rs
    │   ├── create_license.rs
    │   ├── update_license.rs
    │   ├── revoke_license.rs
    │   ├── create_license_grant.rs
    │   ├── revoke_license_grant.rs
    │   └── validate_derivative_grant.rs
    │
    └── utils/
        ├── mod.rs
        ├── seeds.rs
        └── validation.rs
```

This structure is mandatory.

---

# FILE RESPONSIBILITIES

## lib.rs

- Program entrypoint
- Declares all instruction handlers
- Re-exports instruction modules
- No business logic allowed
- No validation logic allowed
- No state definitions allowed

Only routing.

---

## constants/mod.rs

Must contain:

- LICENSE_SEED = "license"
- LICENSE_GRANT_SEED = "license_grant"
- Any other global fixed limits

No dynamic sizing.

No logic.

---

## error.rs

Contains:

- Canonical error enum with all errors defined in specification
- No logic
- No helper functions

---

## state/

Each account must:

- Be defined in its own file
- Include struct definition
- Include PDA seed documentation
- Include space calculation constant
- Include invariant comments

No instruction logic inside state files.

Each file contains exactly one account struct.

---

## instructions/

Each instruction must:

- Be defined in its own file
- Contain:
  - Context struct
  - Handler function
  - All validations
  - All state mutations
- Must not define state structs
- Must not define global constants

No instruction may modify accounts not listed in canonical spec.

---

## utils/

### seeds.rs

Contains:

- Canonical PDA derivation helper functions
- Seed arrays for:
  - license
  - license_grant

No logic beyond deterministic seed construction.

---

### validation.rs

Contains:

- Cross-program validation helpers
- IP account ownership validation
- Entity account ownership validation
- DerivativeLink existence checks

No state mutations.

---

# CROSS-PROGRAM DEPENDENCIES

The License program depends on:

- `ip_core` for validation of:
  - IPAccount existence and ownership
  - Entity existence and ownership
  - DerivativeLink existence (to check if IP is derivative)

Integration must use:

- Account owner checks (not deserialization when possible)
- CPI calls only if required for state reads

---

# VERIFICATION CHECKLIST

- [ ] License PDAs are deterministic from `origin_ip` alone.
- [ ] LicenseGrant PDAs are deterministic from `license` + `grantee_entity`.
- [ ] `create_license` validates IP is non-derivative before creation.
- [ ] `create_license_grant` validates license and grantee exist.
- [ ] `ip_core::create_derivative_link` validates LicenseGrant instead of License.
- [ ] Grant expiration is checked at derivative creation time.
- [ ] License terms are permanent (no expiration field on License).
- [ ] All accounts include bump field.
- [ ] All PDAs use canonical bump.
- [ ] No economic/royalty logic present.
