import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeColumns,updatePageSelection } from '../src/libraryView.js';

test('table selections persist across pages and page clearing stays scoped',() => {
  const first=[{ id:'a',type:'movie',title:'A' }];
  const second=[{ id:'b',type:'series',title:'B' }];
  const selected=updatePageSelection(updatePageSelection([],first,true),second,true);
  assert.deepEqual(selected.map((item) => item.id),['a','b']);
  assert.deepEqual(updatePageSelection(selected,second,false).map((item) => item.id),['a']);
});

test('stored column preferences discard obsolete values and duplicates',() => {
  assert.deepEqual(normalizeColumns(['type','obsolete','type','rating'],['type','rating']),['type','rating']);
  assert.deepEqual(normalizeColumns([],['type','rating']),['type','rating']);
});
