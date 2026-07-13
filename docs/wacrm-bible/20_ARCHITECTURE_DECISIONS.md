*WACRM Engineering Bible* > *AIOS Standards* > *Architecture Decision Records (ADR)*
[← 19_SPRINT_TEMPLATE](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/19_SPRINT_TEMPLATE.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [21_CODING_STANDARDS →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/21_CODING_STANDARDS.md)
---

# WACRM AIOS - Architecture Decision Records (ADR)

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
This document establishes the Architecture Decision Record (ADR) system for WACRM. 
**Why it exists:** Memory fades. In 3 years, a new engineer will ask, "Why did we use WatermelonDB instead of Realm for offline sync?" The ADR prevents repeating past mistakes and explains the tradeoffs that were accepted at the time.
**Who uses it:** Principal Architects and Senior Engineers.
**When to use it:** Whenever introducing a new technology, changing a fundamental pattern (e.g., switching from REST to GraphQL), or making a decision that is hard to reverse.

---

## 2. ADR Template
Every ADR must be saved as a Markdown file in `docs/architecture/` using the naming convention `ADR-00X-[Short-Title].md`.

```markdown
# ADR-00X: [Title]

## 1. Context
What is the business or technical force prompting this decision? 
*Example: Field agents are losing data when punching out in rural areas with zero cell reception.*

## 2. Problem
What exactly are we trying to solve?
*Example: Supabase JS throws a network error and drops the mutation if offline. We need a local queue.*

## 3. Options Considered
1. **Option A:** Write custom Async Storage queues.
2. **Option B:** Adopt WatermelonDB (SQLite).
3. **Option C:** Adopt PowerSync.

## 4. Decision
What did we choose? 
*Example: We chose WatermelonDB.*

## 5. Consequences & Trade-offs
What is the cost of this decision?
*Example: Positive: Agents never lose data. Negative: Adds 5MB to the app bundle size and requires us to write complex migration schemas in React Native.*

## 6. Status
[Proposed | Accepted | Deprecated | Superseded by ADR-00Y]
```

## 3. Anti-Patterns
- **The "Ninja" Decision:** Changing the state management library (e.g., from React Context to Zustand) in a random Pull Request without an ADR.
- **The "No Drawbacks" ADR:** Writing an ADR that lists zero negative consequences. Every architectural decision has a trade-off (usually speed vs complexity vs cost).
