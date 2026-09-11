# Agenda Local — API

API REST para disponibilidad y reserva de turnos, preparada para operar con
múltiples comercios mediante organizationId.

## Desarrollo local

1. Copiar .env.example como .env.
2. Ejecutar npm install.
3. Ejecutar npx prisma dev -d -n agenda-local y copiar la URL obtenida en .env.
4. Ejecutar npx prisma migrate dev --config prisma7.config.ts.
5. Ejecutar npx prisma db seed --config prisma7.config.ts.
6. Iniciar la API con npm run dev.

La API queda disponible en http://localhost:4000/api/v1.

## Comandos

- npm run typecheck: valida TypeScript.
- npm test: ejecuta las pruebas.
- npm run prisma:validate: valida el modelo PostgreSQL.
- npm run prisma:generate: genera Prisma Client.
- npm run build: genera Prisma Client y compila a dist.
- npm run db:dev: inicia PostgreSQL local.
- npm run db:migrate: aplica migraciones pendientes.
- npm run db:seed: restaura los datos ficticios.

La carga inicial crea Norte Studio, cuatro servicios, tres profesionales,
horarios semanales, turnos de muestra y un usuario propietario:

- Email: admin@nortestudio.demo
- Contraseña: Demo1234!

El esquema contempla organizaciones, usuarios, membresías, profesionales,
servicios, disponibilidad, ausencias, sesiones y turnos.

## Flujos disponibles

- Consulta pública del negocio, servicios y profesionales.
- Cálculo de disponibilidad y creación de reservas sin superposiciones.
- Comprobante público y cancelación mediante token seguro.
- Autenticación con sesión HTTP-only para el panel.
- Métricas y agenda con búsqueda por cliente, profesional, estado y fecha.
- Confirmación, cancelación, finalización y reprogramación validada de turnos.
- Gestión del catálogo, equipo, asignación de servicios, horarios y perfil del
  negocio.
- Accesos individuales: el propietario administra el negocio completo y cada
  profesional queda limitado a sus propios turnos.
- Envío automático del acceso por email mediante Resend, incluyendo enlace de
  ingreso, usuario y contraseña temporal.

Todas las operaciones administrativas se limitan a la organización de la
sesión. Los turnos cancelados se conservan para mantener historial operativo.

## Emails de acceso

Para enviar las credenciales automáticamente se deben configurar
`RESEND_API_KEY` y `EMAIL_FROM`. El remitente de `EMAIL_FROM` debe pertenecer a
un dominio verificado en Resend. `FRONTEND_URL` se usa para construir el enlace
`/admin` incluido en el mensaje. Si el proveedor no está configurado o rechaza
el envío, la cuenta igualmente queda creada y el panel muestra las credenciales
para compartirlas manualmente.
