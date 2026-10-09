# Mussas Beauty Studio

Página React + Vite y backend Node.js para reservas con Google Calendar. El backend no necesita dependencias adicionales. Requiere Node.js 20.19+ o 22.12+.

## Iniciar en tu computador

1. Ejecuta `npm install` si aún no tienes las dependencias.
2. Ejecuta `npm run setup`. Crea `.env` con contraseña de administración y clave de cifrado, sin sobrescribir uno existente.
3. Completa las credenciales de Google en `.env` siguiendo la sección siguiente.
4. Ejecuta `npm run dev`. Abre http://localhost:5173. Backend en http://localhost:3001.
5. Abre http://localhost:3001/admin. Usuario: `admin`. Contraseña: el valor de `ADMIN_PASSWORD` en tu archivo `.env`.
6. Pulsa **Conectar con Google Calendar** y autoriza **rydeitres@gmail.com**. Vuelve al formulario: mostrará Calendar conectado.
7. Elige servicios, fecha y hora. Al confirmar se crea el evento y aparece su referencia.

Sin configuración o autorización, solo se permite solicitar una hora por WhatsApp. Nunca se muestra confirmación de Calendar si no se creó el evento.

## Configuración de Google

1. Crea o selecciona un proyecto en https://console.cloud.google.com/ y habilita **Google Calendar API**.
2. En **Google Auth Platform**, configura nombre de app, correo de soporte y audiencia externa si usas Gmail personal. Durante pruebas añade **rydeitres@gmail.com** como usuario de prueba.
3. Crea un cliente OAuth de tipo **Aplicación web**.
4. Agrega exactamente esta URI de redirección autorizada: `http://localhost:3001/api/google/callback`.
5. Copia el Client ID y Client Secret en `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` del archivo local `.env`. No los publiques ni los pongas en variables VITE_. Reinicia el backend.
6. Conserva `GOOGLE_ACCOUNT_EMAIL=rydeitres@gmail.com` y `GOOGLE_CALENDAR_ID=rydeitres@gmail.com` para estas pruebas.

Se solicita acceso a eventos, consulta de disponibilidad e identificación del correo de la cuenta autorizada. El backend verifica que la cuenta sea la configurada. Si el proyecto OAuth sigue en modo Testing, Google puede expirar el refresh token a los 7 días: vuelve a conectar o configura la app para producción según los requisitos de Google.

Documentación oficial: https://developers.google.com/identity/protocols/oauth2/web-server y https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query .

## Comportamiento de la agenda

- Lunes a viernes 11:00–19:00; sábado 11:00–17:00; domingo cerrado.
- Una hora provisional por servicio, servicios consecutivos con la profesional seleccionada, inicios cada 30 minutos.
- Horario local de Santiago, incluyendo cambios de horario de verano.
- Se consultan los eventos ocupados antes de mostrar horas y nuevamente antes de crear la reserva.
- **Agenda compartida:** cualquier evento ocupado bloquea a ambas profesionales. Los eventos transparentes/no ocupados no bloquean. Para atención simultánea hay que configurar calendarios por profesional y confirmar sus especialidades.
- El evento incluye servicios, nombre, teléfono, correo, profesional, observaciones, dirección y duración. No se envían invitaciones ni correos automáticos a clientes.
- Un bloqueo de archivo serializa las reservas del backend. Cada envío tiene un identificador persistente: reintentar el mismo formulario evita duplicar eventos, incluso si la respuesta de Google se perdió. El identificador de envío y un hash del formulario se conservan en sessionStorage para reintentos en la misma pestaña; no se guardan los datos de contacto. Tras recargar, reingresa exactamente los mismos datos para recuperar la solicitud.
- Google Calendar no ofrece una transacción entre consultar disponibilidad y crear el evento. Un cambio manual o de otra aplicación justo entre ambas operaciones todavía podría producir un cruce. Las reservas hechas por este backend se serializan.
- Una confirmación significa que el evento se guardó; no implica precio final ni pago.
- No se implementaron cancelaciones desde la web ni notificaciones. Los cambios manuales en Calendar se reflejan al volver a consultar disponibilidad.

## Cotización y datos pendientes

El simulador usa precios por definir y ofrece un modo explícito de valores ficticios ($15.000 por servicio). No se guardan como tarifas reales. Configura duración, precios y servicios en `src/features/booking.js`. Los factores de cotización y especialidades quedan pendientes de los datos del salón.

## Datos y seguridad

`.env` y `.data/` están excluidos de Git. Los tokens se cifran con AES-256-GCM y `TOKEN_ENCRYPTION_KEY`. Conserva esa clave para poder leerlos después de reiniciar. La carpeta `.data` también guarda referencias y hashes de solicitudes, sin datos de contacto en los registros locales; los detalles se guardan en Google Calendar. No compartas copias de esa carpeta ni de `.env`.

Si el proceso se interrumpe durante una reserva puede quedar `.data/booking.lock`. Detén todas las instancias, confirma que no hay una operación activa y elimina únicamente ese archivo antes de reiniciar. El bloqueo no se elimina automáticamente para evitar interferir con operaciones activas.

## Publicar más adelante

Ejecuta `npm run build` y `npm start`. El backend sirve el frontend compilado y la API. Para exponerlo configura `HOST=0.0.0.0`, `APP_ORIGIN=https://tu-dominio`, `GOOGLE_REDIRECT_URI=https://tu-dominio/api/google/callback` y autoriza esa URI en Google. Usa HTTPS mediante el hosting/proxy, secretos del servidor y almacenamiento persistente para `DATA_DIR`. Mantén una única instancia del backend (o implementa base de datos y bloqueo distribuido para escalar). En producción el proxy y el backend deben aplicar límites por cliente; el límite incorporado usa la IP de conexión y no confía en encabezados reenviados.

## Verificación

`npm test`: reglas horarias, zona de Santiago, OAuth/estado/cuenta correcta, cifrado, disponibilidad, duplicados, reservas simultáneas y recuperación de respuestas ambiguas, con Google simulado. No escribe eventos reales.

`npm run build`: compilación del frontend.
