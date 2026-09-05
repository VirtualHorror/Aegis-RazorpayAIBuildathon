import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

/** Tables scroll inside their container, never the page (C-F3). */
export function TableWrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card scroll-thin overflow-x-auto ${className}`}>{children}</div>;
}

export function Table({ children, className = "", ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={`w-full border-collapse text-[13px] ${className}`} {...rest}>
      {children}
    </table>
  );
}

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export function Th({ children, numeric = false, className = "", ...rest }: ThProps) {
  return (
    <th
      scope="col"
      className={`sticky top-0 z-[1] whitespace-nowrap bg-surface-2 px-3 py-2 text-xs font-medium text-fg-muted first:pl-4 last:pr-4 ${numeric ? "text-right" : "text-left"} ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  mono?: boolean;
}

export function Td({ children, numeric = false, mono = false, className = "", ...rest }: TdProps) {
  return (
    <td
      className={`border-t border-border px-3 py-2 align-top first:pl-4 last:pr-4 ${numeric ? "text-right tabular-nums" : ""} ${mono ? "font-mono text-xs" : ""} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}

export interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  interactive?: boolean;
}

export function Tr({ children, interactive = false, className = "", ...rest }: TrProps) {
  return (
    <tr className={`${interactive ? "cursor-pointer hover:bg-surface-2/60" : ""} ${className}`} {...rest}>
      {children}
    </tr>
  );
}
