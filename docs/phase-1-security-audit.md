# FASE: Auditoria y seguridad

## Implementado

- Eliminado el fallback de clientes server-side a `NEXT_PUBLIC_SUPABASE_ANON_KEY` en el helper compartido y en rutas API revisadas.
- Endurecidas las rutas de subida para exigir autenticacion, aceptar solo `image/jpeg`, `image/png` e `image/webp`, y limitar el tamano a 5 MB.
- La subida a Supabase Storage guarda imagenes bajo una carpeta del usuario autenticado.
- Creada una migracion de base de datos para exponer `public_profiles` y restringir lecturas directas de `public.users` al propietario.
- Sustituida la policy anonima de insercion en Storage por policies autenticadas y acotadas al propietario.
- Limitados los datos de vendedor devueltos por busqueda/detalle de productos para no exponer email, telefono, direccion ni balance.
- Eliminados accesos privados basados solo en `x-user-email` o `sellerEmail` en perfil y publicacion.
- Eliminados accesos por `x-user-email`/`x-user-id` en seguimiento, premium, alertas de precio y suscripcion Stripe.
- Limitados los datos devueltos por ofertas para evitar `users(*)` en participantes y vendedores.

## Archivos modificados

- `src/lib/serverSupabase.js`
- `src/lib/serverAuth.js`
- `src/app/api/upload-image/route.js`
- `src/app/api/upload/route.js`
- `src/app/api/stats/route.js`
- `src/app/api/message/route.js`
- `src/app/api/sms/send/route.js`
- `src/app/api/sms/verify/route.js`
- `src/app/api/users/search/route.js`
- `src/app/api/register/route.js`
- `src/app/api/products/search/route.js`
- `src/app/api/products/[id]/route.js`
- `src/app/api/profile/route.js`
- `src/app/api/publish/route.js`
- `src/app/api/publish/[id]/route.js`
- `src/app/api/offers/route.js`
- `src/app/api/follow/route.js`
- `src/app/api/premium/status/route.js`
- `src/app/api/alerts/price/route.js`
- `src/app/api/stripe/subscribe/route.js`
- `src/lib/dataService.js`
- `src/app/sell/page.js`
- `src/app/seller/[username]/page.js`
- `src/hooks/usePremium.js`
- `src/components/PremiumPaywall.js`
- `src/components/PriceAlertButton.js`
- `supabase/005_security_foundation.sql`
- `docs/phase-1-security-audit.md`

## Migraciones creadas

- `supabase/005_security_foundation.sql`

## Pruebas realizadas

- `npm run lint` ejecutado. No valida todavia porque hay 30 errores y 19 warnings preexistentes en pantallas/componentes no modificados por esta fase.
- `npm run build` ejecutado correctamente con Next.js 16.2.12.
- Busqueda de fallbacks `SUPABASE_SERVICE_ROLE_KEY || NEXT_PUBLIC_SUPABASE_ANON_KEY` en `src/app/api` y `src/lib`: sin resultados.
- Busqueda de `x-user-email`, `x-user-id`, `sellerEmail` y joins `users(*)` en rutas/componentes revisados: sin resultados.
- Busqueda de valores literales tipo `sk_live`, `sk_test`, asignaciones de `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PASSWORD`, `SECRET` y `API_KEY`: sin secretos hardcodeados; solo aparece una mencion documental a `service_role` en SQL.
- Pendiente de aplicar migracion en Supabase real.
- Pendiente de pruebas con dos usuarios reales.

## Criterios de aceptacion cumplidos

- [x] `.env` y `.env.local` estan ignorados por Git mediante `.env*`.
- [x] No se han encontrado valores literales de `STRIPE_SECRET_KEY` ni `SUPABASE_SERVICE_ROLE_KEY` hardcodeados; solo referencias a variables de entorno.
- [x] `STRIPE_SECRET_KEY` solo aparece en rutas/librerias server-side.
- [x] `SUPABASE_SERVICE_ROLE_KEY` no aparece en componentes cliente.
- [x] No quedan fallbacks server-side de `SUPABASE_SERVICE_ROLE_KEY` a `NEXT_PUBLIC_SUPABASE_ANON_KEY` en `src/app/api` ni `src/lib`, salvo el cliente publico de Supabase.
- [x] Las rutas de upload rechazan usuarios no autenticados.
- [x] Las rutas de upload rechazan MIME types no permitidos.
- [x] Las rutas de upload aplican limite de tamano.
- [x] La migracion elimina la insercion anonima en `storage.objects` para `card-images`.
- [x] Las APIs de marketplace revisadas ya no devuelven `seller:users(*)`.
- [x] Las rutas privadas revisadas no aceptan email de cabecera/body como autenticacion suficiente.
- [x] Las APIs de ofertas revisadas ya no devuelven participantes con `users(*)`.

## No verificado

- [ ] Que todas las tablas sensibles tengan RLS correcto en la instancia real.
- [ ] Que Usuario A no pueda leer/modificar/eliminar datos privados de Usuario B en Supabase real.
- [ ] Que el perfil publico no exponga email, telefono, direccion, datos de pago o balance en todas las pantallas restantes.
- [ ] Que Storage rechace `archivo.exe`, `archivo.php`, `archivo.js` y SVG malicioso en la instancia real.

## Pendiente

- Adaptar las consultas publicas restantes de frontend/API para leer `public_profiles` cuando no necesiten datos privados.
- Crear pruebas automatizadas de RLS con dos usuarios.
- Revisar estados de producto/pedido y doble venta en la Fase 2.
