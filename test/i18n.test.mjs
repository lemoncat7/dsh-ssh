import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { messages } from '../lib/locales/messages.js'
import { createLocaleStore, formatMessage, sshLocale, t } from '../lib/i18n.js'
import { bindHostLocale } from '../lib/ssh-locale-binding.js'
import { normalizeProfileDraft } from '../lib/domain.js'

test('display catalogs have semantic keys, complete languages and matching parameters', () => {
  for (const [key, entry] of Object.entries(messages)) {
    assert.match(key, /^[a-z][a-z-]*\.[a-z][A-Za-z0-9]*$/)
    assert.ok(entry.zh.trim(), key)
    assert.ok(entry.en.trim(), key)
    assert.doesNotMatch(entry.en, /[\u3400-\u9fff]/u, key)
    const params = text => [...text.matchAll(/\{(\d+)\}/g)].map(m => m[1]).sort()
    assert.deepEqual(params(entry.zh), params(entry.en), key)
  }
  assert.equal(Object.hasOwn(messages, '.'), false)
  assert.equal(Object.hasOwn(messages, ', '), false)
})

test('interpolation preserves user text literally and never translates paths or placeholders twice', () => {
  const raw = '/团队/运行中/{1}/<script> & "\n$&'
  assert.equal(formatMessage('client.deviceCodeExpiry', 'en', [raw]), `Code expires at ${raw}`)
  assert.equal(formatMessage('client.deviceCodeExpiry', 'zh', [raw]), `代码将在 ${raw} 失效`)
  assert.equal(formatMessage('.', 'zh'), '.')
})

test('locale store falls back to Chinese and only notifies on a language change', () => {
  const store = createLocaleStore(); let changes = 0
  assert.equal(store.getSnapshot(), 'zh')
  const stop = store.subscribe(() => changes++)
  store.setLocale('en-US'); store.setLocale('en'); store.setLocale('en_GB')
  assert.equal(store.getSnapshot(), 'en'); assert.equal(changes, 1)
  store.setLocale('zh-CN'); assert.equal(changes, 2)
  store.setLocale(undefined); assert.equal(changes, 2)
  stop(); store.setLocale('en'); assert.equal(changes, 2)
})

test('host language subscription adopts current language and cleans up safely on reload', () => {
  const host = () => {
    let active = 'en'; const listeners = new Set()
    return { getSnapshot: () => ({ active }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
      change(value) { active = value; for (const fn of listeners) fn() }, size: () => listeners.size }
  }
  const first = host(); const stopFirst = bindHostLocale(first)
  assert.equal(t('client.cancel'), 'Cancel')
  first.change('zh'); assert.equal(t('client.cancel'), '取消')
  const second = host(); const stopSecond = bindHostLocale(second)
  stopFirst(); assert.equal(first.size(), 0); assert.equal(sshLocale.getSnapshot(), 'en')
  first.change('zh'); assert.equal(sshLocale.getSnapshot(), 'en')
  stopSecond(); assert.equal(second.size(), 0); assert.equal(sshLocale.getSnapshot(), 'zh')
})

test('every UI translation call has an existing literal key and exact parameter arity', async () => {
  const root = new URL('../src/', import.meta.url)
  for (const file of (await readdir(root)).filter(name => /\.tsx?$/.test(name) && name !== 'i18n.ts')) {
    const source = await readFile(new URL(file, root), 'utf8')
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
        const [key, values] = node.arguments
        assert.ok(key && ts.isStringLiteral(key), file)
        assert.ok(Object.hasOwn(messages, key.text), `${file}: ${key.text}`)
        const count = [...messages[key.text].zh.matchAll(/\{(\d+)\}/g)].length
        assert.ok(values === undefined || ts.isArrayLiteralExpression(values), `${file}: ${key.text}`)
        assert.equal(values?.elements.length ?? 0, count, `${file}: ${key.text}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
})

test('server import graph never reaches UI translation, including shared business helpers', async () => {
  const visited = new Set(); const pending = ['index.ts']
  while (pending.length) {
    const file = pending.pop()
    if (visited.has(file)) continue
    visited.add(file)
    assert.doesNotMatch(file, /(?:i18n|locales\/|ssh-locale)/)
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly || !ts.isStringLiteral(node.moduleSpecifier)) continue
      const path = node.moduleSpecifier.text
      if (path.startsWith('./') && path.endsWith('.js')) pending.push(path.slice(2, -3) + '.ts')
    }
  }
  for (const file of ['api.ts', 'sftp.ts', 'forwards.ts', 'domain.ts', 'file-transfer-manager.ts']) assert.ok(visited.has(file), file)
})

test('Chinese and English UI produce identical proxy fields, user data and protocol values', () => {
  const input = { name: '运行中', host: '127.0.0.1', username: '用户', authType: 'password', tags: ['alpha', 'beta'],
    proxy: { type: 'socks5', host: '127.0.0.1', port: 1080, username: '代理用户' } }
  try {
    sshLocale.setLocale('zh'); const zh = normalizeProfileDraft(input)
    sshLocale.setLocale('en'); const en = normalizeProfileDraft(input)
    assert.deepEqual(en, zh)
    assert.equal(en.proxy.username, '代理用户')
    assert.equal(Object.hasOwn(en.proxy, 'proxy.username'), false)
    assert.equal(en.host, '127.0.0.1'); assert.equal(en.name, '运行中')
    assert.deepEqual(en.tags, ['alpha', 'beta'])
  } finally { sshLocale.setLocale('zh') }
})
