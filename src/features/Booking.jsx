import { useEffect, useRef, useState } from 'react'
import { services, professionals, getSlots, salonNow } from './booking.js'

function readRequestIdentity() {
  try { const value = JSON.parse(sessionStorage.getItem('mussas-booking-request')); return typeof value?.fingerprint === 'string' && typeof value?.key === 'string' ? value : null } catch { return null }
}
function storeRequestIdentity(value) {
  try { if (value) sessionStorage.setItem('mussas-booking-request', JSON.stringify(value)); else sessionStorage.removeItem('mussas-booking-request') } catch { /* Reintentos siguen funcionando en memoria si el navegador bloquea almacenamiento. */ }
}
export default function Booking() {
  const [selected, setSelected] = useState([])
  const [professionalId, setProfessionalId] = useState('patricia')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [demoPrices, setDemoPrices] = useState(false)
  const [error, setError] = useState('')
  const chosen = services.filter(service => selected.includes(service.id))
  const duration = chosen.reduce((total, service) => total + service.durationMinutes, 0)
  const [calendar, setCalendar] = useState(null)
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [availabilityError, setAvailabilityError] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [revision, setRevision] = useState(0)
  const requestIdentity = useRef(readRequestIdentity())
  const selectionKey = selected.slice().sort().join(',')
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/calendar/status', { signal: controller.signal }).then(response => { if (!response.ok) throw new Error(); return response.json() }).then(setCalendar).catch(error => { if (error.name !== 'AbortError') setCalendar({ connected: false, unavailable: true }) })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setSlots([]); setTime(''); setAvailabilityError(''); setLoading(false)
    if (!date || !duration) return () => controller.abort()
    const candidates = getSlots(date, duration)
    if (!candidates.length) return () => controller.abort()
    if (!calendar?.connected) { setSlots(candidates); return () => controller.abort() }
    setLoading(true)
    fetch('/api/availability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, serviceIds: selectionKey.split(','), professionalId }), signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No pudimos consultar la agenda.'); return result })
      .then(result => { setSlots(result.slots); setLoading(false) })
      .catch(error => { if (error.name !== 'AbortError') { setAvailabilityError(error.message); setLoading(false) } })
    return () => controller.abort()
  }, [date, duration, selectionKey, professionalId, calendar?.connected, revision])
  const professional = professionals.find(person => person.id === professionalId)
  function toggle(id) {
    setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id])
    setTime('')
    setError('')
  }
  function requestWhatsapp(event) {
    event.preventDefault()
    if (!chosen.length) return setError('Selecciona al menos un servicio.')
    if (!getSlots(date, duration).includes(time)) return setError('Selecciona una fecha y una hora válidas dentro del horario de atención.')
    const data = new FormData(event.currentTarget)
    const name = String(data.get('name')).trim()
    const phone = String(data.get('phone')).trim()
    if (name.length < 2 || phone.replace(/\D/g, '').length < 8) return setError('Revisa tu nombre y teléfono de contacto.')
    const endMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + duration
    const end = String(Math.floor(endMinutes / 60)).padStart(2, '0') + ':' + String(endMinutes % 60).padStart(2, '0')
    const message = [
      'Hola Mussas, quisiera solicitar una hora (pendiente de confirmación).',
      'Nombre: ' + name, 'Teléfono: ' + phone, 'Correo: ' + (data.get('email') || 'No indicado'),
      'Servicios: ' + chosen.map(service => service.title).join(', '),
      'Profesional solicitada: ' + professional.name,
      'Fecha: ' + date.split('-').reverse().join('/'), 'Horario solicitado: ' + time + ' a ' + end,
      'Duración provisional de prueba: ' + duration + ' minutos.',
      'Precio: por confirmar con el salón.',
      'Observaciones: ' + (String(data.get('notes')).trim() || 'Sin observaciones'),
    ].join('\n')
    setError('')
    window.location.assign('https://wa.me/' + professional.phone + '?text=' + encodeURIComponent(message))
  }
  async function submit(event) {
    event.preventDefault()
    if (event.nativeEvent.submitter?.value === 'whatsapp') return requestWhatsapp(event)
    if (sending || confirmation) return
    if (!calendar?.connected || !slots.includes(time)) return setError('Selecciona una hora disponible con Google Calendar conectado.')
    const data = new FormData(event.currentTarget)
    const input = { serviceIds: chosen.map(item => item.id), professionalId, date, time, name: String(data.get('name')).trim(), phone: String(data.get('phone')).trim(), email: String(data.get('email')).trim(), notes: String(data.get('notes')).trim() }
    setSending(true); setError('')
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)))
      const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      if (requestIdentity.current?.fingerprint !== fingerprint) requestIdentity.current = { fingerprint, key: crypto.randomUUID() }
      storeRequestIdentity(requestIdentity.current)
      const response = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestIdentity.current.key }, body: JSON.stringify(input) })
      const result = await response.json()
      if (!response.ok) { if (response.status === 409) { setRevision(value => value + 1); requestIdentity.current = null; storeRequestIdentity(null) } throw new Error(result.error || 'No pudimos confirmar la reserva.') }
      setConfirmation({ ...result, professional: professional.name, services: chosen.map(item => item.title).join(', ') })
    } catch (error) { setError(error.message || 'No se pudo conectar. Reintenta sin cambiar los datos para evitar duplicados.') }
    finally { setSending(false) }
  }
  return <section id="reservas" className="booking section-wrap">
    <div className="section-heading"><div><p className="eyebrow">PLANIFICA TU VISITA</p><h2>Un ratito <em>para cuidarte.</em></h2></div><p>Lunes a viernes · 11:00 a 19:00<br />Sábado · 11:00 a 17:00<br />Domingo · cerrado</p></div>
    <div className="booking-notice"><strong>Agenda en prueba</strong><p>Por ahora, cada servicio dura 1 hora para probar el formulario. Con Google conectado, las horas se consultan en el calendario y la reserva se confirma al crear el evento. Mientras no esté conectado, puedes solicitar tu hora por WhatsApp. Usamos una agenda compartida para ambas profesionales.</p></div>
    <div className="booking-layout"><form className="booking-form" onSubmit={submit}>
      <fieldset disabled={sending || Boolean(confirmation)}><legend>1. Elige tus servicios</legend><div className="service-options">{services.map(service => <label key={service.id} className={selected.includes(service.id) ? 'service-option selected' : 'service-option'}><input type="checkbox" checked={selected.includes(service.id)} onChange={() => toggle(service.id)} /><span>{service.title}<small>60 min · duración de prueba</small></span></label>)}</div></fieldset>
      <fieldset disabled={sending || Boolean(confirmation)}><legend>2. Elige profesional y horario</legend><div className="form-grid"><label>Profesional<select value={professionalId} onChange={event => { setProfessionalId(event.target.value); setTime('') }}>{professionals.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Fecha<input type="date" required min={salonNow().date} value={date} onChange={event => { setDate(event.target.value); setTime('') }} /></label><label className="full-width">Hora de inicio<select required value={time} disabled={loading || sending || !date || !chosen.length || !slots.length} onChange={event => setTime(event.target.value)}><option value="">Selecciona una hora</option>{slots.map(slot => <option key={slot} value={slot}>{slot}</option>)}</select></label></div><p className="field-help" role="status">{loading ? 'Consultando Google Calendar…' : availabilityError ? availabilityError : !chosen.length ? 'Selecciona servicios para calcular la duración.' : !date ? 'Elige una fecha para ver los horarios.' : !slots.length ? 'No hay horarios para esta fecha y duración. Prueba otro día.' : calendar?.connected ? 'Horarios consultados en Google Calendar. Hora local de Santiago.' : 'Horarios sujetos a confirmación por WhatsApp. Hora local de Santiago.'}</p><p className="field-help">La asignación de servicios a cada profesional también está pendiente de confirmar.</p></fieldset>
      <fieldset disabled={sending || Boolean(confirmation)}><legend>3. Tus datos</legend><div className="form-grid"><label>Nombre<input name="name" autoComplete="name" required minLength={2} maxLength={100} placeholder="Tu nombre" /></label><label>Teléfono<input name="phone" type="tel" autoComplete="tel" required minLength={8} maxLength={25} placeholder="+56 9…" /></label><label className="full-width">Correo <span className="optional">(opcional)</span><input name="email" type="email" autoComplete="email" maxLength={150} placeholder="tu@correo.cl" /></label><label className="full-width">Observaciones <span className="optional">(opcional)</span><textarea name="notes" rows={3} maxLength={1000} placeholder="Cuéntanos qué tienes en mente" /></label></div></fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {confirmation ? <div className="booking-confirmation" role="status"><strong>¡Tu reserva está confirmada en Google Calendar!</strong><p>{confirmation.services} · {confirmation.professional}</p><p>{new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'long', timeStyle: 'short' }).format(new Date(confirmation.start))}</p><p>Referencia: {confirmation.reference}</p><button type="button" className="text-button" onClick={() => { setConfirmation(null); requestIdentity.current = null; storeRequestIdentity(null); setRevision(value => value + 1) }}>Hacer otra reserva</button></div> : <><button type="submit" name="intent" value={calendar?.connected ? 'calendar' : 'whatsapp'} className="button" disabled={sending || loading || !chosen.length || !slots.includes(time)}>{sending ? 'Confirmando reserva…' : calendar?.connected ? 'Confirmar reserva en la agenda' : 'Solicitar por WhatsApp'} <span>↗</span></button><p className="field-help">{calendar?.connected ? 'Confirmaremos la hora solo después de guardar el evento en Google Calendar. El precio está pendiente de evaluación. No se envía invitación por correo.' : 'Se abrirá WhatsApp con los datos para ' + professional.name + '. La solicitud requiere confirmación del salón.'}</p>{calendar?.connected && <button type="submit" name="intent" value="whatsapp" className="text-button" disabled={sending || !slots.includes(time)}>Prefiero consultar por WhatsApp ↗</button>}</>}
    </form><aside className="quote-panel"><p className="eyebrow">TU VISITA, A TU MEDIDA</p><h3>Simula tu cotización</h3><div className="quote-warning"><strong>ESTO ES UNA SIMULACIÓN</strong><p>El precio puede variar. El valor final será confirmado por el salón según el servicio y sus características.</p></div><div className="quote-items">{chosen.length ? chosen.map(service => <div key={service.id}><span>{service.title}</span><span>{demoPrices ? '$15.000' : 'Por definir'}</span></div>) : <p>Selecciona servicios para preparar tu estimación.</p>}</div><div className="quote-total"><span>{demoPrices ? 'Total ficticio de prueba' : 'Valor estimado'}</span><strong>{demoPrices && chosen.length ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(chosen.length * 15000) : 'Por confirmar'}</strong></div><p className="field-help">Duración de prueba: {duration} minutos. Los servicios se consideran consecutivos con una misma profesional.</p><label className="demo-toggle"><input type="checkbox" checked={demoPrices} onChange={event => setDemoPrices(event.target.checked)} /><span>Usar valores ficticios para probar</span></label>{demoPrices ? <p className="field-help">$15.000 por servicio es un valor inventado para probar el cálculo. No corresponde a las tarifas de Mussas y no se envía como cotización.</p> : <p className="field-help">Los precios y factores de cálculo están pendientes. No podemos dar todavía una cotización cercana al valor real.</p>}<div className="calendar-status"><strong>Google Calendar · {calendar === null ? 'consultando…' : calendar.connected ? 'conectado' : 'pendiente de conexión'}</strong><p>Calendario de prueba: {calendar?.calendarEmail || 'rydeitres@gmail.com'}</p><p>{calendar?.unavailable ? 'El backend no responde. Puedes solicitar una hora por WhatsApp.' : calendar?.connected ? 'Agenda compartida: un horario ocupado bloquea a ambas profesionales.' : 'El administrador debe autorizar la cuenta para activar las reservas automáticas.'}</p></div></aside></div>
  </section>
}
