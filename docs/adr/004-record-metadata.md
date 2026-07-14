# ADR 004: Standardized Record Metadata

**Date**: 2026-07-14
**Status**: Accepted

## Context
In a multi-tenant, offline-first system, records can be created offline by multiple users sharing a device. When syncing to the cloud, the backend needs to know exactly who created the record, which schema version it conforms to, and its sync lifecycle state to avoid resolving conflicts incorrectly.

## Decision
Every single table/collection in the storage provider MUST implement the `RecordMetadata` interface. This forces every row to track `tenant_id`, `user_id`, `sync_version`, `sync_status`, and timestamps. 

## Consequences
- **Pros:** Absolute data security. The SyncCenter can blindly query `WHERE tenant_id != activeTenant` to detect data bleed. Conflict resolution is deterministic based on `sync_version`.
- **Cons:** Storage overhead. Every row requires ~100-200 bytes of metadata overhead. In a DB with 1,000,000 records, this adds ~100MB of storage usage. Given modern mobile device constraints, this is an acceptable tradeoff for enterprise security.
