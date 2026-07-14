# Storage Architecture Diagrams

## 1. Abstraction Layer (Component Diagram)

```mermaid
graph TD
    subgraph WACRM Mobile App
        UI[React Native UI]
    end

    subgraph Runtime Platform EWO-003
        SC[SyncCenter]
        SQ[SyncQueue]
        DQ[DependencyQueue]
        TM[TransactionManager]
    end

    subgraph Storage Abstraction EWO-004A
        ISM((IStorageManager))
        SF[StorageFactory]
    end

    subgraph Concrete Providers EWO-004B
        WMDB[WatermelonDBProvider]
        SQL[SQLiteProvider]
        MOCK[MockProvider]
    end

    UI --> SC
    SC --> SQ
    SC --> DQ
    SC --> TM

    TM --> ISM
    SQ --> ISM
    SF --> ISM

    ISM <|-- WMDB
    ISM <|-- SQL
    ISM <|-- MOCK
```

## 2. Provider Lifecycle (Sequence Diagram)

```mermaid
sequenceDiagram
    participant App as Mobile App
    participant SC as SyncCenter
    participant SF as StorageFactory
    participant DB as WatermelonProvider

    App->>SF: createProvider('watermelon')
    SF-->>App: providerInstance
    App->>SC: initializePlatform({ storage: providerInstance })
    
    SC->>DB: capabilities()
    DB-->>SC: { transactions: true, fts: true }
    
    SC->>DB: initialize()
    activate DB
    DB->>DB: checkVersion()
    DB->>DB: runMigrations()
    DB->>DB: validateSchema()
    DB->>DB: integrityCheck()
    DB-->>SC: resolve()
    deactivate DB
    
    SC->>App: Platform Ready
```

## 3. Storage Error Recovery Flow

```mermaid
stateDiagram-v2
    [*] --> Initializing
    Initializing --> Migrating
    Migrating --> MigrationFailed : Version Mismatch
    MigrationFailed --> RecoveryMode : Trigger Recovery Service
    RecoveryMode --> WipingDatabase : User Confirmed
    WipingDatabase --> Initializing : Fresh Boot
    
    Migrating --> Validating
    Validating --> HealthFailure : Corruption Detected
    HealthFailure --> RecoveryMode
    
    Validating --> Ready
    Ready --> Degraded : Disk Full / High Latency
    Ready --> [*] : Shutdown
```
