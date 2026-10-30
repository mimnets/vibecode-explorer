import { strict as assert } from 'assert';
import { test } from 'node:test';
import { analyzeJsApi } from '../../src/analysis/apiJs';
import { analyzePyApi } from '../../src/analysis/apiPy';
import { combineApis, FileApiFacts } from '../../src/analysis/apis';
import { resolveSpecifier } from '../../src/analysis/imports';
import {
  combinePages, findTemplate, htmlAssets, htmlPagePath, needsValue, nextLayouts, nextPagePath, previewAddress, safePagePath,
} from '../../src/analysis/pages';

test('Next.js page files become addresses', () => {
  assert.equal(nextPagePath('app/page.tsx'), '/');
  assert.equal(nextPagePath('src/app/(shop)/users/[id]/page.tsx'), '/users/[id]');
  assert.equal(nextPagePath('app/_private/page.tsx'), '/');
  assert.equal(nextPagePath('pages/index.tsx'), '/');
  assert.equal(nextPagePath('pages/blog/[slug].jsx'), '/blog/[slug]');
  assert.equal(nextPagePath('pages/blog/index.js'), '/blog');
  for (const not of ['pages/api/hello.ts', 'pages/_app.tsx', 'pages/_document.tsx', 'app/users/route.ts', 'app/users/layout.tsx', 'pages/logo.png']) {
    assert.equal(nextPagePath(not), undefined, not);
  }
  const files = new Set(['app/layout.tsx', 'app/users/layout.tsx', 'app/users/[id]/page.tsx']);
  assert.deepEqual(nextLayouts('app/users/[id]/page.tsx', files), ['app/users/layout.tsx', 'app/layout.tsx']);
});

test('HTML pages: their address and the local files they load', () => {
  assert.equal(htmlPagePath('index.html'), '/');
  assert.equal(htmlPagePath('public/about/index.html'), '/about');
  assert.equal(htmlPagePath('static/help.html'), '/help.html');
  const files = new Set(['src/main.ts', 'public/app.css', 'docs/page.js']);
  const html = '<!-- <script src="/old.js"></script> --><script type="module" src="/src/main.ts"></script>\n<link rel="stylesheet" href="/app.css"><script src="https://cdn.example.com/x.js"></script>';
  assert.deepEqual(htmlAssets('public/index.html', html, files).sort(), ['public/app.css', 'src/main.ts']);
  assert.deepEqual(htmlAssets('docs/index.html', '<script src="page.js"></script><script src="../../outside.js"></script>', files), ['docs/page.js']);
});

test('templates are found in views and templates folders', () => {
  const files = ['views/users.ejs', 'server/views/admin/home.pug', 'app/templates/shop/cart.html', 'templates/base.html'];
  assert.equal(findTemplate('users', 'express', files), 'views/users.ejs');
  assert.equal(findTemplate('admin/home', 'express', files), 'server/views/admin/home.pug');
  assert.equal(findTemplate('shop/cart.html', 'python', files), 'app/templates/shop/cart.html');
  assert.equal(findTemplate('missing.html', 'python', files), undefined);
  assert.equal(findTemplate('../secret', 'express', files), undefined);
});

test('preview addresses stay on the preview server', () => {
  assert.equal(needsValue('/users/:id'), true);
  assert.equal(needsValue('/users/[id]'), true);
  assert.equal(needsValue('/about'), false);
  assert.equal(previewAddress('http://localhost:3000/', '/users/7'), 'http://localhost:3000/users/7');
  assert.equal(previewAddress('http://localhost:3000/app/', '/users'), 'http://localhost:3000/app/users');
  for (const bad of ['users', '//evil.example/x', '/a\\b', '/a\nb', 'http://evil.example/', '']) {
    assert.equal(safePagePath(bad), undefined, JSON.stringify(bad));
    assert.equal(previewAddress('http://localhost:3000', bad), undefined, JSON.stringify(bad));
  }
  assert.equal(new URL(previewAddress('http://localhost:3000', '/../../x') as string).origin, 'http://localhost:3000');
});

test('React Router routes, nested and lazy, and Vue Router routes', () => {
  const f = analyzeJsApi('src/App.jsx', [
    "import Users from './pages/Users';",
    "import { Layout } from './Layout';",
    "const Admin = lazy(() => import('./pages/Admin'));",
    'export const App = () => (',
    '  <Routes>',
    '    <Route path="/" element={<Layout />}>',
    '      <Route index element={<Home />} />',
    '      <Route path="users" element={<Users />} />',
    '      <Route path="/admin" element={<Admin />} />',
    '    </Route>',
    '  </Routes>',
    ');',
    "const router = createBrowserRouter([{ path: '/shop', element: <Layout />, children: [{ path: 'cart', lazy: () => import('./pages/Cart') }] }]);",
  ].join('\n'));
  assert.deepEqual(f.pageRoutes.map((r) => `${r.path} ${r.componentName ?? ''} ${r.component ?? ''}`), [
    '/ Layout ./Layout', '/ Home ', '/users Users ./pages/Users', '/admin Admin ./pages/Admin', '/shop Layout ./Layout', '/shop/cart  ./pages/Cart',
  ]);
  const vue = analyzeJsApi('src/router.js', "import { createRouter } from 'vue-router';\nimport About from './views/About.vue';\nexport default createRouter({ routes: [{ path: '/about', component: About }] });");
  assert.deepEqual(vue.pageRoutes.map((r) => `${r.kind} ${r.path} ${r.component}`), ['Vue Router /about ./views/About.vue']);
  assert.equal(analyzeJsApi('x.ts', "const cfg = { path: '/tmp', mode: 1 };").pageRoutes.length, 0, 'a plain object with a path is not a route');
});

