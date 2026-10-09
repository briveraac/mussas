import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

test('OAuth, disponibilidad, cifrado e idempotencia', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mussas-test-'))
  Object.assign(process.env, { DATA_DIR: directory, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', ADMIN_PASSWORD: 'test-password-long-enough', TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32), APP_ORIGIN: 'http://localhost:5173', GOOGLE_REDIRECT_URI: 'http://localhost:3001/api/google/callback', GOOGLE_ACCOUNT_EMAIL: 'rydeitres@gmail.com', GOOGLE_CALENDAR_ID: 'rydeitres@gmail.com' })
  const originalFetch = globalThis.fetch
  const events = new Map()
  let inserts = 0
  let grantEmail = 'rydeitres@gmail.com'
  let ambiguous = false
  const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  globalThis.fetch = async (url, options = {}) => {
    const endpoint = String(url)
    if (endpoint.startsWith('http://127.0.0.1:')) return originalFetch(url, options)
    if (endpoint === 'https://oauth2.googleapis.com/token') return respond({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/userinfo.email' })
    if (endpoint.includes('/oauth2/v2/userinfo')) return respond({ email: grantEmail, verified_email: true })
    if (endpoint.endsWith('/freeBusy')) return respond({ calendars: { 'rydeitres@gmail.com': { busy: [...events.values()].map(event => ({ start: event.start.dateTime, end: event.end.dateTime })) } } })
    if (endpoint.includes('/events?')) return respond({ items: [] })
    if (endpoint.endsWith('/events') && options.method === 'POST') {
      const event = JSON.parse(options.body)
      if (events.has(event.id)) return respond({}, 409)
      events.set(event.id, event); inserts++
      if (ambiguous) { ambiguous = false; throw new Error('timeout after insert') }
      return respond(event)
    }
    if (endpoint.includes('/events/')) return events.has(endpoint.split('/').at(-1)) ? respond(events.get(endpoint.split('/').at(-1))) : respond({}, 404)
    throw new Error('Unexpected request: ' + endpoint)
  }
  const { server } = await import('../server/index.js')
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  const post = (route, input, key = randomUUID(), origin = 'http://localhost:5173') => originalFetch(base + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input) })
  async function connect(email) {
    grantEmail = email
    const begin = await originalFetch(base + '/api/google/connect', { method: 'POST', redirect: 'manual', headers: { Origin: 'http://localhost:3001', Authorization: 'Basic ' + Buffer.from('admin:test-password-long-enough').toString('base64') } })
    assert.equal(begin.status, 303)
    const location = new URL(begin.headers.get('location'))
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256')
    const cookie = begin.headers.get('set-cookie').split(';')[0]
    return originalFetch(base + '/api/google/callback?code=test-code&state=' + location.searchParams.get('state'), { redirect: 'manual', headers: { Cookie: cookie } })
  }
  try {
    const { getSlots } = await import('../src/features/booking.js')
    const { zonedInstant, availableSlots, validateBooking } = await import('../server/domain.js')
    assert.equal(zonedInstant('2027-01-04', '11:00'), '2027-01-04T14:00:00.000Z')
    assert.equal(zonedInstant('2027-07-05', '11:00'), '2027-07-05T15:00:00.000Z')
    const now = new Date('2026-10-08T12:00:00Z')
    assert.deepEqual(getSlots('2026-10-11', 60, now), [])
    assert.equal(getSlots('2026-10-10', 60, now).at(-1), '16:00')
    assert.equal(getSlots('2026-10-09', 120, now).at(-1), '17:00')
    assert.deepEqual(getSlots('2026-02-30', 60, now), [])
    assert.deepEqual(availableSlots('2027-01-04', 60, ['11:00', '12:00'], [{ start: '2027-01-04T15:00:00Z', end: '2027-01-04T16:00:00Z' }]), ['11:00'])
    const input = { serviceIds: ['manicure'], professionalId: 'patricia', date: '2099-01-05', time: '11:00', name: 'Cliente Prueba', phone: '+56 9 1111 1111', email: 'prueba@example.com', notes: 'Reserva de prueba' }
    while (!getSlots(input.date, 60).length) input.date = new Date(Date.parse(input.date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
    assert.throws(() => validateBooking({ ...input, serviceIds: ['manicure', 'manicure'] }))
    assert.throws(() => validateBooking({ ...input, time: '19:00' }))
    const adminPage = await originalFetch(base + '/admin')
    assert.equal(adminPage.status, 401)
    assert.equal(adminPage.headers.get('referrer-policy'), 'same-origin')
    const authorizedAdmin = await originalFetch(base + '/admin', { headers: { Authorization: 'Basic ' + Buffer.from('admin:test-password-long-enough').toString('base64') } })
    assert.equal(authorizedAdmin.status, 200)
    assert.ok(authorizedAdmin.headers.get('content-security-policy').includes("form-action 'self' https://accounts.google.com;"))
    assert.equal((await originalFetch(base + '/api/google/connect', { method: 'POST', headers: { Origin: 'https://attacker.example', Authorization: 'Basic ' + Buffer.from('admin:test-password-long-enough').toString('base64') } })).status, 403)
    assert.equal((await originalFetch(base + '/api/google/callback?code=fake&state=wrong')).status, 400)
    assert.equal((await post('/api/bookings', input)).status, 503)
    assert.equal((await post('/api/availability', input, randomUUID(), 'https://attacker.example')).status, 403)
    assert.equal((await connect('wrong@example.com')).status, 403)
    assert.equal((await connect('rydeitres@gmail.com')).status, 303)
    assert.equal((await (await originalFetch(base + '/api/calendar/status')).json()).connected, true)
    const encrypted = await readFile(path.join(directory, 'google-tokens.json'), 'utf8')
    assert.equal(encrypted.includes('private-refresh-token'), false)
    assert.equal(encrypted.includes('private-access-token'), false)
    assert.ok((await (await post('/api/availability', input)).json()).slots.includes('11:00'))
    const key = randomUUID()
    const first = await post('/api/bookings', input, key)
    assert.equal(first.status, 201)
    assert.equal((await first.json()).confirmed, true)
    assert.equal(inserts, 1)
    assert.equal((await post('/api/bookings', input, key)).status, 200)
    assert.equal(inserts, 1)
    assert.equal((await post('/api/bookings', { ...input, name: 'Otro nombre' }, key)).status, 409)
    assert.equal((await post('/api/bookings', { ...input, professionalId: 'javiera' })).status, 409)
    const after = await (await post('/api/availability', input)).json()
    assert.equal(after.slots.includes('11:00'), false)
    assert.equal(after.slots.includes('12:00'), true)
    const saved = [...events.values()][0]
    assert.ok(saved.description.includes('Reserva de prueba'))
    assert.ok(saved.description.includes('Patricia'))
    assert.equal(saved.start.timeZone, 'America/Santiago')
    ambiguous = true
    const ambiguousKey = randomUUID()
    const ambiguousInput = { ...input, time: '12:00' }
    assert.equal((await post('/api/bookings', ambiguousInput, ambiguousKey)).status, 503)
    assert.equal((await post('/api/bookings', ambiguousInput, ambiguousKey)).status, 200)
    assert.equal(inserts, 2)
    const simultaneous = await Promise.all([post('/api/bookings', { ...input, time: '13:00' }), post('/api/bookings', { ...input, time: '13:00' })])
    assert.equal(simultaneous.filter(response => response.status === 201).length, 1)
    assert.ok([409, 503].includes(simultaneous.find(response => response.status !== 201).status))
    assert.equal(inserts, 3)
  } finally {
    globalThis.fetch = originalFetch
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + 'mussas-test-'))
    await rm(directory, { recursive: true, force: true })
  }
})
