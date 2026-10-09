import { config, configured } from './config.js'
import { loadTokens, saveTokens } from './storage.js'
import { HttpError } from './domain.js'
const scopes = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy', 'https://www.googleapis.com/auth/userinfo.email']
async function request(url, options) {
  let response
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) } catch (error) {
    if (['EACCES', 'EPERM'].includes(error.cause?.code || error.code)) throw new HttpError(503, 'El backend no tiene permiso para conectarse a internet. Inícialo desde una terminal de tu computador y vuelve a conectar Google Calendar.')
    if (new URL(url).hostname === 'oauth2.googleapis.com') throw new HttpError(503, 'No pudimos comunicarnos con Google para autorizar la cuenta. Revisa la conexión e inicia nuevamente desde la pantalla de administración.')
    throw new HttpError(503, 'Google no respondió. Intenta nuevamente; conservaremos el identificador de tu solicitud.')
  }
  const data = await response.json().catch(() => ({}))
  return { response, data }
}
export function authorizationUrl(state, challenge) {
  if (!configured()) throw new HttpError(503, 'Completa primero la configuración del backend en .env.')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', login_hint: config.expectedEmail, state, code_challenge: challenge, code_challenge_method: 'S256' }).toString()
  return url.toString()
}
export async function exchangeCode(code, verifier) {
  const { response, data } = await request('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code, code_verifier: verifier, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }) })
  if (!response.ok || !data.access_token || !data.refresh_token || !scopes.every(scope => (data.scope || '').split(' ').includes(scope))) throw new HttpError(400, 'Google no otorgó todos los permisos. Vuelve a conectar y acepta el acceso al calendario.')
  const identity = await request('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: 'Bearer ' + data.access_token } })
  if (!identity.response.ok || !identity.data.verified_email || identity.data.email?.toLowerCase() !== config.expectedEmail.toLowerCase()) throw new HttpError(403, 'Debes autorizar la cuenta configurada para el salón.')
  const calendar = await request('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(config.calendarId) + '/events?maxResults=1', { headers: { Authorization: 'Bearer ' + data.access_token } })
  if (!calendar.response.ok) throw new HttpError(400, 'La cuenta no tiene acceso al calendario configurado.')
  await saveTokens({ accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000, email: identity.data.email })
}
let refreshPromise
async function accessToken() {
  if (!configured()) throw new HttpError(503, 'Google Calendar todavía no está configurado.')
  const tokens = await loadTokens()
  if (!tokens) throw new HttpError(503, 'El administrador debe conectar Google Calendar antes de reservar.')
  if (tokens.expiresAt > Date.now() + 60000) return tokens.accessToken
  if (!refreshPromise) refreshPromise = (async () => {
    const { response, data } = await request('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: tokens.refreshToken, grant_type: 'refresh_token' }) })
    if (!response.ok || !data.access_token) throw new HttpError(503, 'La autorización de Google venció. El administrador debe volver a conectar la cuenta.')
    await saveTokens({ ...tokens, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
    return data.access_token
  })().finally(() => { refreshPromise = undefined })
  return refreshPromise
}
export async function calendarRequest(endpoint, { method = 'GET', body } = {}) {
  const { response, data } = await request('https://www.googleapis.com/calendar/v3/' + endpoint, { method, headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (response.status === 404) return null
  if (response.status === 409) throw new HttpError(409, 'La solicitud ya fue procesada. Intenta nuevamente con el mismo formulario.')
  if (!response.ok) throw new HttpError(503, 'No pudimos consultar o actualizar Google Calendar. Reintenta más tarde o contacta al salón.')
  return data
}
export const eventPath = id => 'calendars/' + encodeURIComponent(config.calendarId) + '/events' + (id ? '/' + id : '')
export async function getBusy(start, end) {
  const result = await calendarRequest('freeBusy', { method: 'POST', body: { timeMin: start, timeMax: end, timeZone: 'America/Santiago', items: [{ id: config.calendarId }] } })
  const calendar = result?.calendars?.[config.calendarId]
  if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) throw new HttpError(503, 'No fue posible verificar la disponibilidad del calendario.')
  return calendar.busy
}
