import { strict as assert } from 'assert';
import { test } from 'node:test';
import { analyzeJsApi } from '../../src/analysis/apiJs';
import { analyzePyApi } from '../../src/analysis/apiPy';
import { callPath, combineApis, FileApiFacts, joinPath, nextRoutes, pathMatches, pythonModuleFile } from '../../src/analysis/apis';
import { analyzePrisma, analyzeSql } from '../../src/analysis/apiSchema';
import { resolveSpecifier } from '../../src/analysis/imports';
import { logicalLines } from '../../src/analysis/python';

const routes = (f: FileApiFacts) => f.routes.map((r) => `${r.method} ${r.path} :${r.line}`);
const calls = (f: FileApiFacts) => f.calls.map((c) => `${c.method} ${c.url} (${c.client}) :${c.line}`);

test('paths are joined and matched in every common parameter style', () => {
  assert.equal(joinPath('/api/', 'users/'), '/api/users');
  assert.equal(joinPath('', ''), '/');
  for (const route of ['/users/:id', '/users/{id}', '/users/<int:id>', '/users/[id]']) assert.ok(pathMatches(route, '/users/42'), route);
  assert.ok(pathMatches('/users/:id', '/users/*'));
  assert.ok(pathMatches('/users/me', '/users/*'));
  assert.ok(!pathMatches('/users/:id', '/users'));
  assert.ok(!pathMatches('/users', '/posts'));
  assert.ok(pathMatches('/docs/[...slug]', '/docs/a/b'));
  assert.ok(!pathMatches('/docs/[...slug]', '/docs'));
  assert.ok(pathMatches('/docs/[[...slug]]', '/docs'));
  assert.ok(pathMatches('/files/v2', '/files/v*'), 'part of a segment computed');
});

test('call URLs keep only paths on this project', () => {
  assert.equal(callPath('/api/users?page=2'), '/api/users');
  assert.equal(callPath('http://localhost:3000/api/x'), '/api/x');
  assert.equal(callPath('*/api/users'), '/api/users');
  assert.equal(callPath('https://api.github.com/repos'), undefined);
  assert.equal(callPath(''), undefined);
});

test('Express, Fastify, Hono and router-chain routes are found in JS/TS', () => {
  const f = analyzeJsApi('server.ts', [
    "import express from 'express';",
    "import users from './routes/users';",
    'const app = express();',
    "app.get('/health', (req, res) => res.send('ok'));",
    "app.post('/login', auth, login);",
    "app.use('/api', users);",
    "app.route('/items').get(list);",
    "fastify.route({ method: ['GET', 'POST'], url: '/f', handler });",
    "app.get('env');",
    "map.get('/not-a-route');",
  ].join('\n'));
  assert.deepEqual(routes(f), ['GET /health :4', 'POST /login :5', 'GET /items :7', 'GET /f :8', 'POST /f :8']);
  assert.deepEqual(f.mounts.map((m) => [m.prefix, m.target]), [['/api', { js: './routes/users' }]]);
});

test('fetch and axios calls are found with their method and URL pattern', () => {
  const f = analyzeJsApi('client.ts', [
    "import axios from 'axios';",
    "const api = axios.create({ baseURL: '/api' });",
    "fetch('/api/users');",
    "fetch(`${BASE}/api/users/${id}`, { method: 'DELETE' });",
    "axios.post('/api/login', body);",
    "api.get('/me');",
    "axios({ url: '/api/x', method: 'put' });",
    'fetch(url);',
  ].join('\n'));
  assert.deepEqual(calls(f), [
    'GET /api/users (fetch) :3', 'DELETE */api/users/* (fetch) :4', 'POST /api/login (axios) :5',
    'GET /me (axios (api)) :6', 'PUT /api/x (axios) :7', 'GET  (fetch) :8',
  ]);
  assert.equal(f.routes.length, 0, 'api.get on an axios instance is a call, not a route');
});

