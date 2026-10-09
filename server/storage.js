import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import path from 'node:path'
import { config } from './config.js'
import { HttpError } from './domain.js'
export async function readRecord(name) { try { return JSON.parse(await readFile(path.join(config.dataDir, name), 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
export async function writeRecord(name, value) {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 })
  const destination = path.join(config.dataDir, name)
  const temporary = destination + '.' + randomBytes(8).toString('hex') + '.tmp'
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
  await rename(temporary, destination)
}
export async function saveTokens(tokens) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(config.tokenKey, 'hex'), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens)), cipher.final()])
  await writeRecord('google-tokens.json', { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: encrypted.toString('hex') })
}
export async function loadTokens() {
  const record = await readRecord('google-tokens.json')
  if (!record) return null
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.tokenKey, 'hex'), Buffer.from(record.iv, 'hex'))
  decipher.setAuthTag(Buffer.from(record.tag, 'hex'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, 'hex')), decipher.final()]).toString())
}
export async function withBookingLock(work) {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 })
  const lock = path.join(config.dataDir, 'booking.lock')
  let handle
  try { handle = await open(lock, 'wx', 0o600) } catch (error) { if (error.code === 'EEXIST') throw new HttpError(503, 'Otra reserva está siendo procesada. Intenta nuevamente en unos segundos.'); throw error }
  try { await handle.writeFile(String(process.pid)); return await work() } finally { await handle.close(); await unlink(lock) }
}
