import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const E2E_ROOT = join(process.cwd(), "e2e");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const BRAND_WRITE_METHODS = new Set(["insert", "upsert", "update"]);
const APPROVAL_RPC_PREFIX = "approve_submission";

type VariableInitializers = Map<string, ts.Expression>;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf(".")))
      ? [path]
      : [];
  });
}

function stringValue(node: ts.Expression | undefined): string | null {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function propertyName(node: ts.PropertyName | undefined): string | null {
  if (!node) return null;
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  )
    return node.text;
  return null;
}

function unwrap(node: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  )
    return unwrap(node.expression);
  return node;
}

function collectVariableInitializers(
  sourceFile: ts.SourceFile,
): VariableInitializers {
  const initializers: VariableInitializers = new Map();
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    )
      initializers.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return initializers;
}

function canResolveToApproved(
  expression: ts.Expression,
  approvalNames: ReadonlySet<string>,
): boolean {
  const node = unwrap(expression);
  if (stringValue(node) === "approved") return true;
  if (ts.isIdentifier(node)) return approvalNames.has(node.text);
  if (ts.isConditionalExpression(node))
    return (
      canResolveToApproved(node.whenTrue, approvalNames) ||
      canResolveToApproved(node.whenFalse, approvalNames)
    );
  if (ts.isBinaryExpression(node))
    return (
      canResolveToApproved(node.left, approvalNames) ||
      canResolveToApproved(node.right, approvalNames)
    );
  return false;
}

function collectApprovalNames(initializers: VariableInitializers): Set<string> {
  const approvalNames = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, initializer] of initializers) {
      if (
        !approvalNames.has(name) &&
        canResolveToApproved(initializer, approvalNames)
      ) {
        approvalNames.add(name);
        changed = true;
      }
    }
  }
  return approvalNames;
}

function isApprovedStatusProperty(
  property: ts.ObjectLiteralElementLike,
  approvalNames: ReadonlySet<string>,
): boolean {
  if (ts.isPropertyAssignment(property)) {
    return (
      propertyName(property.name) === "status" &&
      canResolveToApproved(property.initializer, approvalNames)
    );
  }
  return (
    ts.isShorthandPropertyAssignment(property) &&
    property.name.text === "status" &&
    approvalNames.has(property.name.text)
  );
}

function expressionProvidesApprovalAt(expression: ts.Expression): boolean {
  const node = unwrap(expression);
  if (ts.isObjectLiteralExpression(node)) return hasApprovalAtProperty(node);
  if (ts.isConditionalExpression(node))
    return (
      expressionProvidesApprovalAt(node.whenTrue) ||
      expressionProvidesApprovalAt(node.whenFalse)
    );
  return false;
}

function hasApprovalAtProperty(object: ts.ObjectLiteralExpression): boolean {
  return object.properties.some((property) => {
    if (ts.isPropertyAssignment(property))
      return propertyName(property.name) === "approved_at";
    if (ts.isShorthandPropertyAssignment(property))
      return property.name.text === "approved_at";
    return (
      ts.isSpreadAssignment(property) &&
      expressionProvidesApprovalAt(property.expression)
    );
  });
}

function isApprovedRpcCall(call: ts.CallExpression): boolean {
  if (
    !ts.isPropertyAccessExpression(call.expression) ||
    call.expression.name.text !== "rpc"
  )
    return false;
  return (stringValue(call.arguments[0]) ?? "").startsWith(APPROVAL_RPC_PREFIX);
}

function brandWritePayload(call: ts.CallExpression): ts.Expression | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  if (!BRAND_WRITE_METHODS.has(call.expression.name.text)) return undefined;
  const fromCall = call.expression.expression;
  if (
    !ts.isCallExpression(fromCall) ||
    !ts.isPropertyAccessExpression(fromCall.expression) ||
    fromCall.expression.name.text !== "from" ||
    stringValue(fromCall.arguments[0]) !== "brands"
  )
    return undefined;
  return call.arguments[0];
}

