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
  git(repo, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'init');
  write(path.join(repo, 'src/util.ts'), `export function util() { return 2; }\n`);
  write(path.join(repo, 'src/new.ts'), `import { util } from './util';\nexport const n = util();\n`);
  write(path.join(repo, '.env'), `API_KEY=changed-do-not-read\n`);
  fs.rmSync(path.join(repo, 'src/old.ts'));

  const plain = path.join(root, 'plain-folder');
  write(path.join(plain, 'a.js'), `const b = require('./b');\n`);
  write(path.join(plain, 'b.js'), `module.exports = 1;\n`);

  const workspace = path.join(root, 'sample.code-workspace');
  write(workspace, JSON.stringify({ folders: [{ path: 'sample-repo' }, { path: 'plain-folder' }] }));
  return workspace;
}

/** Hash of every file outside .git, plus the Git index, to detect any modification. */
function fingerprint(root: string): string {
  const hash = crypto.createHash('sha256');
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name === '.git') continue;
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
  write(path.join(userData, 'User', 'settings.json'), JSON.stringify({ 'git.openRepositoryInParentFolders': 'never' }));
  const before = fingerprint(path.join(root, 'ws'));
  console.log(`sample workspace: ${workspace}`);

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${path.join(root, '.extensions')}`, '--disable-extensions'],
  });

  if (fingerprint(path.join(root, 'ws')) !== before) throw new Error('sample workspace files were modified');
  console.log('  ✔ sample workspace unchanged (read-only)');
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
