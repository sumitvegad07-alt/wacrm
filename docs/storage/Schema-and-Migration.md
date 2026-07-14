# Storage Schema & Migration Architecture

In a 10-year multi-tenant SaaS application, the database schema will evolve hundreds of times. The Storage Provider must manage this evolution flawlessly.

## Versioning System

The architecture relies on a triad of versions stored in the DB metadata tables:
1. **Engine Version**: The physical DB version (e.g., SQLite 3.39.2).
2. **Provider Version**: The version of the JS bridging driver.
3. **Schema Version**: The logical schema defining the Tables (e.g., v12).

## Migration Flow

During `IStorageManager.initialize()`:
1. The Provider reads the persistent physical Schema Version (e.g., `v10`).
2. It compares it to the Application's compiled Schema Version (e.g., `v12`).
3. If `App Version > Physical Version`:
   - It acquires a strict exclusive lock on the database.
   - It iterates through the migration scripts sequentially (`10->11`, `11->12`).
   - If any script fails, the Provider issues a **Rollback** to the initial state (v10).
   - Throws a `MigrationError`.
4. If `App Version < Physical Version`:
   - This occurs if a user downgrades their App via TestFlight/APK.
   - The Provider MUST throw a `SchemaMismatchError` to prevent the older app from corrupting the newer DB schema.

## Schema Validation
After migrations, the Provider runs a structural validation checking that core tables (e.g. `_sys_sync_queue`) exist and have the correct column types before returning `READY`.
