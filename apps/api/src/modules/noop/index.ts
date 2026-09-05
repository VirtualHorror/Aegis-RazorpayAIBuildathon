import type { ActionModule, ActionProposal, EventContext, GuardResult, ActionRow, ExecutionDeps, ExecutionResult } from '../../orchestrator/types';

/** Test seam and safe default module; it deliberately subscribes to no provider events. */
export class NoopModule implements ActionModule {
  readonly name = 'noop';
  readonly version = '1';
  readonly handles = [] as const;

  canHandle(_ctx: EventContext): boolean { return false; }
  async propose(_ctx: EventContext): Promise<ActionProposal | null> { return null; }
  guard(_proposal: ActionProposal, _ctx: EventContext): GuardResult {
    return { pass: false, rules: [{ rule: 'noop', limit: false, actual: true, pass: false, note: 'NoopModule never proposes actions' }], blockedReason: 'noop' };
  }
  async execute(_action: ActionRow, _ctx: EventContext, _deps: ExecutionDeps): Promise<ExecutionResult> {
    return { status: 'failed', result: {}, error: 'noop_module_cannot_execute' };
  }
}

export const noopModule = new NoopModule();
