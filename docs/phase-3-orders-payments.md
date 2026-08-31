# FASE: Pedidos y pagos

## Implementado

- Creada una fuente de verdad en codigo para estados de pedido.
- Creada migracion para convertir estados legacy en minusculas a estados canonicos en mayusculas.
- Definidas transiciones permitidas para evitar saltos arbitrarios.

## Archivos modificados

- `supabase/007_order_states.sql`
- `src/lib/orderStates.js`
- `docs/phase-3-orders-payments.md`

## Migraciones creadas

- `supabase/007_order_states.sql`

## Pruebas realizadas

- Pendiente de conectar todas las rutas y ejecutar build.

## Criterios de aceptacion cumplidos

- [x] Existe una unica definicion de estados en codigo.
- [x] Existe una migracion para normalizar la base de datos.
- [x] Existe logica para validar transiciones.

## No verificado

- [ ] Pago correcto, cancelado, fallido y webhook duplicado con Stripe test.
- [ ] Aplicacion de migracion en Supabase real.
- [ ] Prueba de transicion invalida `PENDING -> DELIVERED`.

## Pendiente

- Conectar rutas de orders/Stripe a `ORDER_STATES`.
- Adaptar UI de pedidos a estados canonicos.
