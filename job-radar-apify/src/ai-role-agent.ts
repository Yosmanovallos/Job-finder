/**
 * Universal AI Role Agent Engine: Dynamically expands ANY custom role string provided by the user
 * (tech, engineering, legal, finance, sales, design, operations, HR, medical, caregiving, etc.)
 * into comprehensive English and Spanish synonyms, title variations, and sub-roles.
 */

const TRANSLATION_MAP: Record<string, string[]> = {
  // Professions / Titles
  'ingeniero': ['engineer'],
  'ingeniera': ['engineer'],
  'engineer': ['ingeniero', 'ingeniera'],
  'analista': ['analyst'],
  'analyst': ['analista'],
  'gerente': ['manager', 'head', 'director'],
  'manager': ['gerente', 'lider', 'líder', 'jefe'],
  'líder': ['lead', 'leader', 'manager', 'head'],
  'lider': ['lead', 'leader', 'manager', 'head'],
  'lead': ['líder', 'lider', 'jefe', 'head'],
  'director': ['director', 'head', 'vp'],
  'directora': ['director', 'head'],
  'coordinador': ['coordinator', 'lead', 'supervisor'],
  'coordinadora': ['coordinator', 'lead'],
  'coordinator': ['coordinador', 'coordinadora'],
  'especialista': ['specialist', 'expert'],
  'specialist': ['especialista'],
  'diseñador': ['designer'],
  'diseñadora': ['designer'],
  'designer': ['diseñador', 'diseñadora'],
  'desarrollador': ['developer', 'engineer'],
  'desarrolladora': ['developer', 'engineer'],
  'developer': ['desarrollador', 'ingeniero'],
  'consultor': ['consultant', 'advisor'],
  'consultora': ['consultant', 'advisor'],
  'consultant': ['consultor', 'asesor'],
  'asesor': ['advisor', 'consultant', 'executive'],
  'asesora': ['advisor', 'consultant'],
  'abogado': ['lawyer', 'counsel', 'attorney', 'legal officer'],
  'abogada': ['lawyer', 'counsel', 'attorney'],
  'lawyer': ['abogado', 'abogada', 'legal'],
  'counsel': ['abogado', 'asesor legal'],
  'contador': ['accountant'],
  'contadora': ['accountant'],
  'accountant': ['contador', 'contadora', 'analista contable'],
  'psicologo': ['psychologist', 'recruiter'],
  'recruiter': ['reclutador', 'analista de seleccion', 'talent acquisition'],
  'arquitecto': ['architect'],
  'arquitecta': ['architect'],
  'architect': ['arquitecto', 'arquitecta'],
  'jefe': ['head', 'lead', 'manager', 'supervisor'],
  'supervisor': ['supervisor', 'coordinator', 'lead'],
  'cuidador': ['caregiver', 'nurse'],
  'cuidadora': ['caregiver', 'nurse'],
  'enfermero': ['nurse'],
  'enfermera': ['nurse'],

  // Fields & Domains
  'negocio': ['business'],
  'negocios': ['business'],
  'business': ['negocio', 'negocios'],
  'proyecto': ['project'],
  'proyectos': ['projects', 'project'],
  'project': ['proyecto', 'proyectos'],
  'datos': ['data'],
  'data': ['datos'],
  'finanzas': ['finance', 'financial'],
  'financiero': ['finance', 'financial'],
  'financiera': ['finance', 'financial'],
  'finance': ['finanzas', 'financiero'],
  'ventas': ['sales', 'commercial'],
  'sales': ['ventas', 'comercial'],
  'comercial': ['sales', 'commercial'],
  'compras': ['procurement', 'purchasing', 'buyer'],
  'buyer': ['comprador', 'compras'],
  'comprador': ['buyer', 'procurement specialist'],
  'marketing': ['mercadeo', 'digital marketing'],
  'mercadeo': ['marketing'],
  'operaciones': ['operations', 'ops'],
  'operations': ['operaciones'],
  'recursos humanos': ['human resources', 'hr', 'gestion humana', 'talent acquisition'],
  'hr': ['recursos humanos', 'rrhh', 'gestion humana'],
  'rrhh': ['hr', 'recursos humanos', 'talent'],
  'civil': ['civil', 'construction'],
  'estructuras': ['structural', 'structures'],
  'obra': ['construction', 'site'],
  'construccion': ['construction'],
  'construcción': ['construction'],
  'quimico': ['chemical'],
  'químico': ['chemical'],
  'mecanico': ['mechanical'],
  'mecánico': ['mechanical'],
  'electrico': ['electrical'],
  'eléctrico': ['electrical'],
  'procesos': ['process', 'processes'],
  'process': ['procesos', 'proceso'],
  'calidad': ['quality', 'qa'],
  'quality': ['calidad'],
  'sistemas': ['systems', 'it'],
  'software': ['software', 'ti', 'it'],
  'sostenibilidad': ['sustainability'],
  'corporativo': ['corporate'],
  'corporate': ['corporativo'],
  'juridico': ['legal'],
  'jurídico': ['legal'],
  'legal': ['juridico', 'legal', 'abogado']
};

