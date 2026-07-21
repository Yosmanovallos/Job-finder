import { describe, expect, it } from "vitest";
import { mapProcess, type SecopProcess } from "./secop.js";

const NOW = "2026-07-19T12:00:00.000Z";

function make(overrides: Partial<SecopProcess>): SecopProcess {
  return {
    id_del_proceso: "CO1.REQ.1",
    nombre_del_procedimiento: "Proceso",
    descripci_n_del_procedimiento: "",
    entidad: "ENTIDAD X",
    ciudad_entidad: "Bogotá",
    precio_base: "10000000",
    modalidad_de_contratacion: "Contratación directa",
    tipo_de_contrato: "Prestación de servicios",
    estado_del_procedimiento: "Publicado",
    fecha_de_publicacion_del: "2026-07-16T00:00:00.000",
    fecha_de_recepcion_de: "2026-07-30T00:00:00.000",
    urlproceso: { url: "https://community.secop.gov.co/x" },
    ...overrides
  };
}

describe("mapProcess", () => {
  it("marks real software/QA work as Alta and carries evidence", () => {
    const opp = mapProcess(
      make({
        descripci_n_del_procedimiento:
          "Desarrollo de software y pruebas de software para la entidad"
      }),
      NOW
    );
    expect(opp).not.toBeNull();
    expect(opp!.relevance).toBe("Alta");
    expect(opp!.matchedTerms).toContain("pruebas de software");
    expect(opp!.presupuestoCop).toBe(10000000);
    expect(opp!.url).toBe("https://community.secop.gov.co/x");
  });

  it("raises an AI mention to Alta only with a service context", () => {
    const withService = mapProcess(
      make({
        descripci_n_del_procedimiento: "Implementacion de una solucion de inteligencia artificial"
      }),
      NOW
    );
    expect(withService!.relevance).toBe("Alta");

    // A bare AI mention with no tech-service context and no IT category is noise.
    const bareMention = mapProcess(
      make({
        descripci_n_del_procedimiento: "Ponencia sobre inteligencia artificial en el evento anual"
      }),
      NOW
    );
    expect(bareMention).toBeNull();
  });

  it("uses the IT UNSPSC code as a precision signal, not a hard gate", () => {
    // Bare AI mention + an IT procurement code (chatbot/big-data reality) → kept.
    const rescued = mapProcess(
      make({
        descripci_n_del_procedimiento:
          "Servicios para operar una solucion de inteligencia artificial",
        codigo_principal_de_categoria: "V1.81111500"
      }),
      NOW
    );
    expect(rescued).not.toBeNull();
    expect(rescued!.categoriaUnspsc).toBe("V1.81111500");
    expect(rescued!.relevance).toBe("Alta");

    // Same bare mention, non-IT category (e.g. audiovisual) and no context → noise.
    const noise = mapProcess(
      make({
        descripci_n_del_procedimiento:
          "Servicios para operar una solucion de inteligencia artificial",
        codigo_principal_de_categoria: "V1.82111800"
      }),
      NOW
    );
    expect(noise).toBeNull();

    // A real "desarrollo de software" tender is never dropped for a non-IT code
    // (SECOP miscodes real software work under goods/marketing categories).
    const miscoded = mapProcess(
      make({
        descripci_n_del_procedimiento: "Prestacion de servicios de desarrollo de software",
        codigo_principal_de_categoria: "V1.43231500"
      }),
      NOW
    );
    expect(miscoded).not.toBeNull();
    expect(miscoded!.relevance).toBe("Alta");
  });

  it("drops obvious noise: a broad AI mention in a non-service context", () => {
    // Printing/binding a book about AI is not an AI service → dropped.
    const book = mapProcess(
      make({
        nombre_del_procedimiento: "Impresión de libro",
        descripci_n_del_procedimiento:
          "Impresion y encuadernacion del libro inteligencia artificial"
      }),
      NOW
    );
    expect(book).toBeNull();

    // A dev-context word rescues a genuine AI service even with noise words nearby.
    const real = mapProcess(
      make({
        descripci_n_del_procedimiento:
          "Desarrollo de software con inteligencia artificial y material impreso de apoyo"
      }),
      NOW
    );
    expect(real).not.toBeNull();
    expect(real!.relevance).toBe("Alta");
  });

  it("returns null when no QA/AI term is present", () => {
    expect(
      mapProcess(make({ descripci_n_del_procedimiento: "Compra de sillas y escritorios" }), NOW)
    ).toBeNull();
  });

  it("drops publicity-mode processes that already name a contracted provider", () => {
    // Régimen especial publishes signed contracts for transparency: adjudicado
    // stays "No" but a provider is named ⇒ cannot apply ⇒ dropped.
    const awarded = mapProcess(
      make({
        descripci_n_del_procedimiento: "Prestacion de servicios de desarrollo de software",
        adjudicado: "No",
        nombre_del_proveedor: "ETERIUX SOLUTIONS",
        nit_del_proveedor_adjudicado: "901783404"
      }),
      NOW
    );
    expect(awarded).toBeNull();

    // The "No Definido" placeholder means genuinely open ⇒ kept.
    const open = mapProcess(
      make({
        descripci_n_del_procedimiento: "Prestacion de servicios de desarrollo de software",
        nombre_del_proveedor: "No Definido",
        nit_del_proveedor_adjudicado: "No Definido"
      }),
      NOW
    );
    expect(open).not.toBeNull();
  });

  it("drops non-service contract types (a natural person offers a service, not goods)", () => {
    const goods = mapProcess(
      make({
        descripci_n_del_procedimiento: "Compraventa de equipos con software de pruebas de software",
        tipo_de_contrato: "Compraventa"
      }),
      NOW
    );
    expect(goods).toBeNull();
  });

  it("drops company-scale modalities a solo natural person cannot win", () => {
    const bid = mapProcess(
      make({
        descripci_n_del_procedimiento: "Desarrollo de software y pruebas de software",
        modalidad_de_contratacion: "Licitación pública"
      }),
      NOW
    );
    expect(bid).toBeNull();
  });

  it("drops 'Contratación régimen especial' (publicity of already-signed contracts)", () => {
    const re = mapProcess(
      make({
        descripci_n_del_procedimiento: "Prestacion de servicios de desarrollo de software",
        modalidad_de_contratacion: "Contratación régimen especial",
        tipo_de_contrato: "Prestación de servicios"
      }),
      NOW
    );
    expect(re).toBeNull();
  });

  it("keeps a competitive process (mínima cuantía) with a future offer deadline", () => {
    const opp = mapProcess(
      make({
        descripci_n_del_procedimiento: "Prestacion de servicios de pruebas de software",
        modalidad_de_contratacion: "Mínima cuantía",
        tipo_de_contrato: "Prestación de servicios",
        fecha_de_recepcion_de: "2026-08-15T00:00:00.000"
      }),
      NOW
    );
    expect(opp).not.toBeNull();
    expect(opp!.relevance).toBe("Alta");
    expect(opp!.tipoContrato).toBe("Prestación de servicios");
  });

  it("requires a future offer deadline (drops absent/past reception date)", () => {
    const past = mapProcess(
      make({
        descripci_n_del_procedimiento: "Prestacion de servicios de desarrollo de software",
        modalidad_de_contratacion: "Mínima cuantía",
        fecha_de_recepcion_de: "2026-06-30T00:00:00.000"
      }),
      NOW
    );
    expect(past).toBeNull();

    const absent = mapProcess(
      make({
        descripci_n_del_procedimiento: "Prestacion de servicios de desarrollo de software",
        modalidad_de_contratacion: "Mínima cuantía",
        fecha_de_recepcion_de: ""
      }),
      NOW
    );
    expect(absent).toBeNull();
  });

  it("drops enterprise-scale budgets (a solo natural person cannot win billions)", () => {
    const huge = mapProcess(
      make({
        descripci_n_del_procedimiento: "Prestacion de servicios de desarrollo de software",
        tipo_de_contrato: "Prestación de servicios",
        precio_base: "4146974400"
      }),
      NOW
    );
    expect(huge).toBeNull();

    // An unstated budget (0 ⇒ null) is unknown, not large ⇒ kept.
    const unknownBudget = mapProcess(
      make({
        descripci_n_del_procedimiento: "Prestacion de servicios de pruebas de software",
        tipo_de_contrato: "Prestación de servicios",
        precio_base: "0"
      }),
      NOW
    );
    expect(unknownBudget).not.toBeNull();
  });

  it("never ranks a consultoría 'Alta' (usually awarded to firms)", () => {
    const opp = mapProcess(
      make({
        descripci_n_del_procedimiento:
          "Consultoria en desarrollo de software y pruebas de software",
        modalidad_de_contratacion: "Concurso de méritos abierto",
        tipo_de_contrato: "Consultoría"
      }),
      NOW
    );
    expect(opp).not.toBeNull();
    expect(opp!.relevance).toBe("Media");
  });

  it("never invents absent fields", () => {
    const opp = mapProcess(
      make({
        descripci_n_del_procedimiento: "pruebas de software",
        precio_base: "0",
        ciudad_entidad: "",
        urlproceso: {}
      }),
      NOW
    );
    expect(opp!.presupuestoCop).toBeNull();
    expect(opp!.ciudad).toBeNull();
    expect(opp!.url).toBeNull();
  });
});
