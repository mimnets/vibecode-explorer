// Builds a disposable sample workspace, runs the suite inside a VS Code Extension
// Development Host, then verifies the sample files were not modified.
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function createSample(root: string): string {
  const repo = path.join(root, 'sample-repo');
  write(path.join(repo, 'src/index.ts'), `import { util } from './util';\nimport './missing';\nimport x from '@/alias';\nconst m = await import(name);\nexport const main = () => util();\n`);
  write(path.join(repo, 'src/util.ts'), `export function util() { return 1; }\n`);
  write(path.join(repo, 'src/old.ts'), `export const old = true;\n`);
  write(path.join(repo, '.env'), `API_KEY=do-not-read\n`);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'add', '.');
  const commit = (message: string) => git(repo, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', message);
  commit('init');
  // Phase 9: a tagged commit is a safe point.
  git(repo, 'tag', 'v0.1');
  // History for Phase 3: an add, a rename, a deletion and a sensitive file.
  write(path.join(repo, 'src/helper.ts'), `export const helper = 'a fairly long line so rename detection has content to compare';\n`);
  write(path.join(repo, 'src/temp.ts'), `export const temp = 1;\n`);
  git(repo, 'add', '.');
  commit('add helper\n\nWhy: keep small helpers apart from util.');
  git(repo, 'mv', 'src/helper.ts', 'src/helpers.ts');
  git(repo, 'rm', '-q', 'src/temp.ts');
  write(path.join(repo, '.env'), `API_KEY=committed-do-not-read\n`);
  git(repo, 'add', '.');
  commit('rename helper, drop temp');
  write(path.join(repo, 'src/util.ts'), `export function util() { return 2; }\n`);
  write(path.join(repo, 'src/new.ts'), `import { util } from './util';\nexport const n = util();\n`);
  write(path.join(repo, '.env'), `API_KEY=changed-do-not-read\n`);
  fs.rmSync(path.join(repo, 'src/old.ts'));
  // Phase 5: a circular import (untracked).
  write(path.join(repo, 'src/ping.ts'), `import { pong } from './pong';
export const ping = () => pong;
`);
  write(path.join(repo, 'src/pong.ts'), `import { ping } from './ping';
export const pong = () => ping;
`);

  const plain = path.join(root, 'plain-folder');
  write(path.join(plain, 'a.js'), `const b = require('./b');\n`);
  write(path.join(plain, 'b.js'), `module.exports = 1;\n`);

  // Phase 6: a small Python project (no Git), with a package, relative imports, a loop and a test.
  const py = path.join(root, 'py-project');
  write(path.join(py, 'app/__init__.py'), '');
  write(path.join(py, 'app/main.py'), `"""Entry point. import not_real"""\nimport os\nfrom .models import User\nfrom . import ping\n`);
  write(path.join(py, 'app/models.py'), `class User:\n    pass\n`);
  write(path.join(py, 'app/ping.py'), `from .pong import pong\ndef ping(): return pong\n`);
  write(path.join(py, 'app/pong.py'), `from .ping import ping\ndef pong(): return ping\n`);
  write(path.join(py, 'tests/test_models.py'), `from app.models import User\n`);
  write(path.join(py, '.venv/lib/site.py'), `import never_read\n`);
  // Phase 6d: non-code files for the Files tab, one of them binary.
  write(path.join(py, 'README.md'), `# Demo\n\n## Setup\n`);
  fs.writeFileSync(path.join(py, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));

  // Phase 7: routes, calls and models (no Git).
  const apiDir = path.join(root, 'api-project');
  write(path.join(apiDir, 'server.js'), `const express = require('express');\nconst users = require('./routes/users');\nconst app = express();\napp.use('/api', users);\napp.get('/health', (req, res) => res.send('ok'));\n`);
  write(path.join(apiDir, 'routes/users.js'), `const router = require('express').Router();\nrouter.get('/users/:id', (req, res) => {});\nrouter.post('/users', (req, res) => {});\nmodule.exports = router;\n`);
  write(path.join(apiDir, 'web/client.js'), `export const load = (id) => fetch(\`/api/users/\${id}\`);\nexport const missing = () => fetch('/api/missing');\nexport const other = () => fetch('https://example.com/x');\n`);
  write(path.join(apiDir, 'app/api/items/route.ts'), `export async function GET() { return new Response('[]'); }\n`);
  write(path.join(apiDir, 'models.ts'), `@Entity('people')\nexport class Person {}\n`);
  write(path.join(apiDir, 'service.ts'), `import { Person } from './models';\nexport const p = Person;\nawait prisma.post.findMany();\n`);
  write(path.join(apiDir, 'schema.prisma'), `model Post {\n  id Int @id\n}\n`);
  write(path.join(apiDir, 'db/schema.sql'), `-- CREATE TABLE ignored (id int);\nCREATE TABLE orders (id int);\n`);
  write(path.join(apiDir, 'py/main.py'), `from fastapi import APIRouter\nrouter = APIRouter(prefix="/shop")\n\n@router.get("/cart/{cid}")\ndef cart(cid: int): ...\n\nrequests.get("http://localhost:8000/shop/cart/7")\n`);
  write(path.join(apiDir, '.env'), `DATABASE_URL=postgres://do-not-read\n`);
  // Phase 8: pages of several kinds in the same folder.
  write(path.join(apiDir, 'package.json'), JSON.stringify({ name: 'api-project', dependencies: { next: '15.0.0', express: '4.0.0' } }));
  write(path.join(apiDir, 'app/layout.tsx'), `export default function Root({ children }) { return children; }\n`);
  write(path.join(apiDir, 'app/users/page.tsx'), `import { load } from '../../web/client';\nexport default function UsersPage() { return null; }\n`);
  write(path.join(apiDir, 'web/router.jsx'), `import Profile from './Profile';\nexport const routes = <Routes><Route path="/profile/:name" element={<Profile />} /></Routes>;\n`);
  write(path.join(apiDir, 'web/Profile.jsx'), `export default function Profile() { return null; }\n`);
  write(path.join(apiDir, 'index.html'), `<!doctype html><script type="module" src="/web/client.js"></script>\n`);
  write(path.join(apiDir, 'site.js'), `const app = require('express')();\napp.get('/', (req, res) => res.render('home'));\n`);
  write(path.join(apiDir, 'views/home.ejs'), `<h1>Home</h1>\n`);
  // Phase 9: a fake key in code, and two near-duplicate names.
  write(path.join(apiDir, 'config.js'), `module.exports = { apiKey: "sk-fakefakefakefake1234" };\n`);
  write(path.join(apiDir, 'docs/notes.md'), `# Notes\n`);
  write(path.join(apiDir, 'docs/notes-old.md'), `# Old notes\n`);

  const workspace = path.join(root, 'sample.code-workspace');
  write(workspace, JSON.stringify({ folders: [{ path: 'sample-repo' }, { path: 'plain-folder' }, { path: 'py-project' }, { path: 'api-project' }] }));
  return workspace;
}

