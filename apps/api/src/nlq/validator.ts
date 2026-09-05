import { parseWithComments, type Statement } from 'pgsql-ast-parser';
import { READONLY_TABLES } from './schema-doc';

const READONLY_TABLE_SET = new Set<string>(READONLY_TABLES);
const DENIED_FUNCTIONS = new Set([
  'pg_sleep',
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'lo_import',
  'lo_export',
  'dblink',
  'copy',
  'set_config',
  'current_setting',
  'pg_terminate_backend',
  'pg_cancel_backend',
]);

export interface ValidSql {
  readonly ok: true;
  readonly sql: string;
}

export interface InvalidSql {
  readonly ok: false;
  readonly errors: string[];
}

export type ValidationResult = ValidSql | InvalidSql;

/**
 * Validate model-authored SQL before it reaches PostgreSQL.
 * Intent: AST checks are the security boundary; string checks are limited to statement framing and never decide
 *         which columns or tables may be read.
 * Flow: parse all statements -> require one SELECT/SELECT-only CTE -> inspect table schemas and function calls -> wrap
 *       the original statement in a hard row limit for the readonly transaction.
 */
export function validateSql(input: string): ValidationResult {
  const sql = input.trim();
  if (sql.length === 0) return invalid('query is empty');
  if (hasUnexpectedSemicolon(sql)) return invalid('exactly one SQL statement is required');

  let statements: Statement[];
  try {
    const parsed = parseWithComments(sql);
    // Intent: comments can hide statement terminators and become invalid when the statement is wrapped below.
    // Flow: reject parser-recognised comments before table/function checks; string literals are not comments.
    if (parsed.comments.length > 0) return invalid('comments are not allowed');
    statements = parsed.ast;
  } catch (error) {
    return invalid(`sql_parse_error: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (statements.length !== 1) return invalid('exactly one SQL statement is required');
  const statement = statements[0];
  if (!statement || !isSelectOnly(statement)) return invalid('only SELECT statements are allowed');

  const errors: string[] = [];
  const cteNames = collectCteNames(statement);
  walk(statement, (node) => {
    if (!isRecord(node)) return;
    if (node.type === 'table' && isRecord(node.name)) {
      const name = stringValue(node.name.name);
      const schema = stringValue(node.name.schema);
      if (!name) return;
      const normalizedSchema = schema?.toLowerCase();
      const normalizedName = name.toLowerCase();
      if (normalizedSchema === 'pg_catalog' || normalizedSchema === 'information_schema') {
        errors.push(`schema is not allowed: ${schema}`);
      } else if (schema && normalizedSchema !== 'public') {
        errors.push(`schema-qualified table is not allowed: ${schema}.${name}`);
      } else if (!READONLY_TABLE_SET.has(normalizedName) && !cteNames.has(normalizedName)) {
        errors.push(`table is not allowlisted: ${name}`);
      }
    }
    if (node.type === 'call' && isRecord(node.function)) {
      const functionName = stringValue(node.function.name)?.toLowerCase();
      if (functionName && DENIED_FUNCTIONS.has(functionName)) errors.push(`function is not allowed: ${functionName}`);
      const functionSchema = stringValue(node.function.schema)?.toLowerCase();
      if (functionSchema === 'pg_catalog' || functionSchema === 'information_schema') {
        errors.push(`function schema is not allowed: ${functionSchema}`);
      }
    }
    if (node.type === 'ref' && isRecord(node.table)) {
      const schema = stringValue(node.table.schema)?.toLowerCase();
      if (schema === 'pg_catalog' || schema === 'information_schema') errors.push(`schema is not allowed: ${schema}`);
    }
  });

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  // A trailing semicolon is a statement terminator, but retaining it inside the derived table would be invalid SQL.
  const normalizedSql = sql.replace(/;\s*$/, '').trim();
  return { ok: true, sql: `SELECT * FROM (${normalizedSql}) AS q LIMIT 200` };
}

export const validate = validateSql;

function invalid(...errors: string[]): InvalidSql {
  return { ok: false, errors };
}

function isSelectOnly(statement: unknown): boolean {
  if (!isRecord(statement) || typeof statement.type !== 'string') return false;
  switch (statement.type) {
    case 'select':
      return true;
    case 'union':
    case 'union all':
      return isSelectOnly(statement.left) && isSelectOnly(statement.right);
    case 'with':
      return Array.isArray(statement.bind)
        && statement.bind.every((binding) => isRecord(binding) && isSelectOnly(binding.statement))
        && isSelectOnly(statement.in);
    case 'with recursive':
      return isSelectOnly(statement.bind) && isSelectOnly(statement.in);
    default:
      return false;
  }
}

function collectCteNames(statement: unknown): Set<string> {
  const names = new Set<string>();
  walk(statement, (node) => {
    if (!isRecord(node) || (node.type !== 'with' && node.type !== 'with recursive') || !Array.isArray(node.bind)) return;
    for (const binding of node.bind) {
      if (!isRecord(binding) || !isRecord(binding.alias)) continue;
      const alias = stringValue(binding.alias.name);
      if (alias) names.add(alias.toLowerCase());
    }
  });
  return names;
}

function walk(value: unknown, visit: (node: unknown) => void, seen = new Set<object>()): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, seen);
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  visit(value);
  for (const child of Object.values(value)) walk(child, visit, seen);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The AST parser discards empty statements around a valid statement (for example `;SELECT 1;;`).
 * Intent: enforce the one-statement contract before parsing so those discarded separators cannot become malformed
 *         derived-table SQL or bypass the statement-count check.
 * Flow: scan only SQL framing characters -> preserve semicolons inside quoted literals/dollar strings -> allow one
 *       optional terminal separator and reject every other separator.
 */
function hasUnexpectedSemicolon(sql: string): boolean {
  let quote: 'single' | 'double' | string | undefined;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];
    if (quote) {
      if (quote === 'single' && current === "'" && next === "'") {
        index += 1;
      } else if (quote === 'double' && current === '"' && next === '"') {
        index += 1;
      } else if (quote.startsWith('$') && sql.startsWith(quote, index)) {
        index += quote.length - 1;
        quote = undefined;
      } else if ((quote === 'single' && current === "'") || (quote === 'double' && current === '"')) {
        quote = undefined;
      }
      continue;
    }
    if (current === "'") {
      quote = 'single';
      continue;
    }
    if (current === '"') {
      quote = 'double';
      continue;
    }
    if (current === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match?.[0]) {
        quote = match[0];
        index += match[0].length - 1;
        continue;
      }
    }
    if (current === ';' && sql.slice(index + 1).trim().length > 0) return true;
  }
  return false;
}
