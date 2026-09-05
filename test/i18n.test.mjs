import assert from 'node:assert/strict'
import test from 'node:test'
import { t, tx, setTranslator, SEG } from '../lib/i18n.js'
import { zh } from '../lib/locales/zh.js'

test('t falls back to the English key when no translator is bound', () => {
  setTranslator(key => key)
  assert.equal(t('Terminal'), 'Terminal')
})

test('t resolves Chinese through the bound dictionary', () => {
  setTranslator(key => zh[key] ?? key)
  assert.equal(t('Terminal'), '终端')
  assert.equal(t('No such string exists'), 'No such string exists')
  setTranslator(key => key)
})

test('tx interleaves expressions around translated segments', () => {
  setTranslator(key => zh[key] ?? key)
  const key = ['Authorized ', ' connections'].join(SEG)
  assert.ok(zh[key], 'dictionary carries the template key')
  const tag = (parts, ...exprs) => tx(parts, ...exprs)
  assert.equal(tag(['Authorized ', ' connections'], 3), '已授权 3 个连接')
  setTranslator(key => key)
  assert.equal(tag(['Authorized ', ' connections'], 3), 'Authorized 3 connections')
})

test('dictionary keys and values agree on template segment counts', () => {
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(key.split(SEG).length, value.split(SEG).length, `segment count mismatch for ${JSON.stringify(key.slice(0, 40))}`)
  }
})