test('Express views and Flask, FastAPI and Django templates are tied to their routes', () => {
  const ex = analyzeJsApi('server/app.js', "app.get('/', (req, res) => res.render('home'));\napp.get('/help', (req, res) => res.sendFile(path.join(__dirname, 'public', 'help.html')));\napp.get('/api', (req, res) => res.json({}));");
  assert.deepEqual(ex.routes.map((r) => [r.path, r.view]), [['/', { render: 'home' }], ['/help', { file: 'server/public/help.html' }], ['/api', undefined]]);
  const fl = analyzePyApi('@app.route("/cart")\ndef cart():\n    return render_template("shop/cart.html")\n@app.get("/plain")\ndef plain(): return {}\n');
  assert.deepEqual(fl.routes.map((r) => [r.path, r.view]), [['/cart', { template: 'shop/cart.html' }], ['/plain', undefined]]);
  const dj = analyzePyApi('def users(request):\n    return render(request, "users.html", {})\nclass About(TemplateView):\n    template_name = "about.html"\n');
  assert.deepEqual(dj.views.map((v) => `${v.name}:${v.template}`), ['users:users.html', 'About:about.html']);
  const urls = analyzePyApi('urlpatterns = [\n  path("users/", views.users),\n  path("about/", views.About.as_view()),\n]');
  assert.deepEqual(urls.routes.map((r) => r.view), [{ handler: 'users' }, { handler: 'About' }]);
});

test('pages are combined with their files, templates and missing parts', () => {
  const sources: Record<string, string> = {
    'src/App.jsx': "import Users from './pages/Users';\nimport Gone from 'some-package';\nexport default () => <Routes><Route path=\"/users\" element={<Users />} /><Route path=\"/gone\" element={<Gone />} /></Routes>;",
    'src/pages/Users.jsx': "import { api } from '../api';\nexport default function Users() {}",
    'src/api.js': 'export const api = 1;',
    'server.js': "app.get('/', (req, res) => res.render('home'));\napp.get('/x', (req, res) => res.render('nope'));",
    'shop/urls.py': 'urlpatterns = [path("cart/", views.cart)]',
    'shop/views.py': 'def cart(request):\n    return render(request, "shop/cart.html")',
  };
  const facts = new Map<string, FileApiFacts>(Object.entries(sources).map(([f, src]) => [f, f.endsWith('.py') ? analyzePyApi(src) : analyzeJsApi(f, src)]));
  const graphFiles = new Set(Object.keys(sources));
  const allFiles = [...graphFiles, 'views/home.ejs', 'shop/templates/shop/cart.html', 'app/page.tsx', 'index.html', 'src/main.ts', 'templates/partial.html'];
  const imports: Record<string, string[]> = { 'src/pages/Users.jsx': ['src/api.js'] };
  const { routes } = combineApis(facts, () => undefined, () => []);
  const { pages } = combinePages({
    facts, routes, allFiles, hasNext: false,
    html: new Map([['index.html', ['src/main.ts']], ['templates/partial.html', []]]),
    resolveComponent: (from, spec) => resolveSpecifier(from, spec, graphFiles).target,
    importsOf: (f) => imports[f] ?? [],
  });
  const show = pages.map((p) => `${p.kind} ${p.path} ${p.file}${p.template ? ` tpl=${p.template}` : ''}${p.missing ? ` missing=${p.missing}` : ''} [${p.files.join(',')}]`);
  assert.deepEqual(show, [
    'HTML page / index.html [src/main.ts]',
    'Express view / server.js tpl=views/home.ejs [views/home.ejs]',
    'Django template /cart shop/views.py tpl=shop/templates/shop/cart.html [shop/templates/shop/cart.html,shop/urls.py]',
    'React Router /gone src/App.jsx missing=some-package []',
    'React Router /users src/pages/Users.jsx [src/App.jsx,src/api.js]',
    'Express view /x server.js missing=nope []',
  ]);
  assert.ok(!show.some((s) => s.includes('app/page.tsx')), 'Next.js folders count only when the project uses Next.js');
  const withNext = combinePages({ facts: new Map(), routes: [], allFiles: ['app/page.tsx'], hasNext: true, html: new Map(), resolveComponent: () => undefined, importsOf: () => [] });
  assert.deepEqual(withNext.pages.map((p) => `${p.kind} ${p.path}`), ['Next.js page /']);
  assert.ok(pages.every((p, n) => p.id === `g${n}`));
});