test('Next.js route handlers and pages API files become routes', () => {
  const f = analyzeJsApi('app/api/users/[id]/route.ts', 'export async function GET() {}\nexport const DELETE = () => {};\nexport function helper() {}');
  assert.deepEqual(f.exportedMethods, ['GET', 'DELETE']);
  assert.deepEqual(nextRoutes('app/api/users/[id]/route.ts', f.exportedMethods).map((r) => `${r.method} ${r.path}`), ['GET /api/users/[id]', 'DELETE /api/users/[id]']);
  assert.deepEqual(nextRoutes('src/app/(shop)/cart/route.js', ['POST']).map((r) => r.path), ['/cart']);
  assert.deepEqual(nextRoutes('pages/api/hello.ts', []).map((r) => `${r.method} ${r.path}`), ['ANY /api/hello']);
  assert.deepEqual(nextRoutes('pages/api/index.ts', []).map((r) => r.path), ['/api']);
  assert.deepEqual(nextRoutes('src/lib/route.ts', ['GET']), []);
});

test('JS/TS models: TypeORM, Sequelize, Mongoose, and Prisma client uses', () => {
  const f = analyzeJsApi('models.ts', [
    "@Entity('users') class User {}",
    'class Order extends Model {}',
    "const Post = sequelize.define('Post', {}, { tableName: 'posts' });",
    "const Cat = mongoose.model('Cat', schema);",
    'await prisma.user.findMany();',
    'class Plain {}',
  ].join('\n'));
  assert.deepEqual(f.models.map((m) => `${m.kind}: ${m.name}${m.table ? ` (${m.table})` : ''}`),
    ['TypeORM entity: User (users)', 'Sequelize model: Order', 'Sequelize model: Post (posts)', 'Mongoose model: Cat']);
  assert.deepEqual(f.modelUses, [{ model: 'user', line: 5 }]);
});

test('the Python scanner reports where each logical line and string starts', () => {
  const r = logicalLines('x = 1\n"""doc\nstring"""\nfoo(\n  "a",\n  "b")\n');
  assert.deepEqual(r.starts, [1, 2, 4]);
  assert.deepEqual(r.stringLines, [2, 5, 6]);
});

test('FastAPI and Flask routes with router prefixes, and included routers', () => {
  const f = analyzePyApi([
    'from fastapi import APIRouter, FastAPI',
    'from .routers import users',
    'router = APIRouter(prefix="/items")',
    'app = FastAPI()',
    '@router.get("/{item_id}")',
    'def read(item_id: int): ...',
    '@app.post("/login")',
    'def login(): ...',
    '@app.api_route("/any", methods=["GET", "PUT"])',
    'def any_(): ...',
    'app.include_router(users.router, prefix="/api")',
    '# @app.get("/commented")',
  ].join('\n'));
  assert.deepEqual(routes(f), ['GET /items/{item_id} :5', 'POST /login :7', 'GET /any :9', 'PUT /any :9']);
  assert.deepEqual(f.mounts.map((m) => [m.prefix, m.target]), [['/api', { py: '.routers.users.router' }]]);
  const flask = analyzePyApi('bp = Blueprint("shop", __name__, url_prefix="/shop")\n@bp.route("/cart/<int:id>", methods=["POST"])\ndef cart(id): ...\n@bp.route("/")\ndef home(): ...');
  assert.deepEqual(routes(flask), ['POST /shop/cart/<int:id> :2', 'GET /shop :4']);
});

test('Django URL patterns, including other URL modules', () => {
  const f = analyzePyApi('from django.urls import path, include\nurlpatterns = [\n    path("users/", views.users),\n    path("api/", include("shop.urls")),\n]\n');
  assert.deepEqual(routes(f), ['ANY /users :3']);
  assert.deepEqual(f.mounts.map((m) => [m.prefix, m.target, m.line]), [['/api', { py: 'shop.urls' }, 4]]);
  assert.equal(analyzePyApi('x = path("users/", v)').routes.length, 0, 'path() outside a urls module is ignored');
});

