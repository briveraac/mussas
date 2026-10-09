import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
export const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const envPath = path.join(projectRoot, '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
}
export const config = {
  port: Number(process.env.PORT || 3001), host: process.env.HOST || '127.0.0.1',
  origin: process.env.APP_ORIGIN || 'http://localhost:5173',
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/google/callback',
  clientId: process.env.GOOGLE_CLIENT_ID || '', clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  expectedEmail: process.env.GOOGLE_ACCOUNT_EMAIL || 'rydeitres@gmail.com',
  calendarId: process.env.GOOGLE_CALENDAR_ID || 'rydeitres@gmail.com',
  adminPassword: process.env.ADMIN_PASSWORD || '', tokenKey: process.env.TOKEN_ENCRYPTION_KEY || '',
  dataDir: path.resolve(projectRoot, process.env.DATA_DIR || '.data'),
}
export const configured = () => Boolean(config.clientId && config.clientSecret && config.adminPassword.length >= 16 && /^[a-f0-9]{64}$/i.test(config.tokenKey))
