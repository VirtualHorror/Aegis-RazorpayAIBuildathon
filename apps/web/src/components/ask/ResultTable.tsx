import { Table, TableWrap, Td, Th, Tr } from "@/components/ui/Table";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isNumeric(value: unknown): boolean {
  return typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
}

/**
 * Rows exactly as the read-only role returned them.
 * Intent: the money columns are raw paise from SQL, so they are shown as returned rather than reformatted — the header
 *         names the column, and inventing a rupee symbol here would misreport what the query asked for.
 */
export function ResultTable({ rows }: { rows: readonly Record<string, unknown>[] }) {
  if (rows.length === 0) return <p className="text-sm text-fg-muted">The query ran and returned no rows.</p>;
  const columns = Object.keys(rows[0] ?? {});
  return (
    <TableWrap className="max-h-96 overflow-y-auto">
      <Table>
        <thead>
          <tr>
            {columns.map((column) => (
              <Th key={column} numeric={isNumeric(rows[0]?.[column])}>
                {column}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Tr key={index}>
              {columns.map((column) => (
                <Td key={column} numeric={isNumeric(row[column])} mono>
                  {cell(row[column])}
                </Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
