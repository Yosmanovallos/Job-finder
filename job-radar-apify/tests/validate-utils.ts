import { extractStructuredFromHtml, htmlEntities } from '../src/utils.js';

type Case = {
  label: string;
  html: string;
  expectedDescription: string;
  expectedRequirements: string[];
  // true: compara la descripción tal cual, incluyendo saltos de línea
  // reales — para casos donde el punto del test ES el salto de línea
  // (secciones de Magneto), normalize() los borraría y el test no
  // probaría nada.
  exact?: boolean;
};

const cases: Case[] = [
  {
    // Bug real encontrado 2026-08-12 en el mismo texto de "Jefe De Tienda
    // Ara": ":" pegados directo a la palabra siguiente. Seguro de corregir
    // a diferencia del punto — los dos puntos nunca son parte de una
    // abreviatura real en español.
    label: 'Dos puntos pegados a la palabra siguiente ganan espacio',
    html: 'Lo que necesitamos de ti:Vivir actualmente. Condiciones laborales:Contrato a término indefinido.',
    expectedDescription: 'Lo que necesitamos de ti: Vivir actualmente. Condiciones laborales: Contrato a término indefinido.',
    expectedRequirements: [],
    exact: true
  },
  {
    // Notación de hora/proporción con dígitos no debe tocarse — el patrón
    // solo actúa sobre letras después de los dos puntos, nunca dígitos.
    label: 'Notación de hora (dígitos tras los dos puntos) no se toca',
    html: 'El turno empieza a las 3:00pm y la pantalla es 16:9.',
    expectedDescription: 'El turno empieza a las 3:00pm y la pantalla es 16:9.',
    expectedRequirements: [],
    exact: true
  },
  {
    // Bug real reportado por el usuario 2026-08-12 contra una vacante real
    // de Magneto: frases pegadas sin espacio ("aledañosPasión",
    // "aprender.Capacidad") — reproducido aquí con <strong> glued
    // directamente a la palabra anterior/siguiente, sin espacio en el HTML
    // fuente, que es la forma real en que un editor de texto enriquecido
    // (Word/CMS) suele emitir ese HTML.
    label: 'Tags inline pegados a palabras adyacentes no concatenan sin espacio',
    html: '<p>disponibilidad de laborar en Sabaneta- Antioquia o lugares aledaños<strong>Pasión por el servicio al cliente, excelente actitud y disposición para aprender.</strong>Capacidad para realizar múltiples tareas</p>',
    expectedDescription:
      'disponibilidad de laborar en Sabaneta- Antioquia o lugares aledaños Pasión por el servicio al cliente, excelente actitud y disposición para aprender. Capacidad para realizar múltiples tareas',
    expectedRequirements: []
  },
  {
    // Bug real encontrado 2026-08-12 corriendo un scrape real de Magneto
    // ("Asistente Administrativa y Contable", vacante real): el propio
    // string `description` de Magneto trae esta lista de palabras clave
    // pegada SIN ningún tag ni separador entre ellas — verificado leyendo
    // el HTML crudo directo (no hay <span>/<li>/coma entre las frases, es
    // así en el dato fuente). Sin frontera de tag que detectar, la señal
    // usada es minúscula->mayúscula, segura en español.
    label: 'Palabras clave de Magneto pegadas sin tag (bug de su propio dato fuente)',
    html: 'Palabras clave: Asistente Administrativa y ContableAsistente ContableAuxiliar ContableAuxiliar AdministrativaContapymeNómina electrónicaBogotá',
    expectedDescription:
      'Palabras clave: Asistente Administrativa y Contable Asistente Contable Auxiliar Contable Auxiliar Administrativa Contapyme Nómina electrónica Bogotá',
    expectedRequirements: []
  },
  {
    label: '<p> de apertura sin cerrar (HTML mal anidado) sigue separando líneas',
    html: '<p>Primera oración.<p>Segunda oración sin que la primera se haya cerrado.</p>',
    expectedDescription: 'Primera oración.\nSegunda oración sin que la primera se haya cerrado.',
    expectedRequirements: []
  },
  {
    label: '<br> sigue funcionando como salto de línea',
    html: 'Línea uno<br>Línea dos<br/>Línea tres',
    expectedDescription: 'Línea uno\nLínea dos\nLínea tres',
    expectedRequirements: []
  },
  {
    label: '<li> se extraen como requirements, no quedan en la descripción',
    html: '<p>Intro del puesto.</p><ul><li>Requisito uno</li><li>Requisito dos</li></ul>',
    expectedDescription: 'Intro del puesto.',
    expectedRequirements: ['Requisito uno', 'Requisito dos']
  },
  {
    label: 'HTML vacío no revienta',
    html: '',
    expectedDescription: '',
    expectedRequirements: []
  },
  {
    // Bug real encontrado 2026-08-12 leyendo el JSON-LD crudo de "Jefe De
    // Tienda Ara" (Magneto): trae `\n` reales en puntos arbitrarios a
    // mitad de frase (artefacto de wrap a ~75-80 caracteres, sin relación
    // con puntuación ni fin de oración) — reproducido aquí con la frase
    // real. Antes cada uno se trataba como salto de línea real, produciendo
    // un muro de líneas cortas picadas. Ahora se normalizan a espacio antes
    // de cualquier otro procesamiento — el resultado debe ser UNA sola
    // línea fluida, sin `\n` de por medio.
    label: '\\n crudos de wrap (mitad de frase) se colapsan a espacio, no a salto de línea',
    html: 'trabajamos cada día con un\npropósito claro: democratizar el acceso a alimentos de calidad para todos los\ncolombianos.',
    expectedDescription:
      'trabajamos cada día con un propósito claro: democratizar el acceso a alimentos de calidad para todos los colombianos.',
    expectedRequirements: [],
    exact: true
  },
  {
    // Vacante real de Magneto sin NINGÚN separador entre secciones (ni tag
    // ni `\n`) — solo la lista fija de etiquetas de su plantilla. Cada una
    // debe generar un salto de línea real antes de sí misma.
    label: 'Etiquetas de sección conocidas de Magneto generan salto de línea real',
    html: 'Serás una pieza clave en la gestión. Responsabilidades: Realizar causaciones contables. Requerimientos: Técnico o Tecnólogo. Nivel de educación: Técnico',
    // Bug real corregido 2026-08-12 (verificado con dos vacantes reales de
    // Magneto — "Analista Técnico I+D" y "Desarrollador De Software AI
    // First"): "Responsabilidades:"/"Requerimientos:" quedaban mezclados
    // dentro de description como texto plano, sin viñetas ni sección propia
    // — ahora se enrutan a requirements (splitRequirementsSections).
    // "Nivel de educación:" no es un REQUIREMENTS_SECTION_LABELS (es
    // metadata del resumen auto-generado de Magneto), así que se queda en
    // description con su propio salto de línea, como antes.
    expectedDescription: 'Serás una pieza clave en la gestión.\nNivel de educación: Técnico',
    expectedRequirements: ['Realizar causaciones contables.', 'Técnico o Tecnólogo.'],
    exact: true
  },
  {
    // Vacante real de Magneto ("Desarrollador De Software AI First"):
    // "Requisitos:" en la MISMA línea que su contenido, sin ningún `\n`
    // entre ítems — separados por doble espacio. "Ofrecemos" (no incluido
    // aquí) cerraría la zona sin absorberse a requirements.
    label: 'Requisitos: con ítems separados por doble espacio (sin \\n) se separan en requirements',
    html: 'Buscamos un perfil técnico. Requisitos:  Profesional en ingeniería de sistemas.  Experiencia mínima de 3 años.  Manejo de Node.js y Python.',
    expectedDescription: 'Buscamos un perfil técnico.',
    expectedRequirements: [
      'Profesional en ingeniería de sistemas.',
      'Experiencia mínima de 3 años.',
      'Manejo de Node.js y Python.'
    ],
    exact: true
  },
  {
    // "Ofrecemos" son beneficios del empleador, no requisitos del
    // candidato — debe cerrar la zona de requirements sin que su
    // contenido termine ahí (sería tergiversar el dato).
    label: 'Ofrecemos cierra la zona de requirements sin absorber su contenido',
    html: 'Perfil requerido\nProfesional en Ingeniería.\nOfrecemos\nSalario a convenir.',
    expectedDescription: 'Ofrecemos\nSalario a convenir.',
    expectedRequirements: ['Profesional en Ingeniería.'],
    exact: true
  },
  {
    // Vacante real de Elempleo ("Profesional Junior de Desarrollos BI",
    // confirmado en vivo 2026-08-12): sus ítems de "Requisitos:" traen su
    // propio glifo de viñeta ("•\t") en vez de \n o doble espacio — debe
    // quitarse para no duplicar el bullet real que renderiza el panel.
    label: 'Requisitos: con viñeta "•" propia de la fuente se limpia del ítem',
    html: 'Buscamos un perfil técnico.\nRequisitos:\n•\tFormación: Ingeniero de Sistemas\n•\tExperiencia mínima de 1 año',
    expectedDescription: 'Buscamos un perfil técnico.',
    expectedRequirements: ['Formación: Ingeniero de Sistemas', 'Experiencia mínima de 1 año'],
    exact: true
  },
  {
    // Vacante real de Elempleo ("Auxiliar de Enfermería", DaVita, confirmado
    // en vivo 2026-08-12): "Requisitos:" nunca cierra con una etiqueta ya
    // conocida — sin Salario:/Horario:/Tipo de contrato:/Beneficios: en
    // REQUIREMENTS_STOP_LABELS, la zona seguía abierta hasta el final y
    // esos términos del empleador (no del candidato) quedaban listados como
    // si fueran requisitos.
    label: 'Salario/Horario/Tipo de contrato/Beneficios cierran la zona sin absorberse',
    html: 'Buscamos auxiliar de enfermería.\nRequisitos:\nTécnico en auxiliar de enfermería\nSalario:\nA convenir\nHorario:\nLunes a sábados.\nTipo de contrato:\nIndefinido.\nBeneficios:\nPrimas extralegales.',
    expectedDescription:
      'Buscamos auxiliar de enfermería.\nSalario:\nA convenir\nHorario:\nLunes a sábados.\nTipo de contrato:\nIndefinido.\nBeneficios:\nPrimas extralegales.',
    expectedRequirements: ['Técnico en auxiliar de enfermería'],
    exact: true
  }
];

