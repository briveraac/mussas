import { services, professionals, getSlots } from '../src/features/booking.js'
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status } }
export function validateSelection(input, now = new Date()) {
  if (!input || !Array.isArray(input.serviceIds) || !input.serviceIds.length || input.serviceIds.length > services.length || new Set(input.serviceIds).size !== input.serviceIds.length) throw new HttpError(400, 'Selecciona servicios válidos.')
  const chosen = input.serviceIds.map(id => services.find(item => item.id === id))
  const professional = professionals.find(item => item.id === input.professionalId)
  if (chosen.some(item => !item) || !professional) throw new HttpError(400, 'Servicio o profesional no válido.')
  const duration = chosen.reduce((sum, item) => sum + item.durationMinutes, 0)
  const slots = getSlots(input.date, duration, now)
  if (!slots.length) throw new HttpError(400, 'La fecha no tiene horarios disponibles para estos servicios.')
  return { chosen, professional, duration, slots }
}
export function zonedInstant(date, time) {
  const target = Date.parse(date + 'T' + time + ':00Z')
  if (!Number.isFinite(target)) throw new HttpError(400, 'Fecha inválida.')
  let instant = target
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant)).map(part => [part.type, part.value]))
    const represented = Date.parse(p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second + 'Z')
    const adjustment = target - represented
    if (!adjustment) return new Date(instant).toISOString()
    instant += adjustment
  }
  throw new HttpError(400, 'La hora no existe en la zona horaria del salón.')
}
export function interval(date, time, duration) {
  const start = zonedInstant(date, time)
  return { start, end: new Date(Date.parse(start) + duration * 60000).toISOString() }
}
export function availableSlots(date, duration, slots, busy) {
  return slots.filter(time => { const range = interval(date, time, duration); return !busy.some(item => Date.parse(range.start) < Date.parse(item.end) && Date.parse(range.end) > Date.parse(item.start)) })
}
export function validateBooking(input, now = new Date()) {
  const selection = validateSelection(input, now)
  if (!selection.slots.includes(input.time)) throw new HttpError(400, 'Hora fuera del horario de atención.')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const phone = typeof input.phone === 'string' ? input.phone.trim() : ''
  const email = typeof input.email === 'string' ? input.email.trim() : ''
  const notes = typeof input.notes === 'string' ? input.notes.trim() : ''
  if (name.length < 2 || name.length > 100 || phone.length > 25 || phone.replace(/\D/g, '').length < 8 || email.length > 150 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || notes.length > 1000) throw new HttpError(400, 'Revisa los datos de contacto.')
  return { ...selection, ...interval(input.date, input.time, selection.duration), name, phone, email, notes }
}
