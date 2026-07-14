# Storage Health Monitoring & Observability

A mobile database operating in hostile environments (low battery, forced background kills, out of disk space) will fail. The Storage Provider must be completely observable.

## 1. Storage States

The `IStorageManager.health()` check returns one of three states:
- **`healthy`**: The DB is responsive, WAL is a normal size, no corruption detected.
- **`degraded`**: The DB is functioning but under pressure (e.g. >95% disk full, query latency > 1000ms). The Runtime should pause background syncs and only process critical UI requests.
- **`corrupted`**: Structural damage detected (e.g., malformed SQLite header). Requires immediate wipe and full cloud-resync.

## 2. Telemetry Integration

The `IStorageManager.metrics()` endpoint provides standardized metrics that the `SyncCenter` pipes to Datadog/Sentry:
- `dbSizeBytes`: Total physical footprint.
- `transactionCount`: Throughput of ACID operations.
- `avgReadLatencyMs`: Health indicator for indexing effectiveness.
- `avgWriteLatencyMs`: Health indicator for WAL/Disk speed.
- `cacheHitRate`: Memory utilization efficiency.

## 3. Self-Healing (Vacuuming)

Mobile OS's do not auto-defragment SQLite databases. As records are deleted, the DB file size does not shrink; it leaves empty "pages". 
When the `SyncCenter` detects the app going into the background, it can call `IStorageManager.vacuum()` and `compact()` to reclaim free space, saving the user's phone storage.