type EntityCase = { label: string; input: string; expected: string };

const entityCases: EntityCase[] = [
  {
    // Bug real 2026-08-12: faltaba este entity, así que "&nbsp;" quedaba
    // literal en descripciones scrapeadas en vez de convertirse en espacio.
    label: '&nbsp; se decodifica a espacio',
    input: 'Tiendas Ara!&nbsp;En Tiendas Ara',
    expected: 'Tiendas Ara! En Tiendas Ara'
  }
];

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 TEST DE VALIDACIÓN DE extractStructuredFromHtml / htmlEntities`);
  console.log(`==================================================\n`);

  let failed = 0;

  for (const c of cases) {
    const { description, requirements } = extractStructuredFromHtml(c.html);
    const descOk = c.exact ? description === c.expectedDescription : normalize(description) === normalize(c.expectedDescription);
    const reqOk = JSON.stringify(requirements) === JSON.stringify(c.expectedRequirements);
    if (descOk && reqOk) {
      console.log(`✅ [PASSED] ${c.label}`);
    } else {
      console.error(`❌ [FAILED] ${c.label}`);
      if (!descOk) {
        console.error(`   descripción esperada="${c.expectedDescription}"`);
        console.error(`   descripción obtenida="${description}"`);
      }
      if (!reqOk) {
        console.error(`   requirements esperados=${JSON.stringify(c.expectedRequirements)}`);
        console.error(`   requirements obtenidos=${JSON.stringify(requirements)}`);
      }
      failed++;
    }
  }

  for (const c of entityCases) {
    const actual = htmlEntities(c.input);
    if (actual === c.expected) {
      console.log(`✅ [PASSED] ${c.label}`);
    } else {
      console.error(`❌ [FAILED] ${c.label} — esperado="${c.expected}" obtenido="${actual}"`);
      failed++;
    }
  }

  const total = cases.length + entityCases.length;
  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed}/${total} casos fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] extractStructuredFromHtml/htmlEntities verificado (${total} casos).`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main();
