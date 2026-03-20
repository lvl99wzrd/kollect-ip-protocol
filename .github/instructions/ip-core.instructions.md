# Mycelium IP Protocol - IP Core Program – Canonical Account & Instruction Specification

This document defines all accounts, invariants, constraints, and instruction mappings.

Any instruction violating these constraints must fail.

All PDAs must be derived using the current program_id.

---

# GLOBAL PROTOCOL INVARIANTS

1. No account may contain royalty, governance, revenue, or economic distribution logic.
2. All timestamps use `Clock::get()?.unix_timestamp`.
3. All version increments must be strictly monotonic (+1 only).
4. No PDA may be reinitialized.
5. All accounts must include a `bump: u8`.
6. No account may grow dynamically without explicit bounded limits.
7. All cross-account references must be validated on every instruction.
8. No instruction may mutate fields not explicitly listed as mutable.
9. `ip_core` must never interpret license economics — only validate license existence and structural correctness.

---

# CONSTANT LIMITS

Defined in shared constants module:

- MAX_SCHEMA_ID_LENGTH = 32
- MAX_VERSION_LENGTH = 16
- MAX_CID_LENGTH = 96

Copilot must never invent dynamic sizing.

---

# ERROR MODEL (Canonical)

Define explicit errors:

- ConfigAlreadyInitialized
- TreasuryAlreadyInitialized
- Unauthorized
- InvalidAuthority
- EntityNotInitialized
- MetadataSchemaNotFound
- InvalidMetadataRevision
- IPAlreadyExists
- InvalidOwnership
- DerivativeAlreadyExists
- ArithmeticOverflow
- EmptyCid
- InvalidLicenseOwner
- InvalidLicenseOrigin
- DerivativesNotAllowed
- LicenseExpired
- InvalidTokenMint
- InvalidTreasuryAuthority

---

# EXTERNAL LICENSE INTEGRATION MODEL

## Design Principle

- Licenses live in a separate on-chain program.
- `ip_core` must treat license as an opaque PDA owned by a verified License Program.
- `ip_core` only validates:
  - Ownership (program owner check)
  - Structural correctness
  - Capability flags required for derivative creation

No economic logic may be replicated inside `ip_core`.

---

## Minimal License Interface (Required by ip_core)

The License account (owned by external program) must contain at minimum:

- origin_ip: Pubkey
- derivatives_allowed: bool
- expiration: i64 (0 = no expiration)
- bump: u8

Additional fields are allowed but ignored by `ip_core`.

---

## License Validation Rules (Canonical)

Before `DerivativeLink` creation:

1. License account owner must equal `LICENSE_PROGRAM_ID`.
2. License.origin_ip must equal `parent_ip`.
3. `derivatives_allowed == true`.
4. If `expiration != 0`, then:

   ```
   expiration > Clock::get()?.unix_timestamp
   ```

5. License account must not be closed.

Failure of any rule → instruction fails.

---

# SIMPLE DEFAULT LICENSE (REFERENCE IMPLEMENTATION)

A minimal "FreeToUse" license MAY contain:

```
{
  transferable: true,
  royaltyPolicy: Pubkey::default(),
  defaultMintingFee: 0,
  expiration: 0,
  commercialUse: false,
  commercialAttribution: false,
  commercializerChecker: Pubkey::default(),
  commercializerCheckerData: [],
  commercialRevShare: 0,
  commercialRevCeiling: 0,
  derivativesAllowed: true,
  derivativesAttribution: true,
  derivativesApproval: false,
  derivativesReciprocal: true,
  derivativeRevCeiling: 0,
  currency: Pubkey::default(),
  uri: <string>
}
```

`ip_core` ignores all fields except:

- origin_ip
- derivativesAllowed
- expiration

---

# INSTRUCTION → ACCOUNT MUTATION MAP

