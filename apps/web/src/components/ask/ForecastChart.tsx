import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { formatDate } from "@/lib/format";
import type { AskForecastResponse } from "@/lib/types";

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 56 };

export interface ChartScale {
  x: (index: number) => number;
  y: (value: number) => number;
  min: number;
  max: number;
}

/** Pure: map a series of n points and a value range onto the plot area. */
export function chartScale(count: number, min: number, max: number): ChartScale {
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const span = max - min || 1;
  return {
    x: (index) => PAD.left + (count <= 1 ? innerWidth / 2 : (index / (count - 1)) * innerWidth),
    y: (value) => PAD.top + innerHeight - ((value - min) / span) * innerHeight,
    min,
    max,
  };
}

function niceNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `${(value / 10_000_000).toFixed(1)}cr`;
  if (abs >= 100_000) return `${(value / 100_000).toFixed(1)}L`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(abs < 10 ? 1 : 0);
}

/**
 * History line, forecast line and the residual band. Hand-rolled SVG: no chart dependency (Checklist 20 note).
 * Numbers are repeated in a table below so the chart is never the only way to read them (Design.md §8).
 */
export function ForecastChart({ answer }: { answer: AskForecastResponse }) {
  const history = answer.series;
  const forecast = answer.forecast.points;
  if (history.length === 0) return <p className="text-sm text-fg-muted">No history is available for this metric yet.</p>;
  const values = [...history.map((point) => point.value), ...forecast.flatMap((point) => [point.lower, point.upper, point.value])];
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const scale = chartScale(history.length + forecast.length, min, max);
  const historyPath = history.map((point, index) => `${index === 0 ? "M" : "L"}${scale.x(index)},${scale.y(point.value)}`).join(" ");
  const forecastStart = history.length - 1;
  const forecastPath = [`M${scale.x(forecastStart)},${scale.y(history.at(-1)?.value ?? 0)}`, ...forecast.map((point, index) => `L${scale.x(forecastStart + index + 1)},${scale.y(point.value)}`)].join(" ");
  const bandPath = [
    `M${scale.x(forecastStart)},${scale.y(history.at(-1)?.value ?? 0)}`,
    ...forecast.map((point, index) => `L${scale.x(forecastStart + index + 1)},${scale.y(point.upper)}`),
    ...[...forecast].reverse().map((point, index) => `L${scale.x(forecastStart + forecast.length - index)},${scale.y(point.lower)}`),
    "Z",
  ].join(" ");

  return (
    <div>
      <div className="scroll-thin overflow-x-auto">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full min-w-[520px]" role="img" aria-label={`${answer.metric} history and ${forecast.length}-day forecast, method ${answer.forecast.method}`}>
          {[0, 0.5, 1].map((fraction) => {
            const value = min + (max - min) * fraction;
            const y = scale.y(value);
            return (
              <g key={fraction}>
                <line x1={PAD.left} y1={y} x2={WIDTH - PAD.right} y2={y} stroke="var(--border)" strokeWidth="1" />
                <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="fill-[var(--fg-muted)] font-mono text-[10px]">
                  {niceNumber(value)}
                </text>
              </g>
            );
          })}
          <path d={bandPath} fill="var(--accent)" opacity="0.15" />
          <path d={historyPath} fill="none" stroke="var(--fg)" strokeWidth="2" />
          <path d={forecastPath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4" />
          <line x1={scale.x(forecastStart)} y1={PAD.top} x2={scale.x(forecastStart)} y2={HEIGHT - PAD.bottom} stroke="var(--border)" strokeDasharray="3 3" />
          <text x={PAD.left} y={HEIGHT - 6} className="fill-[var(--fg-muted)] font-mono text-[10px]">
            {history[0] ? formatDate(history[0].date) : ""}
          </text>
          <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-[var(--fg-muted)] font-mono text-[10px]">
            {forecast.at(-1) ? formatDate(forecast.at(-1)!.date) : ""}
          </text>
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 bg-fg" /> history
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 border-t-2 border-dashed border-accent" /> forecast ({answer.forecast.method})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-4 bg-accent opacity-20" /> ± one residual standard deviation
        </span>
        <span>r² {answer.forecast.r2.toFixed(2)}</span>
        <span>slope {answer.forecast.slopePerDay.toFixed(1)}/day</span>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-fg-muted">Forecast numbers</summary>
        <div className="scroll-thin mt-2 max-h-64 overflow-auto rounded-xl border border-border">
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th numeric>Forecast</Th>
                <Th numeric>Lower</Th>
                <Th numeric>Upper</Th>
              </tr>
            </thead>
            <tbody>
              {forecast.map((point) => (
                <Tr key={point.date}>
                  <Td mono>{point.date}</Td>
                  <Td numeric mono>
                    {point.value.toFixed(0)}
                  </Td>
                  <Td numeric mono>
                    {point.lower.toFixed(0)}
                  </Td>
                  <Td numeric mono>
                    {point.upper.toFixed(0)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </details>
    </div>
  );
}
