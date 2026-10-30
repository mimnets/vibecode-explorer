// Phase 7: routes, HTTP calls and models in Python (FastAPI, Flask, Django, requests, httpx,
// SQLAlchemy, SQLModel, Django ORM). Uses the comment- and string-aware scanner from
// python.ts, then simple patterns per logical line. Pure, unit-testable; nothing is run.
import { emptyFacts, FileApiFacts, HTTP_METHODS, HttpMethod, joinPath, RouteFact } from './apis';
import { logicalLines, parsePythonImports, STR } from './python';

const TOKEN = `[fFrRbBuU]{0,2}${STR}\\d+${STR}`;

const toMethod = (m: string): HttpMethod => {
  const up = m.toUpperCase();
  return (HTTP_METHODS as readonly string[]).includes(up) ? (up as HttpMethod) : 'ANY';
};

export function analyzePyApi(source: string): FileApiFacts {
  const facts = emptyFacts();
  const { lines, strings, starts, stringLines } = logicalLines(source);

  /** The text of a string token; `{…}` parts of an f-string become `*`. */
  const str = (token: string | undefined): string | undefined => {
    const m = token && new RegExp(`^\\s*([fFrRbBuU]{0,2})${STR}(\\d+)${STR}\\s*$`).exec(token);
    if (!m) return undefined;
    const value = strings[Number(m[2])];
    return /f/i.test(m[1]) ? value.replace(/\{[^}]*\}/g, '*') : value;
  };
  const lineOfToken = (token: string, fallback: number): number => {
    const m = new RegExp(`${STR}(\\d+)${STR}`).exec(token);
    return m ? stringLines[Number(m[1])] : fallback;
  };
  /** A URL expression such as `"/users"`, `f"/users/{id}"` or `BASE + "/users"`. */
  const urlOf = (expr: string): string => {
    const parts = expr.split('+').map((p) => str(p) ?? '*');
    const url = parts.join('');
    return /^\*+$/.test(url) ? '' : url;
  };
  const kwarg = (args: string, name: string): string | undefined => str(new RegExp(`\\b${name}\\s*=\\s*(${TOKEN})`).exec(args)?.[1]);

  // Names that refer to other modules, for `include_router(users.router)` and `register_blueprint(bp)`.
  const moduleOf = new Map<string, string>();
  for (const imp of parsePythonImports(source).imports) {
    if (imp.names.length === 0) moduleOf.set(imp.module.split('.').pop() as string, imp.module);
    for (const name of imp.names) moduleOf.set(name, `${imp.module}${imp.module.endsWith('.') ? '' : '.'}${name}`);
  }
  for (const l of lines) {
    const alias = /^import\s+([\w.]+)\s+as\s+(\w+)$/.exec(l);
    if (alias) moduleOf.set(alias[2], alias[1]);
  }

  // Router prefixes defined in this file: APIRouter(prefix=…) and Blueprint(…, url_prefix=…).
  const prefixes = new Map<string, string>();
  let framework = 'Python';
  for (const l of lines) {
    const m = /^(\w+)\s*(?::[^=]+)?=\s*(?:\w+\.)?(APIRouter|Blueprint|FastAPI|Flask)\((.*)\)$/.exec(l);
    if (!m) continue;
    framework = m[2] === 'APIRouter' || m[2] === 'FastAPI' ? 'FastAPI' : 'Flask';
    const prefix = m[2] === 'APIRouter' ? kwarg(m[3], 'prefix') : m[2] === 'Blueprint' ? kwarg(m[3], 'url_prefix') : undefined;
    if (prefix) prefixes.set(m[1], prefix);
  }
  const isDjangoUrls = lines.some((l) => /^urlpatterns\b/.test(l));

  let lastModel: { name: string; table?: string } | undefined;
  // Phase 8: routes waiting for their function, and the function (or class) being read.
  let pendingRoutes: RouteFact[] = [];
  let currentRoutes: RouteFact[] = [];
  let currentDef = '';
  lines.forEach((l, i) => {
    const line = starts[i];
    // Decorated routes: @app.get("/x"), @router.post(...), @bp.route("/x", methods=["GET", "POST"])
    let m = new RegExp(`^@(\\w+)\\.(get|post|put|patch|delete|head|options|route|api_route)\\(\\s*(${TOKEN})(.*)\\)$`).exec(l);
    if (m) {
      const p = str(m[3]);
      if (p !== undefined) {
        const listed = /\bmethods\s*=\s*[[(](.*?)[\])]/.exec(m[4])?.[1];
        const methods = m[2] === 'route' || m[2] === 'api_route'
          ? (listed ? [...listed.matchAll(new RegExp(TOKEN, 'g'))].map((t) => toMethod(str(t[0]) ?? '')) : [m[2] === 'route' ? 'GET' as const : 'ANY' as const])
          : [toMethod(m[2])];
        const fw = framework !== 'Python' ? framework : m[2] === 'route' ? 'Flask' : 'FastAPI';
        for (const method of methods) {
          const route: RouteFact = { method, path: joinPath(prefixes.get(m[1]) ?? '', p), line: lineOfToken(m[3], line), framework: fw };
          facts.routes.push(route);
          pendingRoutes.push(route);
        }
      }
      return;
    }
    // A function after route decorators is their handler; the template it renders is the page.
    const def = /^(?:async\s+)?def\s+(\w+)\s*\(/.exec(l);
    if (def) {
      currentDef = def[1];
      currentRoutes = pendingRoutes;
      pendingRoutes = [];
    }
    const cls = /^class\s+(\w+)\b/.exec(l);
    if (cls) {
      currentDef = cls[1];
      currentRoutes = [];
    }
    const tpl = new RegExp(`\\brender_template\\(\\s*(${TOKEN})|\\brender\\(\\s*\\w+\\s*,\\s*(${TOKEN})|\\bTemplateResponse\\(\\s*(?:\\w+\\s*,\\s*)?(${TOKEN})|^template_name\\s*(?::[^=]+)?=\\s*(${TOKEN})`).exec(l);
    const tplToken = tpl && (tpl[1] ?? tpl[2] ?? tpl[3] ?? tpl[4]);
    const template = tplToken ? str(tplToken) : undefined;
    if (tplToken && template && !template.includes('*')) {
      for (const r of currentRoutes) r.view ??= { template };
      if (currentDef) facts.views.push({ name: currentDef, template, line: lineOfToken(tplToken, line) });
    }
    // Routers included from other modules.
    m = /\.(include_router|register_blueprint)\(\s*([\w.]+)\s*(?:,(.*))?\)$/.exec(l);
    if (m) {
      const prefix = kwarg(m[3] ?? '', m[1] === 'include_router' ? 'prefix' : 'url_prefix') ?? '';
      const [head, ...rest] = m[2].split('.');
      const mod = moduleOf.get(head);
      if (mod) facts.mounts.push({ prefix, line, target: { py: [mod, ...rest].join('.') }, framework: m[1] === 'include_router' ? 'FastAPI' : 'Flask' });
    }
    // Django: path("users/", views.users), path("api/", include("shop.urls"))
    if (isDjangoUrls) {
      for (const d of l.matchAll(new RegExp(`\\b(?:re_)?path\\(\\s*(${TOKEN})\\s*,\\s*(?:(include)\\(\\s*(${TOKEN})|([\\w.]+))?`, 'g'))) {
        const p = str(d[1]);
        if (p === undefined) continue;
        const clean = p.replace(/^\^/, '').replace(/\$$/, '');
        const include = d[2] && str(d[3]);
        // `views.users` or `views.UserView.as_view()`: the view's name is the last part.
        const handler = d[4]?.split('.').filter((x) => x && x !== 'as_view').pop();
        if (include) facts.mounts.push({ prefix: joinPath('', clean), line: lineOfToken(d[1], line), target: { py: include }, framework: 'Django' });
        else if (!d[2]) facts.routes.push({ method: 'ANY', path: joinPath('', clean), line: lineOfToken(d[1], line), framework: 'Django', view: handler ? { handler } : undefined });
      }
    }
    // HTTP calls: requests.get(url), httpx.post(url), requests.request("PUT", url)
    for (const c of l.matchAll(/\b(requests|httpx)\.(get|post|put|patch|delete|head|options|request)\(([^,)]*)(?:,([^,)]*))?/g)) {
      const isRequest = c[2] === 'request';
      const urlExpr = (isRequest ? c[4] : c[3]) ?? '';
      facts.calls.push({ method: isRequest ? toMethod(str(c[3]) ?? '') : toMethod(c[2]), url: urlOf(urlExpr.trim()), line: lineOfToken(urlExpr, line), client: c[1] });
    }
    // Models: class User(Base), class User(db.Model), class User(models.Model), class Hero(SQLModel, table=True)
    m = /^class\s+(\w+)\s*\((.*)\)\s*:/.exec(l);
    if (m) {
      const bases = m[2].split(',').map((b) => b.trim());
      const kind = bases.includes('models.Model') ? 'Django model'
        : bases.some((b) => /^(\w+\.)?Model$/.test(b)) ? 'SQLAlchemy model'
          : bases.includes('Base') ? 'SQLAlchemy model'
            : bases.includes('SQLModel') && bases.some((b) => /^table\s*=\s*True$/.test(b)) ? 'SQLModel table'
              : undefined;
      lastModel = kind ? { name: m[1], table: undefined } : undefined;
      if (kind) facts.models.push({ name: m[1], line, kind });
      return;
    }
    const table = /^(?:__tablename__|db_table)\s*(?::[^=]+)?=\s*(.+)$/.exec(l);
    if (table && lastModel) {
      const t = str(table[1]);
      const model = facts.models[facts.models.length - 1];
      if (t && model?.name === lastModel.name && !model.table) model.table = t;
    }
  });
  return facts;
}
