# FASE: Estados de productos y doble venta

## Implementado

- Agregado `products.status` con estados `DRAFT`, `ACTIVE`, `RESERVED`, `SOLD`, `INACTIVE`, `REMOVED`.
- Agregados campos de reserva: `reserved_by`, `reserved_until` y `sold_at`.
- Creada funcion atomica `reserve_products_for_checkout` para pasar productos de `ACTIVE` a `RESERVED`.
- Creada funcion `mark_products_sold_by_payment_intent` para pasar reservas confirmadas a `SOLD`.
- Creada funcion `release_product_reservations_by_payment_intent` para liberar reservas si falla/cancela el pago.
- Marketplace, detalle y relacionados filtran productos reales por `ACTIVE`.
- Publicacion permite crear productos como `DRAFT` o `ACTIVE`; por defecto conserva el comportamiento actual y crea `ACTIVE`.
- Stripe PaymentIntent reserva productos antes de crear ordenes.
- Webhook/captura de Stripe marcan productos como `SOLD` solo tras confirmar/capturar pago.
- El endpoint directo de ordenes hace una actualizacion atomica de `ACTIVE` a `SOLD` antes de crear la orden.

## Archivos modificados

- `supabase/006_product_states.sql`
- `src/app/api/products/search/route.js`
- `src/app/api/products/[id]/route.js`
- `src/app/api/products/related/route.js`
- `src/app/api/publish/route.js`
- `src/app/api/stripe/create-payment-intent/route.js`
- `src/app/api/stripe/capture-payment/route.js`
- `src/app/api/stripe/webhook/route.js`
- `src/app/api/orders/route.js`
- `docs/phase-2-product-states.md`

## Migraciones creadas

- `supabase/006_product_states.sql`

## Pruebas realizadas

- `npm run build` ejecutado correctamente con Next.js 16.2.12.
- Busqueda de endpoints publicos reales de producto: marketplace, detalle y relacionados filtran por `ACTIVE`.
- Busqueda de funciones de reserva/venta/liberacion: checkout Stripe, captura y webhook quedan conectados a las RPC creadas.
- Pendiente de aplicar migracion y probar concurrencia real en Supabase.

## Criterios de aceptacion cumplidos

- [x] Existe una definicion de estados de producto: `DRAFT`, `ACTIVE`, `RESERVED`, `SOLD`, `INACTIVE`, `REMOVED`.
- [x] Existe una funcion SQL para reservar productos de forma atomica solo desde `ACTIVE`.
- [x] Solo productos `ACTIVE` aparecen en las APIs publicas reales de marketplace/detalle/relacionados.
- [x] Un producto `RESERVED` o `SOLD` no puede pasar de nuevo por el flujo de reserva atomica.
- [x] El frontend no decide por si mismo que un producto queda vendido en el flujo Stripe.

## No verificado

- [ ] Compra simultanea con dos usuarios reales.
- [ ] Pago correcto, fallido, cancelado y webhook duplicado con Stripe real/test.
- [ ] Aplicacion de la migracion en Supabase real.
- [ ] Que no queden flujos legacy que creen ventas reales sin pasar por Stripe; el endpoint directo `/api/orders` queda protegido contra doble venta pero sigue siendo flujo no-Stripe.

## Pendiente

- Programar liberacion de reservas expiradas (`reserved_until`) si el usuario abandona el checkout sin evento de Stripe.
- Unificar estados de pedidos en Fase 3.
