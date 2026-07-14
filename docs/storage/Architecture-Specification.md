# Enterprise Storage Architecture Specification

This document details the architectural rules and policies governing any Storage Provider integrated into the WACRM Runtime Platform.

## 1. Provider Registration & Factory Pattern
The Runtime Engine does not instantiate databases directly. It expects an instance that implements the `IStorageManager` interface to be injected via the `StorageFactory`.

### Registration Flow
1. **App Boot**: React Native / DOM boots.
2. **Factory Invocation**: `StorageFactory.createProvider('watermelon')` is called.
3. **Registry Lookup**: The Factory looks up the requested provider class in the `StorageRegistry`.
4. **Instantiation**: The Provider is instantiated but **not** initialized.
5. **Runtime Injection**: `SyncCenter.initializePlatform({ storage: provider, ... })` is called.

## 2. Storage Lifecycle

Every Provider must rigidly follow this lifecycle state machine:

1. **`INSTANTIATED`**: Class constructed, no DB handles open.
2. **`INITIALIZING`**: Runtime calls `provider.initialize()`.
3. **`MIGRATING`**: Provider checks schema version vs physical DB. If newer, it executes migrations safely.
4. **`VALIDATING`**: Performs a quick health check / `PRAGMA integrity_check`.
5. **`READY`**: Provider sets its state to Ready. Runtime begins syncing operations.
6. **`SHUTTING_DOWN`**: Runtime calls `provider.shutdown()`. Provider flushes WAL, waits for active transactions to commit, and closes handles.
7. **`CLOSED`**: Provider safely dead.

**Recovery Flow:**
If initialization fails (e.g. Corrupt DB), the Provider emits a `HealthFailureError`. The Runtime intercepts this and delegates to `StorageRecoveryManager` which can prompt the user to wipe the DB and perform a full initial sync.

## 3. Storage Transactions

Transactions are the lifeblood of data integrity. Providers must adhere to the following policies:

- **ACID Policy:** Transactions must be fully ACID compliant. If step 3 of a 5-step transaction fails, steps 1 and 2 MUST rollback completely.
- **Worker Thread Policy:** Because future databases (like WatermelonDB) might execute on a Web Worker or native background thread, transactions must accept pure JSON `SerializableIntent` payloads, rather than JS callback closures, minimizing thread-boundary serialization costs.
- **Isolation Policy:** Default isolation level is `READ COMMITTED`.
- **Batching vs Transactions:** `provider.batch()` differs from `provider.transaction()`. Batching is for bulk blind-inserts (e.g. initial sync) where locking the whole DB for ACID checks is too slow.

## 4. Capability Negotiation

Providers differ in strength. SQLite has Transactions. IndexedDB does not have FTS.
When the Runtime boots, it calls `provider.capabilities()`. 

If the Runtime attempts a Full Text Search, but `capabilities.fullTextSearch` is `false`, the Runtime must gracefully degrade (e.g. using a regex filter instead) or throw a controlled `CapabilityMissingError`.
