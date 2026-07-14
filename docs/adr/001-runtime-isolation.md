# ADR 001: Strict Runtime Isolation

**Date**: 2026-07-14
**Status**: Accepted

## Context
Mobile database technologies evolve rapidly. Over the last 5 years, the standard has shifted from AsyncStorage -> Realm -> SQLite -> WatermelonDB -> PowerSync. If the Runtime's Queue engine or Business Logic directly imports or couples with a specific database ORM (e.g., using Watermelon's `@nozbe/watermelondb` decorators inside business models), migrating to a new database in the future requires rewriting the entire application.

## Decision
The Runtime Platform is strictly forbidden from importing, knowing, or caring about the underlying database technology. All interactions must funnel through the `IStorageManager` interface. The Runtime passes plain Javascript Objects (POJOs) and pure JSON intents. It is the responsibility of the Concrete Provider (e.g., `WatermelonDBProvider`) to translate these POJOs into database-specific ORM models or SQL statements.

## Consequences
- **Pros:** We can swap WatermelonDB for PowerSync in 3 years by writing a single new adapter class. Zero business logic or sync logic will change.
- **Cons:** We lose the ability to use database-specific ORM magic (like reactive UI hooks directly bound to WatermelonDB models) out of the box without building an abstraction wrapper for the UI layer as well.