| Instruction             | Accounts Mutated                             |
| ----------------------- | -------------------------------------------- |
| initialize_config       | ProtocolConfig                               |
| update_config           | ProtocolConfig                               |
| initialize_treasury     | ProtocolTreasury                             |
| withdraw_treasury       | SPL token account (authority = treasury PDA) |
| create_metadata_schema  | MetadataSchema                               |
| create_entity           | Entity, CreatorEntityCounter                 |
| transfer_entity_control | Entity                                       |
| create_entity_metadata  | MetadataAccount, Entity                      |
| create_ip               | IPAccount                                    |
| transfer_ip             | IPAccount                                    |
| create_ip_metadata      | MetadataAccount, IPAccount                   |
| create_derivative_link  | DerivativeLink                               |

Any instruction not listed is invalid.

---

# 1. ProtocolConfig

## PDA Seeds

```
["config"]
```

## Fields

- authority: Pubkey
- treasury: Pubkey
- registration_currency: Pubkey
- registration_fee: u64
- bump: u8

## Invariants

- Exactly one instance may exist.
- Must be initialized before any entity or IP creation.
- treasury must reference a valid ProtocolTreasury PDA.
- authority is only used for config mutation.

## Instructions

### initialize_config

- Fails if already initialized.
- Sets initial authority and treasury.

### update_config

- Requires authority signature.
- May update:
  - authority
  - treasury
  - registration_currency
  - registration_fee
- Must validate treasury PDA.

No delete instruction allowed.

---

# 2. ProtocolTreasury

## PDA Seeds

```
["treasury"]
```

## Fields

- authority: Pubkey
- config: Pubkey
- bump: u8

## Invariants

- Exactly one instance.
- config must match ProtocolConfig PDA.
- Does NOT hold funds directly.
- Acts as authority over SPL token accounts.

## Instructions

### initialize_treasury

- Fails if already initialized.
- Must validate config exists.

### withdraw_treasury

- Requires authority signature.
- Transfers tokens from treasury-owned SPL account.
- Cannot mutate treasury struct fields.

No delete allowed.

---

# 3. MetadataSchema

## PDA Seeds

```
["metadata_schema", schema_id, version]
```

## Fields

- id: [u8; MAX_SCHEMA_ID_LENGTH]
- version: [u8; MAX_VERSION_LENGTH]
- hash: [u8; 32]
- cid: [u8; MAX_CID_LENGTH]
- creator: Pubkey
- created_at: i64
- bump: u8

## Invariants

- Immutable after initialization.
- id + version must be unique.
- hash must match schema definition hash.
- cid must not be empty.

## Instructions

### create_metadata_schema

- Fails if PDA already exists.
- No update allowed.
- No delete allowed.

---

# 4. MetadataAccount

## PDA Seeds

Entity:

```
["metadata", "entity", entity_pubkey, revision]
```

IP:

```
["metadata", "ip", ip_pubkey, revision]
```

## Fields

- schema: Pubkey
- hash: [u8; 32]
- cid: [u8; MAX_CID_LENGTH]
- parent_type: MetadataParentType
- parent: Pubkey
- revision: u64
- created_at: i64
- bump: u8

## Invariants

- Immutable after creation.
- schema must reference MetadataSchema.
- revision must equal parent.current_metadata_revision + 1.

## Instructions

### create_entity_metadata

- Requires entity controller signature.
- Creates MetadataAccount.
- Increments entity.current_metadata_revision.
- Updates entity.updated_at.

### create_ip_metadata

- Requires owner entity controller signature.
- Creates MetadataAccount.
- Increments ip.current_metadata_revision.
- Updates ip.updated_at.

No update.

No delete.

---

# 5. Entity

## PDA Seeds

```
["entity", creator_pubkey, index_le_bytes]
```

Where:

- index is a u64 sequential index derived from CreatorEntityCounter
- stored as 8-byte little-endian

## Fields

- creator: Pubkey
- index: u64
- controller: Pubkey
- current_metadata_revision: u64
- created_at: i64
- updated_at: i64
- bump: u8

## Hard Constraints

- controller must be a signer for all entity mutations.
- controller can be any Pubkey (EOA or external multisig PDA such as Squads).
- index immutable
- creator immutable
- created_at immutable
- index unique per creator (PDA uniqueness enforced)

## Authorization

