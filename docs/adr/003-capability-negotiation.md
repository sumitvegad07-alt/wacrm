# ADR 003: Capability Negotiation

**Date**: 2026-07-14
**Status**: Accepted

## Context
Not all databases support the same features. For instance, WatermelonDB on iOS uses SQLite (which has Full Text Search), but WatermelonDB on Web uses IndexedDB (which does not). If the Runtime hardcodes FTS queries, the web app will crash.

## Decision
Every Provider must return a `StorageCapabilities` matrix via `IStorageManager.capabilities()`. The Runtime and UI layers must check this matrix before attempting advanced operations (like `streaming` or `deltaSync`). If a capability is missing, the application must gracefully degrade (e.g. falling back to simple regex filtering instead of FTS).

## Consequences
- **Pros:** The same codebase can run on a weak Web IndexedDB and a powerful Native SQLite without crashing.
- **Cons:** Developers must write fallback logic for missing capabilities.
