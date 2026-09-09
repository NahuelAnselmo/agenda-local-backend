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
