# Plan: Minimal License Program Instructions

**TL;DR:** Create a canonical instruction file for a minimal license program at `.github/instructions/license.instructions.md`. The program uses a **two-layer model**:

1. **License** — Global per IP (`["license", origin_ip]`), defines terms
2. **LicenseGrant** — Per grantee (`["license_grant", license, grantee_entity]`), tracks who acquired the license

This enables `ip_core`'s `create_derivative_link` to validate that the derivative creator actually holds a valid license grant.

---

## Steps

1. **Define GLOBAL PROTOCOL INVARIANTS** — Mirror the neutrality/determinism constraints from `ip_core`:

   - No royalty/economic logic
   - All accounts PDA-derived with `bump`
   - No reinitialization

2. **Define CONSTANT LIMITS** — Add any string/buffer field limits if needed (minimal for v1)

3. **Specify ERROR MODEL** — Define explicit errors:

   - `LicenseAlreadyExists`
   - `LicenseGrantAlreadyExists`
   - `Unauthorized`
   - `InvalidOriginIp`
   - `DerivativeCannotCreateLicense`
   - `LicenseNotFound`
   - `LicenseGrantNotFound`
   - `GrantExpired`
   - `DerivativesNotAllowed`

4. **Document License Account** (global terms):

   - PDA Seeds: `["license", origin_ip]`
   - Required fields: `origin_ip`, `derivatives_allowed`, `bump`
   - Invariants:
     - `origin_ip` must reference a valid **non-derivative** IP account
     - Derivative IPs inherit licensing terms from their parent — they cannot create independent licenses
     - License never expires (immutable terms)
   - Additional fields: `authority` (IP owner who created it), `created_at`
   - Space calculation

5. **Document LicenseGrant Account** (per-grantee acquisition):

   - PDA Seeds: `["license_grant", license, grantee_entity]`
   - Required fields: `license`, `grantee`, `granted_at`, `expiration`, `bump`
   - Invariants:
     - `license` must reference a valid License account
     - `grantee` must reference a valid Entity account
     - `expiration` = 0 means no expiration; otherwise unix timestamp

6. **Document Instructions**:

   **License Instructions:**

   - `create_license` — IP owner creates license for their IP
     - Validates signer owns the `origin_ip` via Entity multisig
     - Validates `origin_ip` is NOT a derivative IP (has no parent)
     - Sets `derivatives_allowed`
   - `update_license` — IP owner updates mutable fields
     - Only `derivatives_allowed` is mutable
   - `revoke_license` (optional) — Close license account (only if no active grants?)

   **LicenseGrant Instructions:**

   - `create_license_grant` — Grant license to an Entity
     - Validates license exists
     - Creates grant linking grantee Entity to the License
     - Sets `expiration` for the grant (0 = no expiration)
     - Optional: payment logic could be added here (but kept minimal for v1)
   - `revoke_license_grant` — Close grant account
     - Only license authority (IP owner) can revoke

7. **Define INSTRUCTION → ACCOUNT MUTATION MAP** — Table format per `ip_core` conventions

   | Instruction          | Accounts Mutated     |
   | -------------------- | -------------------- |
   | create_license       | License              |
   | update_license       | License              |
   | revoke_license       | License (close)      |
   | create_license_grant | LicenseGrant         |
   | revoke_license_grant | LicenseGrant (close) |

8. **Add folder structure reference** — Describe program layout under `programs/license/`

---

## ip_core Integration

`ip_core`'s `create_derivative_link` currently validates a License account directly. With the two-layer model:

**Option A:** `ip_core` validates `LicenseGrant` (preferred)

- Pass `LicenseGrant` account to `create_derivative_link`
- `ip_core` checks: grant exists, grant not expired, license.derivatives_allowed == true

**Option B:** Keep existing validation, add grant check

- `ip_core` validates License + requires LicenseGrant as additional account
- More complex but backward-compatible

**Recommendation:** Update `ip_core` to validate `LicenseGrant` instead of `License` for derivative creation.

**Note:** Since licenses never expire, only the grant's `expiration` is checked.

---

## Verification

- Confirm License PDAs are deterministic from `origin_ip` alone
- Confirm LicenseGrant PDAs are deterministic from `license` + `grantee_entity`
- Validate integration with `ip_core::create_derivative_link`
- Ensure the instructions file follows the same format as `ip-core.instructions.md`

---

## Decisions

- **Two-layer model:** License (terms) + LicenseGrant (per-entity acquisition)
- **Global License per IP:** PDA seeds `["license", origin_ip]` — one license per IP asset
- **Per-grantee grants:** PDA seeds `["license_grant", license, grantee_entity]`
- **No royalty/economic fields:** Minimal struct, payment logic deferred
- **Authority field:** Tracks IP owner for updates/revocations
- **License never expires:** Only grants can expire; license terms are permanent
- **Derivative IPs cannot create licenses:** Derivatives inherit parent IP's licensing — enforces chain of rights
