// Intent: keep legacy script imports pointed at the single canonical scenario definition in the shared package.
// Flow: resolve shared scenario builders relatively from scripts/ -> re-export their runtime values and types unchanged.
export * from '../../packages/shared/src/sim/scenarios';
