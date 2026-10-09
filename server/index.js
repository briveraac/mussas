import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { config, configured, projectRoot } from './config.js'
import { loadTokens, readRecord, writeRecord, withBookingLock } from './storage.js'
import { HttpError, validateSelection, validateBooking, interval, availableSlots } from './domain.js'
import { authorizationUrl, exchangeCode, calendarRequest, eventPath, getBusy } from './google.js'
const oauthSessions = new Map()
const limits = new Map()
const hash = value => createHash('sha256').update(value).digest('hex')
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }
function admin(req, res) {
  if (config.adminPassword.length < 16) throw new HttpError(503, 'Configura ADMIN_PASSWORD con al menos 16 caracteres en .env.')
  const expected = Buffer.from('admin:' + config.adminPassword)
  const actual = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Mussas admin", charset="UTF-8"' }); res.end('Ingresa el usuario admin y ADMIN_PASSWORD.'); return false }
  return true
}
function checkOrigin(req) {
  if (req.headers.origin !== config.origin) throw new HttpError(403, 'Origen de solicitud no permitido.')
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'Envía datos JSON.')
}
function rateLimit(req) {
  const key = req.socket.remoteAddress
  const now = Date.now()
  if (limits.size > 10000) for (const [address, entry] of limits) if (entry.until < now) limits.delete(address)
  let entry = limits.get(key)
  if (!entry || entry.until < now) { entry = { count: 0, until: now + 60000 }; limits.set(key, entry) }
  if (++entry.count > 60) throw new HttpError(429, 'Demasiadas solicitudes. Espera un minuto.')
}
async function body(req) {
  let size = 0; const chunks = []
  for await (const chunk of req) { size += chunk.length; if (size > 16000) throw new HttpError(413, 'El formulario es demasiado grande.'); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { throw new HttpError(400, 'Formulario inválido.') }
}
const adminHtml = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Conectar Google · Mussas</title><style>body{font:16px Arial;background:#fcf9f5;color:#493b36;max-width:650px;margin:60px auto;padding:24px;line-height:1.7}button{background:#ae6f77;color:white;border:0;padding:16px;cursor:pointer}h1{font-family:Georgia}</style><h1>Conectar la agenda de Mussas</h1><p>Autoriza la cuenta indicada en GOOGLE_ACCOUNT_EMAIL. Se guardará el acceso cifrado en el servidor. Los visitantes no necesitan iniciar sesión.</p><form method="post" action="/api/google/connect"><button>Conectar con Google Calendar</button></form><p>Después de autorizar, vuelve al formulario de reservas.</p></html>'
async function route(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname.startsWith('/api/')) rateLimit(req)
  if (req.method === 'GET' && url.pathname === '/api/calendar/status') {
    const tokens = configured() ? await loadTokens() : null
    return json(res, 200, { configured: configured(), connected: Boolean(tokens), calendarEmail: config.expectedEmail, sharedCalendar: true })
  }
  if (req.method === 'GET' && url.pathname === '/admin') {
    // no-referrer turns the Origin of HTML POST forms into null in browsers.
    // Keep same-origin metadata for CSRF validation without leaking it to Google.
    res.setHeader('Referrer-Policy', 'same-origin')
    if (!admin(req, res)) return
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'" }); return res.end(adminHtml)
  }
  if (req.method === 'POST' && url.pathname === '/api/google/connect') {
    if (!admin(req, res)) return
    const origin = new URL(config.redirectUri).origin
    if (req.headers.origin !== origin) throw new HttpError(403, 'Abre la pantalla de administración directamente en el backend.')
    const state = randomBytes(32).toString('hex'); const verifier = randomBytes(48).toString('base64url')
    for (const [key, session] of oauthSessions) if (session.expires < Date.now()) oauthSessions.delete(key)
    const location = authorizationUrl(state, createHash('sha256').update(verifier).digest('base64url'))
    oauthSessions.set(state, { verifier, expires: Date.now() + 600000 })
    res.writeHead(303, { Location: location, 'Set-Cookie': 'mussas_oauth=' + state + '; HttpOnly; SameSite=Lax; Path=/api/google; Max-Age=600' + (origin.startsWith('https:') ? '; Secure' : '') }); return res.end()
  }
  if (req.method === 'GET' && url.pathname === '/api/google/callback') {
    const state = url.searchParams.get('state'); const session = oauthSessions.get(state)
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('mussas_oauth='))?.slice(13)
    oauthSessions.delete(state)
    res.setHeader('Set-Cookie', 'mussas_oauth=; HttpOnly; SameSite=Lax; Path=/api/google; Max-Age=0')
    if (!session || session.expires < Date.now() || state !== cookie) throw new HttpError(400, 'Conexión vencida o inválida. Inicia nuevamente desde /admin.')
    if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new HttpError(400, 'No se autorizó la conexión con Google.')
    await exchangeCode(url.searchParams.get('code'), session.verifier)
    res.writeHead(303, { Location: config.origin + '/?calendar=connected#reservas' }); return res.end()
  }
  if (req.method === 'POST' && url.pathname === '/api/availability') {
    checkOrigin(req); const input = await body(req); const selection = validateSelection(input)
    const first = interval(input.date, selection.slots[0], selection.duration)
    const last = interval(input.date, selection.slots.at(-1), selection.duration)
    const busy = await getBusy(first.start, last.end)
    return json(res, 200, { slots: availableSlots(input.date, selection.duration, selection.slots, busy) })
  }
  if (req.method === 'POST' && url.pathname === '/api/bookings') {
    checkOrigin(req); const input = await body(req)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Formulario inválido.')
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[a-f0-9-]{36}$/i.test(key)) throw new HttpError(400, 'Identificador de reserva inválido.')
    const id = hash(key); const recordName = 'booking-' + id + '.json'
    const fingerprint = hash(JSON.stringify([input.serviceIds, input.professionalId, input.date, input.time, input.name, input.phone, input.email, input.notes]))
    return withBookingLock(async () => {
      const previous = await readRecord(recordName)
      if (previous && previous.fingerprint !== fingerprint) throw new HttpError(409, 'La solicitud cambió. Actualiza el formulario antes de reintentar.')
      if (previous?.result) return json(res, 200, previous.result)
      // Reconcile ambiguous Google responses before checking availability again.
      if (previous) {
        const existing = await calendarRequest(eventPath(id))
        if (existing && existing.status !== 'cancelled') {
          const result = { confirmed: true, reference: id.slice(0, 12), start: existing.start.dateTime, end: existing.end.dateTime }
          await writeRecord(recordName, { fingerprint, result }); return json(res, 200, result)
        }
        if (existing?.status === 'cancelled') throw new HttpError(409, 'Esta reserva fue cancelada. Inicia una nueva solicitud.')
      }
      const booking = validateBooking(input)
      const busy = await getBusy(booking.start, booking.end)
      if (busy.some(item => Date.parse(booking.start) < Date.parse(item.end) && Date.parse(booking.end) > Date.parse(item.start))) throw new HttpError(409, 'La hora acaba de ocuparse. Elige otro horario.')
      await writeRecord(recordName, { fingerprint })
      const description = ['Nombre: ' + booking.name, 'Teléfono: ' + booking.phone, 'Correo: ' + (booking.email || 'No indicado'), 'Profesional: ' + booking.professional.name, 'Servicios: ' + booking.chosen.map(item => item.title).join(', '), 'Duración provisional: ' + booking.duration + ' minutos (60 min por servicio).', 'Precio por confirmar. Las simulaciones no son tarifas finales.', 'Observaciones: ' + (booking.notes || 'Sin observaciones')].join('\n')
      await calendarRequest(eventPath(), { method: 'POST', body: { id, summary: 'Mussas · ' + booking.professional.name + ' · ' + booking.name, description, location: 'Llico 1089, San Miguel, Chile', start: { dateTime: booking.start, timeZone: 'America/Santiago' }, end: { dateTime: booking.end, timeZone: 'America/Santiago' }, extendedProperties: { private: { mussasReference: id, professionalId: booking.professional.id } } } })
      const result = { confirmed: true, reference: id.slice(0, 12), start: booking.start, end: booking.end }
      await writeRecord(recordName, { fingerprint, result }); return json(res, 201, result)
    })
  }
  if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Ruta no encontrada.')
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido.')
  const dist = path.join(projectRoot, 'dist')
  let file = path.resolve(dist, '.' + decodeURIComponent(url.pathname))
  if (!file.startsWith(dist + path.sep) && file !== dist) throw new HttpError(404, 'Ruta no encontrada.')
  try { if (!(await stat(file)).isFile()) file = path.join(dist, 'index.html') } catch { file = path.join(dist, 'index.html') }
  let content
  try { content = await readFile(file) } catch { throw new HttpError(404, 'Compila el frontend con npm run build o usa npm run dev.') }
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(req.method === 'HEAD' ? undefined : content)
}
export const server = http.createServer((req, res) => route(req, res).catch(error => {
  if (res.headersSent) { res.end(); return }
  if (!error.status) console.error('Error interno:', error.name)
  json(res, error.status || 500, { error: error.status ? error.message : 'Ocurrió un error interno. Contacta al salón.' })
}))
server.requestTimeout = 20000; server.headersTimeout = 15000
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) server.listen(config.port, config.host, () => console.log('Backend Mussas: http://' + config.host + ':' + config.port + ' · Google ' + (configured() ? 'configurado' : 'pendiente de configurar .env')))
