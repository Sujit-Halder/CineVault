import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainSelection,normalizeColumns } from '../src/libraryView.js';

test('table selections cannot leak between result pages',() => {
  assert.deepEqual(constrainSelection(['a','b'],[{ id:'b' },{ id:'c' }]),['b']);
});

test('stored column preferences discard obsolete values and duplicates',() => {
  assert.deepEqual(normalizeColumns(['type','obsolete','type','rating'],['type','rating']),['type','rating']);
  assert.deepEqual(normalizeColumns([],['type','rating']),['type','rating']);
});
