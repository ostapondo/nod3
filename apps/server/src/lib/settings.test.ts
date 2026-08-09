import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Every call is given a scratch directory explicitly.
 *
 * Overriding the env var did not work: `config.ts` resolves the data directory
 * at import time, so the suite wrote to the real `data/settings.json` — running
 * tests while the app was open silently reset the user's chosen language, which
 * then looked like a bug in the app. Tests must never touch a live install.
 */
import { readSettings, writeSettings } from './settings.js'

const SCRATCH = await mkdtemp(path.join(tmpdir(), 'nod3-settings-'))
const FILE = path.join(SCRATCH, 'settings.json')

after(async () => {
  await rm(SCRATCH, { recursive: true, force: true })
})

test('the scratch directory really is where writes land', async () => {
  await writeSettings({ language: 'go' }, SCRATCH)
  const onDisk = JSON.parse(await readFile(FILE, 'utf8'))
  assert.equal(onDisk.language, 'go')
  assert.ok(SCRATCH.startsWith(tmpdir()), 'must not be the real data directory')
})

test('a saved language is read back from disk', async () => {
  await writeSettings({ language: 'java' }, SCRATCH)
  assert.deepEqual(await readSettings(SCRATCH), { language: 'java' })
})

test('null clears the choice so the first-run screen comes back', async () => {
  await writeSettings({ language: 'java' }, SCRATCH)
  await writeSettings({ language: null }, SCRATCH)
  assert.deepEqual(await readSettings(SCRATCH), { language: null })
})

test('an unknown language is refused rather than stored', async () => {
  await writeSettings({ language: 'python' }, SCRATCH)
  await assert.rejects(
    () => writeSettings({ language: 'brainfuck' }, SCRATCH),
    /Unsupported language/,
  )
  assert.deepEqual(
    await readSettings(SCRATCH),
    { language: 'python' },
    'the old value must survive',
  )
})

test('a corrupted settings file degrades to asking again, not to a crash', async () => {
  await writeFile(FILE, '{ this is not json', 'utf8')
  assert.deepEqual(await readSettings(SCRATCH), { language: null })
})
