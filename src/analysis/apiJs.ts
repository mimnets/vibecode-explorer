// Phase 7: routes, HTTP calls and models in JavaScript/TypeScript, read with the TypeScript
// parser (syntax only). Pure, unit-testable. Patterns, not a type checker: what can't be read
// from the source text is shown as `*` or left out, never guessed.
import type * as TS from 'typescript';
import { emptyFacts, FileApiFacts, HTTP_METHODS, HttpMethod } from './apis';
import { loadTs } from './imports';

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);
/** Receivers that usually are a server or router (Express, Fastify, Koa router, Hono). */
const ROUTER_NAME = /^(app|server|fastify|hono|routes?|api)$|router$/i;
const PRISMA_OPS = new Set(['findMany', 'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'create', 'createMany', 'update',
  'updateMany', 'upsert', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy']);

const toMethod = (m: string): HttpMethod => {
  const up = m.toUpperCase();
  return (HTTP_METHODS as readonly string[]).includes(up) ? (up as HttpMethod) : 'ANY';
};

function scriptKind(ts: typeof TS, fileName: string): TS.ScriptKind {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

export function analyzeJsApi(fileName: string, source: string): FileApiFacts {
  const ts = loadTs();
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(ts, fileName));
  const facts = emptyFacts();
  const lineOf = (n: TS.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  /** Exact text of a string, or a pattern with `*` for computed parts; undefined if nothing is known. */
  const text = (n: TS.Expression | undefined): string | undefined => {
    if (!n) return undefined;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => '*' + s.literal.text).join('');
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const a = text(n.left) ?? '*';
      const b = text(n.right) ?? '*';
      return a === '*' && b === '*' ? undefined : a + b;
    }
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) return text(n.expression);
    return undefined;
  };
  const isFunctionLike = (n: TS.Node): boolean => ts.isArrowFunction(n) || ts.isFunctionExpression(n);
  const nameOf = (n: TS.Expression): string => (ts.isIdentifier(n) ? n.text : ts.isPropertyAccessExpression(n) ? n.name.text : ts.isCallExpression(n) ? nameOf(n.expression) : '');
  const prop = (obj: TS.Expression | undefined, key: string): TS.Expression | undefined => {
    if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
    for (const p of obj.properties) {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === key) return p.initializer;
    }
    return undefined;
  };

  // First pass: imports (for mounts) and axios instances (`const api = axios.create()`).
  const imported = new Map<string, string>();
  const axiosNames = new Set(['axios']);
  const firstPass = (node: TS.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause) {
      const spec = node.moduleSpecifier.text;
      if (node.importClause.name) imported.set(node.importClause.name.text, spec);
      const b = node.importClause.namedBindings;
      if (b && ts.isNamedImports(b)) for (const e of b.elements) imported.set(e.name.text, spec);
      if (b && ts.isNamespaceImport(b)) imported.set(b.name.text, spec);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'require' && init.arguments[0] && ts.isStringLiteral(init.arguments[0])) {
        imported.set(node.name.text, init.arguments[0].text);
      }
      if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === 'create' && axiosNames.has(nameOf(init.expression.expression))) {
        axiosNames.add(node.name.text);
      }
    }
    ts.forEachChild(node, firstPass);
  };
  firstPass(sf);

  const addCall = (method: HttpMethod, urlNode: TS.Expression | undefined, line: number, client: string): void => {
    facts.calls.push({ method, url: text(urlNode) ?? '', line, client });
  };

  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const args = node.arguments;
      const line = lineOf(node);
      const isFetch = (ts.isIdentifier(callee) && callee.text === 'fetch')
        || (ts.isPropertyAccessExpression(callee) && callee.name.text === 'fetch' && ['window', 'globalThis', 'self'].includes(nameOf(callee.expression)));
      if (isFetch) {
        const m = text(prop(args[1], 'method') as TS.Expression | undefined);
        addCall(m ? toMethod(m) : 'GET', args[0], line, 'fetch');
      } else if (ts.isIdentifier(callee) && axiosNames.has(callee.text)) {
        // axios(url, config) or axios(config)
        const configFirst = args[0] !== undefined && ts.isObjectLiteralExpression(args[0]);
        const m = text(prop(configFirst ? args[0] : args[1], 'method'));
        addCall(m ? toMethod(m) : 'GET', configFirst ? prop(args[0], 'url') : args[0], line, 'axios');
      } else if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        const receiver = callee.expression;
        const receiverName = nameOf(receiver);
        const first = args[0];
        const firstText = text(first);
        if (axiosNames.has(receiverName) && (ROUTE_METHODS.has(method) || method === 'request')) {
          if (method === 'request') addCall(toMethod(text(prop(first, 'method')) ?? 'get'), prop(first, 'url'), line, 'axios');
          else addCall(toMethod(method), first, line, receiverName === 'axios' ? 'axios' : `axios (${receiverName})`);
        } else if (ROUTE_METHODS.has(method) && ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression) && receiver.expression.name.text === 'route') {
          // app.route('/users').get(handler)
          const p = text(receiver.arguments[0]);
          if (p?.startsWith('/')) facts.routes.push({ method: toMethod(method), path: p, line, framework: 'Express' });
        } else if (ROUTE_METHODS.has(method) && firstText?.startsWith('/') && args.length >= 2 && (args.slice(1).some(isFunctionLike) || ROUTER_NAME.test(receiverName))) {
          facts.routes.push({ method: toMethod(method), path: firstText, line, framework: 'Express-style' });
        } else if (method === 'route' && first && ts.isObjectLiteralExpression(first)) {
          // Fastify: fastify.route({ method: 'GET', url: '/x', handler })
          const url = text(prop(first, 'url') ?? prop(first, 'path'));
          const m = prop(first, 'method');
          const methods = m && ts.isArrayLiteralExpression(m) ? m.elements.map((e) => text(e) ?? 'ANY') : [text(m) ?? 'ANY'];
          if (url?.startsWith('/')) for (const x of methods) facts.routes.push({ method: toMethod(x), path: url, line, framework: 'Fastify' });
        } else if ((method === 'use' || method === 'route') && firstText?.startsWith('/') && args[1] && ts.isIdentifier(args[1]) && imported.has(args[1].text)) {
          // Express app.use('/api', usersRouter), Hono app.route('/api', users)
          facts.mounts.push({ prefix: firstText, line, target: { js: imported.get(args[1].text) as string }, framework: method === 'use' ? 'Express' : 'Hono' });
        } else if (method === 'register' && first && ts.isIdentifier(first) && imported.has(first.text)) {
          // Fastify: fastify.register(users, { prefix: '/api' })
          const prefix = text(prop(args[1], 'prefix'));
          if (prefix?.startsWith('/')) facts.mounts.push({ prefix, line, target: { js: imported.get(first.text) as string }, framework: 'Fastify' });
        } else if (method === 'define' && firstText && /^[A-Za-z_]\w*$/.test(firstText) && args.length >= 2) {
          facts.models.push({ name: firstText, line, kind: 'Sequelize model', table: text(prop(args[2], 'tableName')) });
        } else if (method === 'model' && receiverName === 'mongoose' && firstText && args.length >= 2) {
          facts.models.push({ name: firstText, line, kind: 'Mongoose model' });
        } else if (PRISMA_OPS.has(method) && ts.isPropertyAccessExpression(receiver) && /^(prisma|db|client|tx)$/i.test(nameOf(receiver.expression))) {
          facts.modelUses.push({ model: receiver.name.text, line });
        }
      } else if (ts.isIdentifier(callee) && callee.text === 'model' && imported.get('model') === 'mongoose' && text(args[0]) && args.length >= 2) {
        facts.models.push({ name: text(args[0]) as string, line, kind: 'Mongoose model' });
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
      const entity = decorators.find((d) => ts.isCallExpression(d.expression) ? nameOf(d.expression.expression) === 'Entity' : nameOf(d.expression) === 'Entity');
      if (entity) {
        const arg = ts.isCallExpression(entity.expression) ? entity.expression.arguments[0] : undefined;
        facts.models.push({ name: node.name.text, line: lineOf(node), kind: 'TypeORM entity', table: text(arg) ?? text(prop(arg, 'name')) });
      } else if (node.heritageClauses?.some((h) => h.token === ts.SyntaxKind.ExtendsKeyword && h.types.some((t) => nameOf(t.expression) === 'Model'))) {
        facts.models.push({ name: node.name.text, line: lineOf(node), kind: 'Sequelize model' });
      }
    }
    // Next.js route handlers: export function GET() / export const POST = …
    if ((ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const names = ts.isFunctionDeclaration(node) ? [node.name?.text ?? ''] : node.declarationList.declarations.map((d) => (ts.isIdentifier(d.name) ? d.name.text : ''));
      for (const n of names) if ((HTTP_METHODS as readonly string[]).includes(n)) facts.exportedMethods.push(n as HttpMethod);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return facts;
}