function pBrandDataPayload(
  call: ts.CallExpression,
  initializers: VariableInitializers,
): ts.Expression | undefined {
  if (!isApprovedRpcCall(call)) return undefined;
  let params = call.arguments[1];
  if (!params) return undefined;
  const seen = new Set<string>();
  let object = unwrap(params);
  while (ts.isIdentifier(object) && !seen.has(object.text)) {
    seen.add(object.text);
    const initializer = initializers.get(object.text);
    if (!initializer) return undefined;
    params = initializer;
    object = unwrap(params);
  }
  if (!ts.isObjectLiteralExpression(object)) return undefined;
  const property = object.properties.find((item) => {
    if (
      !ts.isPropertyAssignment(item) &&
      !ts.isShorthandPropertyAssignment(item)
    )
      return false;
    return propertyName(item.name) === "p_brand_data";
  });
  if (!property) return undefined;
  if (ts.isPropertyAssignment(property)) return property.initializer;
  return ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
}

function scanSource(sourceText: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const initializers = collectVariableInitializers(sourceFile);
  const approvalNames = collectApprovalNames(initializers);
  const violations: string[] = [];
  const visited = new Set<ts.Node>();

  function inspectPayload(expression: ts.Expression | undefined): void {
    if (!expression) return;
    const node = unwrap(expression);
    if (visited.has(node)) return;
    visited.add(node);

    if (ts.isIdentifier(node)) {
      inspectPayload(initializers.get(node.text));
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach((element) => {
        if (ts.isExpression(element)) inspectPayload(element);
      });
      return;
    }
    if (!ts.isObjectLiteralExpression(node)) return;

    if (
      node.properties.some((property) =>
        isApprovedStatusProperty(property, approvalNames),
      ) &&
      !hasApprovalAtProperty(node)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      violations.push(`${fileName}:${line + 1}`);
    }

    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property))
        inspectPayload(property.initializer);
      else if (ts.isSpreadAssignment(property))
        inspectPayload(property.expression);
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      inspectPayload(brandWritePayload(node));
      inspectPayload(pBrandDataPayload(node, initializers));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

function findMissingApprovalTimestamps(): string[] {
  return sourceFiles(E2E_ROOT).flatMap((file) =>
    scanSource(readFileSync(file, "utf8"), relative(process.cwd(), file)),
  );
}

describe("E2E approved_at fixture guard", () => {
  it("catches every approved brand fixture that omits an audit timestamp", () => {
    expect(findMissingApprovalTimestamps()).toEqual([]);
  });

  it("detects a missing timestamp in the middle of an array independently", () => {
    const fixture = `
      supabase.from("brands").insert([
        { name: "before", status: "approved", approved_at: "2026-08-08T00:00:00.000Z" },
        { name: "middle", status: "approved" },
        { name: "after", status: "approved", approved_at: "2026-08-08T00:00:00.000Z" },
      ]);
    `;
    const middleLine =
      fixture.split("\n").findIndex((line) => line.includes('name: "middle"')) +
      1;
    expect(scanSource(fixture, "in-memory-fixture.ts")).toEqual([
      `in-memory-fixture.ts:${middleLine}`,
    ]);
  });

  it("does not borrow a timestamp from an adjacent object", () => {
    const fixture = `
      supabase.from("brands").insert([
        { name: "first", status: "approved", approved_at: "2026-08-08T00:00:00.000Z" },
        { name: "second", status: "approved", approved_at: "2026-08-08T00:00:00.000Z" },
      ]);
    `;
    expect(scanSource(fixture, "complete-adjacent-fixture.ts")).toEqual([]);
  });

  it("stamps shared seedBrand approvals without changing hidden fixtures", () => {
    const source = readFileSync(join(E2E_ROOT, "helpers/seed.ts"), "utf8");
    expect(source).toMatch(
      /status === ['"]approved['"][\s\S]*approved_at:\s*new Date\(\)\.toISOString\(\)/,
    );
  });
});
