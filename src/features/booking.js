export const services = [
  { id: 'manicure', title: 'Manicure', description: 'Cuidado y diseño para unas manos únicas.', icon: '♡' },
  { id: 'pedicure', title: 'Pedicure', description: 'Un momento de cuidado y bienestar para tus pies.', icon: '✧' },
  { id: 'pestanas', title: 'Lifting y ondulación de pestañas', description: 'Realza tu mirada y la belleza natural de tus pestañas.', icon: '✧' },
  { id: 'depilacion', title: 'Depilación', description: 'Cuidado de tu piel con atención a cada detalle.', icon: '✺' },
  { id: 'peluqueria', title: 'Peluquería', description: 'Un espacio para cuidar tu cabello y renovar tu estilo.', icon: '✂' },
].map((service, index) => ({ ...service, number: String(index + 1).padStart(2, '0'), tag: 'UN MOMENTO PARA TI', durationMinutes: 60, price: null }))

// Duraciones provisionales. Completar precios y especialidades antes de activar reservas automáticas.
export const professionals = [
  { id: 'patricia', name: 'Patricia', phone: '56941847746', displayPhone: '+56 9 4184 7746' },
  { id: 'javiera', name: 'Javiera', phone: '56992400910', displayPhone: '+56 9 9240 0910' },
]
export const openingHours = { 1: [11, 19], 2: [11, 19], 3: [11, 19], 4: [11, 19], 5: [11, 19], 6: [11, 17] }
export function salonNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]))
  return { date: parts.year + '-' + parts.month + '-' + parts.day, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}
export function getSlots(date, duration, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || duration <= 0) return []
  const parsed = new Date(date + 'T12:00:00Z')
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return []
  const current = salonNow(now)
  const hours = openingHours[parsed.getUTCDay()]
  if (!hours || date < current.date) return []
  const slots = []
  for (let minute = hours[0] * 60; minute + duration <= hours[1] * 60; minute += 30) {
    if (date === current.date && minute <= current.minutes) continue
    slots.push(String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0'))
  }
  return slots
}
