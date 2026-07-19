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
      make({ descripci_n_del_procedimiento: "Desarrollo de software y pruebas de software para la entidad" }),
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
      make({ descripci_n_del_procedimiento: "Implementacion de una solucion de inteligencia artificial" }),
      NOW
    );
    expect(withService!.relevance).toBe("Alta");

    const bareMention = mapProcess(
      make({ descripci_n_del_procedimiento: "Ponencia sobre inteligencia artificial en el evento anual" }),
      NOW
    );
    expect(bareMention!.relevance).toBe("Media");
  });

  it("drops obvious noise: a broad AI mention in a non-service context", () => {
    // Printing/binding a book about AI is not an AI service → dropped.
    const book = mapProcess(
      make({
        nombre_del_procedimiento: "Impresión de libro",
        descripci_n_del_procedimiento: "Impresion y encuadernacion del libro inteligencia artificial"
      }),
      NOW
    );
    expect(book).toBeNull();

    // A dev-context word rescues a genuine AI service even with noise words nearby.
    const real = mapProcess(
      make({
        descripci_n_del_procedimiento: "Desarrollo de software con inteligencia artificial y material impreso de apoyo"
      }),
      NOW
    );
    expect(real).not.toBeNull();
    expect(real!.relevance).toBe("Alta");
  });

  it("returns null when no QA/AI term is present", () => {
    expect(mapProcess(make({ descripci_n_del_procedimiento: "Compra de sillas y escritorios" }), NOW)).toBeNull();
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
