// Compiles src/ to dist/ for publishing (run only at publish time; see AGENTS.md "Publishing").

import { cp } from "node:fs/promises";
import ts from "typescript";

const root = new URL("..", import.meta.url).pathname;
const dist = `${root}dist`;
const configPath = `${root}tsconfig.build.json`;

// Rewrite a relative `.ts`/`.d.ts` specifier to its emitted `.js` sibling (TS resolves it against the `.d.ts`).
function rewriteSpecifier(specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  for (const ext of [".d.ts", ".ts"]) {
    if (specifier.endsWith(ext)) return `${specifier.slice(0, -ext.length)}.js`;
  }
  return specifier;
}

// afterDeclarations transformer: fix specifiers on import/export-from and inline import("...") type nodes.
const rewriteDeclarationSpecifiers: ts.TransformerFactory<
  ts.SourceFile | ts.Bundle
> = (context) => {
  const { factory } = context;
  const visit = (node: ts.Node): ts.Node => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      return factory.updateImportDeclaration(
        node,
        node.modifiers,
        node.importClause,
        factory.createStringLiteral(
          rewriteSpecifier(node.moduleSpecifier.text),
        ),
        node.attributes,
      );
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      return factory.updateExportDeclaration(
        node,
        node.modifiers,
        node.isTypeOnly,
        node.exportClause,
        factory.createStringLiteral(
          rewriteSpecifier(node.moduleSpecifier.text),
        ),
        node.attributes,
      );
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      return factory.updateImportTypeNode(
        node,
        factory.createLiteralTypeNode(
          factory.createStringLiteral(
            rewriteSpecifier(node.argument.literal.text),
          ),
        ),
        node.attributes,
        node.qualifier,
        node.typeArguments,
        node.isTypeOf,
      );
    }
    return ts.visitEachChild(node, visit, context);
  };
  return (sourceFile) =>
    ts.visitNode(sourceFile, visit) as ts.SourceFile | ts.Bundle;
};

function reportDiagnostics(diagnostics: readonly ts.Diagnostic[]): void {
  if (diagnostics.length === 0) return;
  const host: ts.FormatDiagnosticsHost = {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  };
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
  process.exit(1);
}

// 1. Emit JS + declarations.
const parsed = ts.getParsedCommandLineOfConfigFile(
  configPath,
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => reportDiagnostics([d]),
  },
);
if (!parsed) {
  console.error(`Could not read ${configPath}`);
  process.exit(1);
}

const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options,
});
reportDiagnostics(ts.getPreEmitDiagnostics(program));

const emitResult = program.emit(undefined, undefined, undefined, false, {
  afterDeclarations: [rewriteDeclarationSpecifiers],
});
reportDiagnostics(emitResult.diagnostics);

// 2. Ship the generated declaration files (tsc does not emit its inputs).
await cp(`${root}src/generated`, `${dist}/generated`, { recursive: true });

console.log("build: emitted dist/, copied generated declarations");
