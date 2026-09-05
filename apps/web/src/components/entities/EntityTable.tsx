"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/Table";
import { useNow } from "@/lib/useNow";

export interface Column<T> {
  header: string;
  numeric?: boolean;
  mono?: boolean;
  /** `now` is null until hydration, so a cell can render an absolute time on the server. */
  render: (row: T, now: number | null) => ReactNode;
}

export interface EntityTableProps<T> {
  rows: readonly T[];
  columns: readonly Column<T>[];
  keyOf: (row: T) => string;
  empty: { title: string; body: string };
}

/** Shared table for the subscription and invoice views (Checklist 21 files). */
export function EntityTable<T>({ rows, columns, keyOf, empty }: EntityTableProps<T>) {
  const now = useNow();
  if (rows.length === 0) return <EmptyState title={empty.title} body={empty.body} />;
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            {columns.map((column) => (
              <Th key={column.header} numeric={column.numeric}>
                {column.header}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Tr key={keyOf(row)}>
              {columns.map((column) => (
                <Td key={column.header} numeric={column.numeric} mono={column.mono}>
                  {column.render(row, now)}
                </Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
