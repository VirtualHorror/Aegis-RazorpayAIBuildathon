// Intent: preserve the checklist's script-side import path without copying the canonical seeded ID implementation.
// Flow: resolve the shared package by relative path -> expose the same factory and prefix types to script callers.
export * from '../../packages/shared/src/sim/ids';
