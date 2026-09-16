import assert from 'node:assert/strict'
import test from 'node:test'
import { sortFileEntries } from '../lib/file-entry-sort.js'
import { sortRemoteEntries } from '../lib/remote-files.js'
import { ftpListDateSortValue } from '../lib/ftp-list-date.js'

test('FTP LIST text dates sort chronologically without changing display metadata', () => {
  const input = [
    {name:'a',path:'/a',kind:'file',size:900,modifiedAt:0,modifiedAtText:'Sep 12 2026'},
    {name:'z',path:'/z',kind:'file',size:10,modifiedAt:0,modifiedAtText:'May  9 2026'},
    {name:'b',path:'/b',kind:'file',size:100,modifiedAt:0,modifiedAtText:'Jan 01 2026'},
  ]
  assert.deepEqual(sortFileEntries(input,'modifiedAt','asc').map(e=>e.name),['b','z','a'])
  assert.deepEqual(sortFileEntries(input,'modifiedAt','desc').map(e=>e.name),['a','z','b'])
  assert.deepEqual(sortFileEntries(input,'size','asc').map(e=>e.name),['z','b','a'])
  assert.deepEqual(sortFileEntries(input,'size','desc').map(e=>e.name),['a','b','z'])
  assert.equal(input[0].modifiedAt,0)
})

test('LIST sorting handles recent dates and year boundaries without guessing display timestamps', () => {
  const now=Date.UTC(2026,0,2)
  assert.equal(ftpListDateSortValue('Dec 31 23:59',now),Date.UTC(2025,11,31,23,59))
  assert.equal(ftpListDateSortValue('Jan 02 12:00',now),Date.UTC(2026,0,2,12))
  assert.equal(ftpListDateSortValue('May  9 2024',now),Date.UTC(2024,4,9))
  for(const text of ['garbage','Feb 31 2026','Jan 01 25:00',undefined]) assert.equal(ftpListDateSortValue(text,now),0)
})

const entries = [
  { name: 'zeta.txt', path: '/zeta.txt', kind: 'file', size: 20, modifiedAt: 300 },
  { name: 'folder-10', path: '/folder-10', kind: 'directory', size: 0, modifiedAt: 100 },
  { name: 'alpha.txt', path: '/alpha.txt', kind: 'file', size: 5, modifiedAt: 200 },
  { name: 'folder-2', path: '/folder-2', kind: 'directory', size: 0, modifiedAt: 400 },
]

test('sorts a copy by name, size, and modified time while keeping directories first', () => {
  assert.deepEqual(sortFileEntries(entries, 'name', 'asc').map(entry => entry.name), ['folder-2', 'folder-10', 'alpha.txt', 'zeta.txt'])
  assert.deepEqual(sortFileEntries(entries, 'size', 'desc').map(entry => entry.name), ['folder-10', 'folder-2', 'zeta.txt', 'alpha.txt'])
  assert.deepEqual(sortFileEntries(entries, 'modifiedAt', 'asc').map(entry => entry.name), ['folder-10', 'folder-2', 'alpha.txt', 'zeta.txt'])
  assert.deepEqual(entries.map(entry => entry.name), ['zeta.txt', 'folder-10', 'alpha.txt', 'folder-2'])
})

test('large directory collation preserves natural multilingual order and stable ties', () => {
  const names = Array.from({ length: 10000 }, (_, i) => `文档-${(i * 7919) % 10000}.txt`)
  names.push('Readme', 'README', 'é', 'e', '文件2', '文件10')
  const input = names.map((name, i) => ({ name, path: `/${i}`, kind: i % 11 === 0 ? 'directory' : 'file', size: i % 7, modifiedAt: i % 13 }))
  const baseline = [...input].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  assert.deepEqual(sortFileEntries(input, 'name', 'asc'), baseline)
  assert.deepEqual(sortRemoteEntries([...input]), baseline)
  assert.deepEqual(input.map(entry => entry.name), names)
})
