import type { ReactNode } from "react";
import { CopyButton } from "@/components/ui/CopyButton";

const KEYWORDS =
  /\b(select|from|where|group\s+by|order\s+by|limit|offset|join|left\s+join|right\s+join|inner\s+join|outer\s+join|on|as|and|or|not|in|is|null|distinct|having|with|union|all|case|when|then|else|end|asc|desc|between|interval|filter|over|partition\s+by)\b/gi;
const FUNCTIONS = /\b(count|sum|avg|min|max|coalesce|now|date_trunc|generate_series|extract|round|abs|nullif|greatest|least|to_char|cast)\s*\(/gi;

type Token = { text: string; kind: "kw" | "fn" | "str" | "num" | "cmt" | "plain" };

/** Pure: split SQL into coloured tokens. Strings and comments win over keywords, so a quoted word stays a string. */
export function tokenizeSql(sql: string): Token[] {
  const tokens: Token[] = [];
  const master = /('(?:[^']|'')*')|(--[^\n]*)|(\/\*[\s\S]*?\*\/)|(\b\d+(?:\.\d+)?\b)/g;
  let last = 0;
  const pushPlain = (text: string) => {
    if (text.length === 0) return;
    let index = 0;
    const marks: { start: number; end: number; kind: "kw" | "fn" }[] = [];
    for (const match of text.matchAll(KEYWORDS)) marks.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, kind: "kw" });
    for (const match of text.matchAll(FUNCTIONS)) marks.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length - 1, kind: "fn" });
    marks.sort((left, right) => left.start - right.start);
    for (const mark of marks) {
      if (mark.start < index) continue;
      if (mark.start > index) tokens.push({ text: text.slice(index, mark.start), kind: "plain" });
      tokens.push({ text: text.slice(mark.start, mark.end), kind: mark.kind });
      index = mark.end;
    }
    if (index < text.length) tokens.push({ text: text.slice(index), kind: "plain" });
  };
  for (const match of sql.matchAll(master)) {
    const index = match.index ?? 0;
    pushPlain(sql.slice(last, index));
    const [whole, string, lineComment, blockComment, number] = match;
    tokens.push({ text: whole, kind: string ? "str" : lineComment || blockComment ? "cmt" : number ? "num" : "plain" });
    last = index + whole.length;
  }
  pushPlain(sql.slice(last));
  return tokens;
}

const CLASS: Record<Token["kind"], string> = { kw: "tok-kw", fn: "tok-fn", str: "tok-str", num: "tok-num", cmt: "tok-cmt", plain: "" };

export interface SqlBlockProps {
  sql: string;
  label?: string;
  actions?: ReactNode;
}

/** The generated SQL is always visible, valid or not (Design.md §4). */
export function SqlBlock({ sql, label = "Generated SQL", actions }: SqlBlockProps) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs text-fg-muted">{label}</h3>
        <div className="flex items-center gap-2">
          {actions}
          <CopyButton text={sql} />
        </div>
      </div>
      <pre className="scroll-thin max-h-64 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-xs leading-5">
        <code>
          {tokenizeSql(sql).map((token, index) => (
            <span key={index} className={CLASS[token.kind]}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
