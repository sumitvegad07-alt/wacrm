# ADR 002: Provider Factory Pattern

**Date**: 2026-07-14
**Status**: Accepted

## Context
If the App directly instantiates `new WatermelonDBProvider()`, it tightly couples the startup sequence to the implementation. This makes unit testing the Runtime difficult (since the app forces the real DB).

## Decision
We will use a `StorageFactory` and `StorageRegistry`. The App requests a provider by string name: `StorageFactory.createProvider('watermelon')`. For the validation harness, we request `StorageFactory.createProvider('mock')`.

## Consequences
- **Pros:** 100% Dependency Injection. The Runtime Validation Harness (EWO-003A) remains entirely valid forever because it can just inject the mock provider.
- **Cons:** Slight boilerplate overhead during app initialization.
