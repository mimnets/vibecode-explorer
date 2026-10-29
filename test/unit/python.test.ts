import { strict as assert } from 'assert';
import { test } from 'node:test';
import { isTestFile, isTestFor } from '../../src/analysis/explain';
import { buildGraph } from '../../src/analysis/graph';
import { GRAPH_EXTENSIONS, languageFor } from '../../src/analysis/languages';
import { parsePythonImports, resolvePython } from '../../src/analysis/python';
import { isExcludedFromAnalysis } from '../../src/analysis/sensitive';

test('Python import statements are read; comments, strings and docstrings are ignored', () => {
  const src = [
    '"""Module docstring.',
    'import not_a_real_import',
    'from fake import thing',
    '"""',
    '# import commented_out',
    'import os, sys as system',
    'import a.b.c as abc',
    'from . import sibling',
    'from .models import User, Order as O',
    'from ..core.db import (',
    '    connect,  # trailing comment',
    '    close,',
    ')',
    'from pkg import \\',
    '    name',
    'x = "import fake_in_string"; import json',
    'if TYPE_CHECKING: import typing_only',
    'def f():',
    '    import inside_function',
    "    s = '''",
    '    from also_fake import x',
    "    '''",
    'from __future__ import annotations',
    'from .wild import *',
  ].join('\n');
  const { imports, dynamicUnknown } = parsePythonImports(src);
  assert.deepEqual(imports, [
    { module: 'os', names: [] },
    { module: 'sys', names: [] },
    { module: 'a.b.c', names: [] },
    { module: '.', names: ['sibling'] },
    { module: '.models', names: ['User', 'Order'] },
    { module: '..core.db', names: ['connect', 'close'] },
    { module: 'pkg', names: ['name'] },
    { module: 'json', names: [] },
    { module: 'typing_only', names: [] },
    { module: 'inside_function', names: [] },
    { module: '__future__', names: ['annotations'] },
    { module: '.wild', names: [] },
  ]);
  assert.equal(dynamicUnknown, 0);
});

test('importlib with a fixed name is followed; a computed name is unknown', () => {
  const p = parsePythonImports('import importlib\nm = importlib.import_module("app.plugins")\nn = importlib.import_module(name)\no = __import__(f"x{y}")\n');
  assert.deepEqual(p.dynamicModules, ['app.plugins']);
  assert.equal(p.dynamicUnknown, 2);
});

test('Windows line endings and unterminated strings do not break the reader', () => {
  assert.deepEqual(parsePythonImports('import a\r\nfrom b import (\r\n  c,\r\n)\r\n').imports, [{ module: 'a', names: [] }, { module: 'b', names: ['c'] }]);
  assert.deepEqual(parsePythonImports('x = "unterminated\nimport ok\n').imports, [{ module: 'ok', names: [] }]);
});

test('Python imports resolve to files without guessing', () => {
  const files = new Set([
    'app/__init__.py', 'app/main.py', 'app/models.py', 'app/sibling.py', 'app/api/__init__.py', 'app/api/routes.py',
    'core/db.py', 'src/lib/tools.py', 'scripts/run.py', 'scripts/helper.py',
  ]);
  const resolve = (from: string, src: string) => resolvePython(from, parsePythonImports(src), files)
    .map((r) => `${r.specifier} ${r.kind}${r.target ? ' ' + r.target : ''}`);
  assert.deepEqual(resolve('app/api/routes.py', 'from ..models import User\nfrom .. import sibling\nfrom .. import VERSION\nfrom ... import too_high\nimport os\nimport requests'), [
    '..models local app/models.py',
    '..sibling local app/sibling.py',
    '.. local app/__init__.py',
    '... unknown',
    'os external',
    'requests external',
  ]);
  assert.deepEqual(resolve('app/main.py', 'from app.api import routes\nimport core.db\nfrom lib import tools\nfrom .missing import x'), [
    'app.api.routes local app/api/routes.py',
    'core.db local core/db.py',
    'lib.tools local src/lib/tools.py',
    '.missing unknown',
  ]);
  // A script finds its neighbours; a package's own __init__ is not a dependency of itself.
  assert.deepEqual(resolve('scripts/run.py', 'import helper'), ['helper local scripts/helper.py']);
  assert.deepEqual(resolve('app/__init__.py', 'from . import models'), ['.models local app/models.py']);
});

test('the graph builds a mixed JS/TS and Python project through the language list', async () => {
  assert.ok(GRAPH_EXTENSIONS.includes('.py') && GRAPH_EXTENSIONS.includes('.ts'));
  assert.equal(languageFor('a/b.py')?.name, 'Python');
  assert.equal(languageFor('a/b.tsx')?.name, 'JavaScript/TypeScript');
  assert.equal(languageFor('a/b.go'), undefined);
  const sources: Record<string, string> = {
    'web/index.ts': `import { x } from './util';`,
    'web/util.ts': 'export const x = 1;',
    'api/ping.py': 'from .pong import pong',
    'api/pong.py': 'from .ping import ping',
    'api/__pycache__/ping.cpython-312.py': 'import never_read',
    '.venv/lib/site.py': 'import never_read',
  };
  const graph = await buildGraph(Object.keys(sources), async (p) => sources[p], 100);
  const edges = graph.files.flatMap((f) => f.imports.filter((i) => i.kind === 'local').map((i) => `${f.path}->${i.target}`));
  assert.deepEqual(edges.sort(), ['api/ping.py->api/pong.py', 'api/pong.py->api/ping.py', 'web/index.ts->web/util.ts']);
  assert.deepEqual(graph.files.map((f) => f.path).sort(), ['api/ping.py', 'api/pong.py', 'web/index.ts', 'web/util.ts']);
});

test('Python build folders are skipped and Python tests are recognised', () => {
  for (const p of ['__pycache__/a.py', '.venv/x.py', 'venv/lib/y.py', 'pkg.egg-info/z.py', '.tox/t.py', 'lib/site-packages/s.py']) {
    assert.ok(isExcludedFromAnalysis(p), p);
  }
  assert.ok(!isExcludedFromAnalysis('app/env.py'));
  assert.ok(isTestFile('tests/test_models.py') && isTestFile('models_test.py') && !isTestFile('testing.py'));
  assert.ok(isTestFor('app/models.py', 'tests/test_models.py'));
  assert.ok(isTestFor('app/models.py', 'app/models_test.py'));
  assert.ok(!isTestFor('app/models.py', 'tests/test_models2.py'));
});
