/** Loading placeholders. Shimmer stops under prefers-reduced-motion (globals.css). */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={`h-4 ${index % 3 === 0 ? "w-2/3" : index % 3 === 1 ? "w-5/6" : "w-1/2"}`} />
      ))}
    </div>
  );
}
