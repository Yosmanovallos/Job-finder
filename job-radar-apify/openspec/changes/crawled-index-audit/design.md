# Método

UI GSC autenticada, propiedad sc-domain:buscotrabajo.co. Informe actualizado
22-Oct con ejemplos hasta 24-Oct. Diez primeras URLs visibles; primeras cinco
con inspección individual almacenada. La URL visible debe corresponder al
resultado antes de registrarlo: el cambio de página puede dejar el estado
previo en la accesibilidad durante la carga. Se descartaron lecturas de
transición y se confirmó cada URL antes del resultado final.

GET públicos propios acotados, sin credenciales, fuentes externas ni datos
de usuario. Parsear metadata/JSON-LD; guardar solo conteos, campos públicos
permitidos y hash de descripción. Hash distinto no prueba contenido único.
No interpretar falta de jobLocation físico como error si hay TELECOMMUTE y
país de candidatos. No deducir calidad solo del número de palabras.

No hay migración ni cambio de interfaz. Rollback: revert documental. No se
requiere desplegar el build sintético. No se gastan solicitudes de indexación
en páginas ya indexadas. No se extrapola la muestra a todas las exclusiones.
