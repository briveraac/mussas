import { readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { projectRoot } from './config.js'
const destination = path.join(projectRoot, '.env')
try { await writeFile(destination, (await readFile(path.join(projectRoot, '.env.example'), 'utf8')).replace('ADMIN_PASSWORD=\n', 'ADMIN_PASSWORD=' + randomBytes(24).toString('base64url') + '\n').replace('TOKEN_ENCRYPTION_KEY=\n', 'TOKEN_ENCRYPTION_KEY=' + randomBytes(32).toString('hex') + '\n'), { flag: 'wx', mode: 0o600 }); console.log('.env creado con claves locales. Completa GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET. La contraseña de /admin está en ADMIN_PASSWORD dentro del archivo.') } catch (error) { if (error.code === 'EEXIST') console.log('.env ya existe. No se modificó.'); else throw error }
