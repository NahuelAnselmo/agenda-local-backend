# Agenda Local — API

API REST para disponibilidad y reserva de turnos, preparada para operar con
múltiples comercios mediante organizationId.

## Desarrollo local

1. Copiar .env.example como .env.
2. Ejecutar npm install.
3. Iniciar la API con npm run dev.

La API queda disponible en http://localhost:4000/api/v1.

## Comandos

- npm run typecheck: valida TypeScript.
- npm test: ejecuta las pruebas.
- npm run prisma:validate: valida el modelo PostgreSQL.
- npm run prisma:generate: genera Prisma Client.
- npm run build: compila a dist.

El primer prototipo utiliza datos ficticios en memoria para poder probar todo
sin configurar PostgreSQL. El esquema definitivo ya contempla organizaciones,
usuarios, membresías, profesionales, servicios, disponibilidad, ausencias y
turnos.
