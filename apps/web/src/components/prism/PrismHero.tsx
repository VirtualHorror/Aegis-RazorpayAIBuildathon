import { PrismStage } from "./PrismStage";

export interface PrismHeroProps {
  eventsIn: string;
  actionsOut: string;
}

/**
 * The Overview hero: the product's promise as one picture. One webhook stream enters the glass, seven
 * specialist modules leave it.
 *
 * The picture is vgpu's mesh-based prism pipeline (`gpu/`, `scene/`, `shaders/`) on a WebGPU canvas,
 * with a static SVG of the same scene underneath for devices without an adapter, and the module legend
 * over both — see `PrismStage.tsx`. The card forces the dark palette on itself with `.dark`, the way
 * `KitchenSink` forces a theme on a subtree, because coloured light only reads on a dark ground.
 */
export function PrismHero({ eventsIn, actionsOut }: PrismHeroProps) {
  return (
    <div className="dark card overflow-hidden text-fg">
      <div className="grid items-center gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-8">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">One stream in. Seven specialists out.</h2>
          <p className="mt-2 max-w-[46ch] text-sm text-fg-muted">
            Every action is proposed by code, bounded by guardrails and gated by a human when money is at stake.
          </p>

          <dl className="mt-6 flex items-stretch gap-5">
            <div className="flex flex-col-reverse">
              <dt className="mt-0.5 text-xs text-fg-muted">events in</dt>
              <dd className="font-mono text-2xl font-medium tabular-nums">{eventsIn}</dd>
            </div>
            <div className="w-px bg-border" aria-hidden />
            <div className="flex flex-col-reverse">
              <dt className="mt-0.5 text-xs text-fg-muted">actions out</dt>
              <dd className="font-mono text-2xl font-medium tabular-nums">{actionsOut}</dd>
            </div>
          </dl>
        </div>

        <PrismStage />
      </div>
    </div>
  );
}
