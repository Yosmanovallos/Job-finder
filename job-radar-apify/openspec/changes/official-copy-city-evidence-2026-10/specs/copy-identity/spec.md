# Emparejamiento de copias por ciudad

## Requisito: ciudades específicas concordantes

Una copia de bolsa con empresa y título verificados NO DEBE ocultarse ni
redirigirse a una vacante oficial que declare otra ciudad específica.

### Escenario: Bogotá y Medellín

Una bolsa indica Medellín y el único portal oficial indica Bogotá para el
mismo cargo. La copia conserva su tarjeta y su propio detalle.

## Requisito: equivalencia de formato y ubicación amplia

Grafías de Bogotá D.C. y Capital District DEBEN poder coincidir con Bogotá.
La regla existente para una ubicación de solo país o remoto DEBE mantenerse.

## Requisito: corregir un enlace anterior sin resucitar ofertas viejas

Una copia enlazada antes a otra ciudad específica se restaura si su bolsa la
vio hace menos de 48 horas y no existe otro fingerprint activo. Una copia
vieja no reaparece por este cambio. Venezuela permanece fuera del paso.

### Escenario: enlace antiguo a una ciudad equivocada

Si una copia antigua de Medellín quedó enlazada a una oficial de Bogotá, su
URL NO DEBE redirigir a Bogotá. Debe responder como vacante retirada hasta
que la bolsa vuelva a verla; una copia de Bogotá correcta conserva su enlace.