/** A fake Claude Code config folder with one session for the sample repo and one for another project. */
function createAgentLogs(configDir: string, repo: string): void {
  const dirName = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-');
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 29, 10, minute)).toISOString();
  const lines = [
    { type: 'ai-title', aiTitle: 'Sample session' },
    { type: 'user', cwd: repo, timestamp: at(0), message: { role: 'user', content: 'Make util return 2. token=supersecret99' } },
    { type: 'assistant', cwd: repo, timestamp: at(1), message: { id: 'm1', model: 'test-model', usage: { input_tokens: 3, output_tokens: 4 },
      content: [{ type: 'text', text: 'Changed it. Never commit the .env file because it holds secrets.' }, { type: 'tool_use', name: 'Edit', input: { file_path: path.join(repo, 'src', 'util.ts') } }] } },
    { type: 'user', cwd: repo, timestamp: at(2), message: { role: 'user', content: [{ type: 'tool_result', content: 'TOOL OUTPUT' }] } },
  ];
  write(path.join(configDir, 'projects', dirName(repo), 'session-1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  write(path.join(configDir, 'projects', dirName(repo), 'subagents', 'ignored.jsonl'), JSON.stringify(lines[1]) + '\n');
  const other = path.join(path.dirname(repo), 'other-project');
  write(path.join(configDir, 'projects', dirName(other), 'session-2.jsonl'), JSON.stringify({ ...lines[1], cwd: other }) + '\n');
}

/** Hash of every file outside .git and the notes folder (the only place notes may be written). */
function fingerprint(root: string): string {
  const hash = crypto.createHash('sha256');
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && (entry.name === '.git' || full.endsWith(path.join('.vibecode', 'notes')))) continue;
      if (entry.isDirectory()) walk(full);
      else hash.update(full).update(fs.readFileSync(full));
    }
  };
  walk(root);
  return hash.digest('hex');
}

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
  const extensionTestsPath = path.resolve(__dirname, 'suite');
  const vscodeExecutablePath = process.env.VSCODE_TEST_EXECUTABLE; // default: isolated download in .vscode-test/

  // Note: test-electron always passes --disable-workspace-trust, so Restricted Mode is checked manually (see README).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecode-sample-'));
  const userData = path.join(root, '.user-data');
  const workspace = createSample(path.join(root, 'ws'));
  const claudeConfig = path.join(root, '.claude-config');
  createAgentLogs(claudeConfig, path.join(root, 'ws', 'sample-repo'));
  write(path.join(userData, 'User', 'settings.json'), JSON.stringify({ 'git.openRepositoryInParentFolders': 'never' }));
  const before = fingerprint(path.join(root, 'ws'));
  console.log(`sample workspace: ${workspace}`);

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    // Points the Claude Code log reader at the fake logs instead of the real user folder.
    extensionTestsEnv: { CLAUDE_CONFIG_DIR: claudeConfig },
    launchArgs: [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${path.join(root, '.extensions')}`, '--disable-extensions'],
  });

  if (fingerprint(path.join(root, 'ws')) !== before) throw new Error('sample workspace files were modified');
  console.log('  ✔ sample workspace unchanged outside .vibecode/notes');
  const notes = fs.readdirSync(path.join(root, 'ws', 'sample-repo', '.vibecode', 'notes'));
  if (notes.length !== 4 || !notes.every((n) => /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(n))) throw new Error(`unexpected notes: ${notes}`);
  if (fs.readdirSync(path.join(root, 'ws', 'sample-repo', '.vibecode')).length !== 1) throw new Error('unexpected files in .vibecode');
  console.log('  ✔ notes folder holds only the 4 notes created by the test');
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