export function generateRoleKeywordsWithAI(requestedRoles: string[]): string[] {
  const expanded = new Set<string>();

  for (const rawRole of requestedRoles) {
    const role = rawRole.trim();
    if (!role) continue;

    expanded.add(role);

    const lower = role.toLowerCase();
    const words = lower.split(/\s+/).filter(w => w.length > 1 && w !== 'de' && w !== 'del' && w !== 'en' && w !== 'y' && w !== 'o');

    // 1. Direct Translation & Synonym Expansion
    const translatedWordsList: string[][] = words.map(word => {
      const match = TRANSLATION_MAP[word];
      if (match) return [word, ...match];
      return [word];
    });

    // Generate Cartesian combination of main translated terms
    function generateCombinations(index: number, current: string[]) {
      if (index === translatedWordsList.length) {
        const title = current.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        expanded.add(title);
        return;
      }
      for (const option of translatedWordsList[index]) {
        generateCombinations(index + 1, [...current, option]);
      }
    }

    generateCombinations(0, []);

    // 2. Add Seniority & Prefix Variations for non-caregiving roles
    if (!lower.includes('cuidador') && !lower.includes('cuidadora') && !lower.includes('abuelo')) {
      const baseList = Array.from(expanded);
      for (const b of baseList) {
        if (!b.toLowerCase().includes('senior') && !b.toLowerCase().includes('lead')) {
          expanded.add(`Senior ${b}`);
          expanded.add(`${b} Senior`);
          expanded.add(`Líder de ${b}`);
          expanded.add(`Gerente de ${b}`);
        }
      }
    }

    // 3. Known Specialized Pre-built Presets (Enhances accuracy with EXACT word boundary checks)
    if (lower.includes('project manager') || lower.includes('gerente de proyecto') || lower.includes('lider de proyecto')) {
      expanded.add('Project Manager');
      expanded.add('Líder de Proyecto');
      expanded.add('Lider de Proyecto');
      expanded.add('Gerente de Proyecto');
      expanded.add('Director de Proyecto');
      expanded.add('Project Lead');
      expanded.add('Project Coordinator');
      expanded.add('PMO');
      expanded.add('Scrum Master');
      expanded.add('Product Owner');
    } else if (lower.includes('cuidador') || lower.includes('cuidadora') || lower.includes('abuelo') || lower.includes('abuela') || lower.includes('geriatr') || lower.includes('adulto mayor')) {
      expanded.add('Cuidadora de Adulto Mayor');
      expanded.add('Cuidador de Adulto Mayor');
      expanded.add('Auxiliar de Enfermería');
      expanded.add('Enfermera');
      expanded.add('Enfermero');
      expanded.add('Geriatría');
      expanded.add('Atención Adulto Mayor');
      expanded.add('Acompañante de Adulto Mayor');
    } else if (lower.includes('civil') || lower.includes('construccion') || lower.includes('obra')) {
      expanded.add('Ingeniero Civil');
      expanded.add('Civil Engineer');
      expanded.add('Ingeniero Residente');
      expanded.add('Director de Obra');
      expanded.add('Residente de Obra');
      expanded.add('Ingeniero de Estructuras');
      expanded.add('Structural Engineer');
      expanded.add('Ingeniero Calculista');
    } else if (lower.includes('business analyst') || lower.includes('analista de negocio')) {
      expanded.add('Business Analyst');
      expanded.add('Analista de Negocio');
      expanded.add('Analista Funcional');
      expanded.add('Functional Analyst');
      expanded.add('Business Systems Analyst');
      expanded.add('Analista BI');
    } else if (lower.includes('abogado') || lower.includes('legal') || lower.includes('lawyer')) {
      expanded.add('Abogado');
      expanded.add('Abogado Corporativo');
      expanded.add('Asesor Legal');
      expanded.add('Legal Counsel');
      expanded.add('Corporate Lawyer');
      expanded.add('Analista Legal');
      expanded.add('Abogado Senior');
    } else if (/\bux\b|\bui\b|\bdiseñador\b|\bdiseñadora\b|\bdesigner\b/.test(lower)) {
      expanded.add('Diseñador UX');
      expanded.add('Diseñador UI');
      expanded.add('UX/UI Designer');
      expanded.add('UI/UX Designer');
      expanded.add('Product Designer');
      expanded.add('Diseñador de Producto');
    } else if (lower.includes('contador') || lower.includes('accountant') || lower.includes('contable')) {
      expanded.add('Contador Público');
      expanded.add('Contador General');
      expanded.add('Senior Accountant');
      expanded.add('Analista Contable');
      expanded.add('Auxiliar Contable');
      expanded.add('Jefe de Contabilidad');
    }
  }

  return Array.from(expanded);
}
