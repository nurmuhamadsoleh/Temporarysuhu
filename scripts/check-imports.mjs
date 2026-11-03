import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Resolve relative to this repository, independent of the caller's directory.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "tsconfig.json");
const errors = [];
if (!fs.existsSync(configPath)) {
  console.error(
    "tsconfig.json is missing. Include it in the source checkout/upload; @/ aliases require its paths configuration.",
  );
  process.exit(1);
}
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) {
  console.error(
    ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
  );
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
if (parsed.errors.length) {
  for (const error of parsed.errors)
    errors.push(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
}
const mapped = parsed.options.paths?.["@/*"];
const aliasRoot = parsed.options.baseUrl || root;
if (
  !mapped?.some(
    (p) => path.resolve(aliasRoot, p) === path.join(root, "src", "*"),
  )
)
  errors.push(
    "Expected @/* to map to this repository's src/* in tsconfig.json.",
  );

// Windows accepts case mismatches that fail on Linux: compare every actual name.
function checkCase(file) {
  const relative = path.relative(root, file);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
  let parent = root;
  for (const segment of relative.split(path.sep)) {
    if (!fs.readdirSync(parent).includes(segment)) {
      errors.push(`Case mismatch: ${relative}`);
      return;
    }
    parent = path.join(parent, segment);
  }
}

let imports = 0;
const sourceRoot = `${path.join(root, "src")}${path.sep}`;
const files = parsed.fileNames
  .map((file) => path.resolve(file))
  .filter((file) => file.startsWith(sourceRoot));
if (!files.length)
  errors.push(
    "No TypeScript source files found under src/; cannot verify imports.",
  );
for (const file of files) {
  checkCase(file);
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node) {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) &&
                node.expression.text === "require"))
          ? node.arguments[0]
          : undefined;
    if (
      specifier &&
      ts.isStringLiteralLike(specifier) &&
      (specifier.text.startsWith("@/") || specifier.text.startsWith("."))
    ) {
      imports++;
      const result = ts.resolveModuleName(
        specifier.text,
        file,
        parsed.options,
        ts.sys,
      ).resolvedModule;
      const style = /\.(css|scss|sass)$/.test(specifier.text)
        ? path.resolve(
            specifier.text.startsWith("@/")
              ? path.join(root, "src")
              : path.dirname(file),
            specifier.text.replace(/^@\//, ""),
          )
        : undefined;
      if (!result && style && fs.existsSync(style)) checkCase(style);
      else if (!result)
        errors.push(
          `${path.relative(root, file)}: cannot resolve ${specifier.text}`,
        );
      else checkCase(result.resolvedFileName);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Import audit passed: ${files.length} source files, ${imports} local imports; @/ mapping and exact path case verified.`,
  );
}
