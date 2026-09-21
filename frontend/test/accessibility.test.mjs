import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(relative) => fs.readFileSync(path.join(root,relative),'utf8');

test('interactive library surfaces expose names and table semantics',() => {
  const table=read('src/components/LibraryTable.jsx');
  assert.match(table,/aria-label="Compact library table"/);
  assert.match(table,/scope="row"/);
  assert.match(table,/aria-label={`Select \$\{item\.title\}`}/);
  assert.match(table,/title={`Edit \$\{item\.title\}`}/);
});

test('global styles preserve focus visibility and reduced-motion preferences',() => {
  const css=read('src/index.css');
  assert.match(css,/:focus-visible/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css,/\.sr-only/);
});
