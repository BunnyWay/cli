import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { SQLite, sql } from "@codemirror/lang-sql";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { statementAt } from "@/lib/sql";

const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "12px",
      backgroundColor: "var(--background)",
      color: "var(--foreground)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      lineHeight: "1.6",
    },
    ".cm-content": { caretColor: "var(--primary)" },
    ".cm-cursor": { borderLeftColor: "var(--primary)" },
    ".cm-gutters": {
      backgroundColor: "var(--card)",
      color: "var(--muted-foreground)",
      border: "none",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: "color-mix(in oklch, var(--muted) 45%, transparent)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
      {
        backgroundColor: "color-mix(in oklch, var(--primary) 28%, transparent)",
      },
    ".cm-matchingBracket": {
      backgroundColor: "color-mix(in oklch, var(--primary) 25%, transparent)",
      outline: "none",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
      border: "1px solid var(--border)",
      borderRadius: "6px",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--foreground)",
    },
    ".cm-placeholder": { color: "var(--muted-foreground)" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--primary)" },
  { tag: [t.string, t.special(t.string)], color: "oklch(0.8 0.13 150)" },
  { tag: [t.number, t.bool, t.null], color: "oklch(0.8 0.11 220)" },
  { tag: t.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [t.typeName, t.standard(t.name)], color: "oklch(0.8 0.1 300)" },
  {
    tag: [t.operator, t.punctuation, t.bracket],
    color: "var(--muted-foreground)",
  },
]);

/**
 * CodeMirror with SQLite highlighting and completion from the schema.
 * Cmd/Ctrl+Enter runs the selection, or the statement under the cursor.
 */
export function SqlEditor({
  value,
  onChange,
  onRun,
  schema,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: (sql: string) => void;
  /** Table and view names to their columns, for autocomplete. */
  schema: Record<string, string[]>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const language = useRef(new Compartment());
  // Handlers change every render; the editor reads the latest through refs.
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the editor is created once; value and schema sync below
  useEffect(() => {
    if (!hostRef.current) return;
    const run = (view: EditorView) => {
      const { from, to, empty, head } = view.state.selection.main;
      const doc = view.state.doc.toString();
      onRunRef.current(empty ? statementAt(doc, head) : doc.slice(from, to));
      return true;
    };
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(keymap.of([{ key: "Mod-Enter", run }])),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          language.current.of(
            sql({ dialect: SQLite, schema, upperCaseKeywords: true }),
          ),
          syntaxHighlighting(highlight),
          theme,
          placeholder("SELECT * FROM …"),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    view.focus();
    return () => view.destroy();
  }, []);

  // Outside changes (history, "open view") replace the document.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: value.length },
    });
    view.focus();
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: language.current.reconfigure(
        sql({ dialect: SQLite, schema, upperCaseKeywords: true }),
      ),
    });
  }, [schema]);

  return <div ref={hostRef} className="h-full overflow-hidden" />;
}
