# Mycelium IP Protocol – Global Copilot Instructions

This repository contains the on-chain programs for **Mycelium IP Protocol**, a deterministic, neutral IP claim registry built on Solana.

These instructions define architectural guardrails for all programs in this repository.

---

# 1. Architectural Philosophy

The protocol is split into independent programs:

1. Core IP Registry Program (v1)
2. Dispute Program (optional, separate)
3. Licensing / Royalty Modules (optional, separate)

Programs MUST NOT share mutable state.

The Core IP Registry is intentionally:

- Neutral
- Deterministic
- Minimal
- Non-economic
- Non-governance

The Core Program MUST NOT implement:

- Royalty logic
- Payment distribution
- Arbitration logic
- Authorship validation
- Content verification
- Account freezing
- Governance mechanisms

---

# 2. Deterministic Design Requirements

All programs must follow:

- All accounts MUST be PDA-derived.
- No randomness.
- No nonce-based identity derivation.
- No clock-based uniqueness logic.

Account identity must be fully deterministic from seeds.

---

# 3. Core Protocol Invariants

These must never be violated:

1. IP PDA = deterministic from (registrant_entity, content_hash)
2. content_hash is immutable after creation
3. Ownership transfer does NOT change PDA
4. Reverse ownership index must always reflect current ownership
5. Registry does NOT determine authorship truth

---

# 4. Anchor Development Constraints

When generating code:

- Use Anchor 0.32+ conventions.
- Use explicit `#[account(seeds = [...], bump)]` constraints.
- Never use unchecked arithmetic.
- Avoid unbounded Vec growth.
- Avoid account realloc unless strictly required.
- Prefer fixed-size fields when possible.
- All instruction handlers must be minimal and deterministic.

---

# 5. Security Philosophy

The Core Registry only records claims.

It does NOT:

- Guarantee originality
- Prevent duplicates across different registrants
- Resolve disputes

It is a deterministic state machine, not a legal authority.

All logic must preserve this neutrality.