For any mutation:

- controller must be a transaction signer.

Multisig is delegated to external protocols (e.g., Squads). The controller field can point to a multisig PDA.

## Instructions

### create_entity

- Initializes CreatorEntityCounter (via init_if_needed) if not yet created.
- Derives entity index from counter.entity_count.
- Derives PDA from:
  ```
  ["entity", creator_pubkey, index_le_bytes]
  ```
- Increments counter.entity_count.
- Sets controller = creator.
- Sets current_metadata_revision = 0.
- Sets created_at and updated_at.

### transfer_entity_control

- Requires current controller signature.
- Updates controller to new_controller.
- Updates updated_at.
- Cannot modify index.
- Cannot modify creator.

No delete allowed.

---

# 5a. CreatorEntityCounter

## PDA Seeds

```
["entity_counter", creator_pubkey]
```

## Fields

- creator: Pubkey
- entity_count: u64
- bump: u8

## Invariants

- One per creator wallet.
- Initialized on first create_entity call via init_if_needed.
- entity_count is monotonically increasing.
- entity_count must only be incremented by create_entity.

---

# 6. IPAccount

## PDA Seeds

```
["ip", registrant_entity, content_hash]
```

## Fields

- content_hash: [u8; 32]
- registrant_entity: Pubkey
- current_owner_entity: Pubkey
- current_metadata_revision: u64
- created_at: i64
- updated_at: i64
- bump: u8

## Invariants

- content_hash immutable.
- registrant_entity immutable.
- PDA never changes.
- current_owner_entity mutable only via transfer.
- current_metadata_revision initialized to 0.
- No royalty fields.
- No governance fields.
- IP registration requires payment of `config.registration_fee`.

## Instructions

### create_ip

- Requires registrant entity controller signature.
- Requires ProtocolConfig account.
- Requires ProtocolTreasury account.
- Requires treasury token account.
- Requires payer token account.
- Requires Token Program.

### Mandatory Validations

1. PDA derived from:

   ```
   ["ip", registrant_entity, content_hash]
   ```

2. Fails if PDA already exists.
3. `config.registration_fee` defines required payment amount.
4. Treasury token account must:
   - Have mint = `config.registration_currency`
   - Have authority = ProtocolTreasury PDA
5. Payer token account must:
   - Have mint = `config.registration_currency`
   - Be owned by a transaction signer
6. The payer must be the controller of `registrant_entity`.

### Payment Enforcement

- Must transfer exactly:
  ```
  config.registration_fee
  ```
  From payer token account
  To treasury token account
- Transfer must succeed before IPAccount initialization.

### State Mutation

- Initialize IPAccount.
- Set:
  - `current_owner_entity = registrant_entity`
  - `current_metadata_revision = 0`
  - `created_at = Clock::get()?.unix_timestamp`
  - `updated_at = Clock::get()?.unix_timestamp`

No other fields may be mutated.

### transfer_ip

- Requires current owner entity controller signature.
- Updates `current_owner_entity` only.
- Must not mutate:
  - content_hash
  - registrant_entity
  - current_metadata_revision
  - created_at
  - updated_at
- PDA must remain identical.

No delete allowed.

---

# 7. DerivativeLink

## PDA Seeds

```
["derivative", parent_ip, child_ip]
```

## Fields

- parent_ip: Pubkey
- child_ip: Pubkey
- license: Pubkey
- created_at: i64
- bump: u8

## Invariants

- parent_ip must exist.
- child_ip must exist.
- license must:
  - Be owned by LICENSE_PROGRAM_ID
  - Reference parent_ip
  - Allow derivatives
- Immutable except optional license update.
- No economic fields.
- No retroactive modification.

## Instructions

### create_derivative_link

- Requires parent_ip exists.
- Requires child_ip exists.
- license provided at creation.
- license.owner == caller_program_id.
- Requires child owner entity controller signature.
- Fails if already exists.

### update_derivative_license

- Optional.
- Does not mutate other fields.

No delete allowed.

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
4. All version increments must be validated before mutation.
5. All arithmetic must use checked_add.