test('Python HTTP calls and ORM models', () => {
  const f = analyzePyApi([
    'requests.get("http://localhost:8000/api/users")',
    'httpx.post(f"{BASE}/api/orders/{oid}", json=x)',
    'requests.request("DELETE", BASE + "/api/x")',
    'class User(Base):',
    '    __tablename__ = "users"',
    'class Item(db.Model): pass',
    'class Shop(models.Model):',
    '    class Meta:',
    '        db_table = "shops"',
    'class Hero(SQLModel, table=True): pass',
    'class Schema(BaseModel): pass',
  ].join('\n'));
  assert.deepEqual(calls(f), ['GET http://localhost:8000/api/users (requests) :1', 'POST */api/orders/* (httpx) :2', 'DELETE */api/x (requests) :3']);
  assert.deepEqual(f.models.map((m) => `${m.kind}: ${m.name}${m.table ? ` (${m.table})` : ''}`),
    ['SQLAlchemy model: User (users)', 'SQLAlchemy model: Item', 'Django model: Shop (shops)', 'SQLModel table: Hero']);
});

test('SQL tables and Prisma models, ignoring comments', () => {
  const sql = analyzeSql('-- CREATE TABLE old (id int);\nCREATE TABLE IF NOT EXISTS "users" (id int);\n/* create table nope */\ncreate temporary table public.tmp_x (a int);');
  assert.deepEqual(sql.models.map((m) => `${m.name}:${m.line}`), ['users:2', 'public.tmp_x:4']);
  const prisma = analyzePrisma('// model Old {}\nmodel User {\n  id Int @id\n  @@map("app_users")\n}\nmodel Post {\n  id Int @id\n}\n');
  assert.deepEqual(prisma.models.map((m) => `${m.name}:${m.table ?? ''}:${m.line}`), ['User:app_users:2', 'Post::6']);
});

test('combining files applies mount prefixes, matches calls to routes and finds model users', () => {
  const files = new Set(['server.ts', 'routes/users.ts', 'web/client.ts', 'models.ts', 'schema.prisma', 'svc.ts']);
  const facts = new Map<string, FileApiFacts>([
    ['server.ts', analyzeJsApi('server.ts', "import users from './routes/users';\napp.use('/api', users);")],
    ['routes/users.ts', analyzeJsApi('routes/users.ts', "router.get('/users/:id', h);\nrouter.post('/users', h);")],
    ['web/client.ts', analyzeJsApi('web/client.ts', "fetch(`/api/users/${id}`);\nfetch('/api/nothing');\nfetch('https://example.com/x');")],
    ['models.ts', analyzeJsApi('models.ts', '@Entity() class User {}')],
    ['schema.prisma', analyzePrisma('model Post {\n id Int\n}')],
    ['svc.ts', analyzeJsApi('svc.ts', 'prisma.post.create({});')],
  ]);
  const map = combineApis(facts, (from, m) => ('js' in m.target ? resolveSpecifier(from, m.target.js, files).target : undefined), (f) => (f === 'models.ts' ? ['svc.ts'] : []));
  assert.deepEqual(map.routes.map((r) => `${r.method} ${r.path} ${r.callers.join(',')}`), ['GET /api/users/:id web/client.ts', 'POST /api/users ']);
  const [hit, miss, ext] = map.calls;
  assert.deepEqual(hit.routes, [map.routes[0].id]);
  assert.deepEqual(miss.routes, []);
  assert.ok(ext.external && !miss.external);
  assert.deepEqual(map.models.map((m) => `${m.name}: ${m.usedBy.join(',')}`), ['User: svc.ts', 'Post: svc.ts']);
  assert.ok(map.routes.every((r) => /^w\d+$/.test(r.id)) && map.calls.every((c) => /^x\d+$/.test(c.id)) && map.models.every((m) => /^m\d+$/.test(m.id)));
});

test('Python module names resolve to files for mounts', () => {
  const files = new Set(['shop/urls.py', 'app/routers/users.py', 'app/main.py']);
  assert.equal(pythonModuleFile('proj/urls.py', 'shop.urls', files), 'shop/urls.py');
  assert.equal(pythonModuleFile('app/main.py', '.routers.users', files), 'app/routers/users.py');
  assert.equal(pythonModuleFile('app/main.py', '.routers.users.router', files), undefined);
});
