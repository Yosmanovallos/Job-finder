import React, { useState } from "react";
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";

export interface FilterState {
  search: string;
  sources: string[];
  modality: string;
  freshness: string;
  savedOnly: boolean;
  appliedOnly: boolean;
  selectedRoles: string[];
  cities: string[];
}

export const EMPTY_FILTERS: FilterState = {
  search: "",
  sources: [],
  modality: "all",
  freshness: "all",
  savedOnly: false,
  appliedOnly: false,
  selectedRoles: [],
  cities: []
};

// Raw `location` values are messy free text (hundreds of variants like
// "Bogotá, D.C., Capital District, Colombia" vs plain "Bogotá"), so this is a
// substring bucket per major city rather than an exact-match dropdown over
// the raw field.
export const CITY_OPTIONS = [
  "Bogotá",
  "Medellín",
  "Cali",
  "Barranquilla",
  "Cartagena",
  "Bucaramanga",
  "Pereira",
  "Manizales",
  "Remoto"
];

export const SOURCE_OPTIONS = [
  "LinkedIn",
  "Computrabajo",
  "Elempleo",
  "Torre",
  "Magneto",
  "Workana",
  "WeRemoto",
  "GetOnBoard",
  "RemoteOK",
  "Remotive",
  "Indeed",
  "Glassdoor",
  "Jooble"
];

export interface FilterBarProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
}

// A single collapsible sidebar section — sections default open (matching the
// reference layout) but can be tucked away once a user has picked a value.
const FilterSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children
}) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-[#e6e8e4] py-4 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-xs font-mono font-semibold uppercase tracking-wide text-foreground">
          {title}
        </span>
        <span className="text-ink-faint text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="mt-3 space-y-2">{children}</div>}
    </div>
  );
};

const RadioRow: React.FC<{
  name: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}> = ({ name, label, checked, onChange }) => (
  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
    <input
      type="radio"
      name={name}
      checked={checked}
      onChange={onChange}
      className="accent-primary"
    />
    {label}
  </label>
);

const CheckRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: () => void;
}> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
    <input type="checkbox" checked={checked} onChange={onChange} className="accent-primary" />
    <span className="truncate">{label}</span>
  </label>
);

export const FilterBar: React.FC<FilterBarProps> = ({ filters, onFilterChange }) => {
  const [roleSearch, setRoleSearch] = useState("");

  const update = (partial: Partial<FilterState>) => onFilterChange({ ...filters, ...partial });

  const toggleInArray = (key: "sources" | "cities" | "selectedRoles", value: string) => {
    const current = filters[key];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    update({ [key]: next } as Partial<FilterState>);
  };

  const filteredRoleOptions = DEFAULT_ROLES_200.filter((r) =>
    r.toLowerCase().includes(roleSearch.toLowerCase())
  );

  const hasActiveFilters =
    filters.sources.length > 0 ||
    filters.cities.length > 0 ||
    filters.modality !== "all" ||
    filters.freshness !== "all" ||
    filters.selectedRoles.length > 0 ||
    filters.savedOnly ||
    filters.appliedOnly;

  return (
    <aside className="w-full lg:w-72 shrink-0">
      <div className="rounded-xl border border-[#e6e8e4] bg-[#ffffff] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading font-semibold text-sm text-foreground">Filtros</h2>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => onFilterChange({ ...EMPTY_FILTERS, search: filters.search })}
              className="text-[11px] font-mono text-ink-faint hover:text-primary transition-colors"
            >
              Limpiar todo
            </button>
          )}
        </div>

        <FilterSection title="Mis vacantes">
          <CheckRow
            label="★ Guardadas"
            checked={filters.savedOnly}
            onChange={() => update({ savedOnly: !filters.savedOnly })}
          />
          <CheckRow
            label="✓ Aplicadas"
            checked={filters.appliedOnly}
            onChange={() => update({ appliedOnly: !filters.appliedOnly })}
          />
        </FilterSection>

        <FilterSection title="Fecha de publicación">
          <RadioRow
            name="freshness"
            label="Todas"
            checked={filters.freshness === "all"}
            onChange={() => update({ freshness: "all" })}
          />
          <RadioRow
            name="freshness"
            label="Últimas 24 horas"
            checked={filters.freshness === "24h"}
            onChange={() => update({ freshness: "24h" })}
          />
          <RadioRow
            name="freshness"
            label="Últimas 48 horas"
            checked={filters.freshness === "48h"}
            onChange={() => update({ freshness: "48h" })}
          />
          <RadioRow
            name="freshness"
            label="Última semana"
            checked={filters.freshness === "7d"}
            onChange={() => update({ freshness: "7d" })}
          />
        </FilterSection>

        <FilterSection title="Modalidad">
          <RadioRow
            name="modality"
            label="Cualquiera"
            checked={filters.modality === "all"}
            onChange={() => update({ modality: "all" })}
          />
          <RadioRow
            name="modality"
            label="100% remoto"
            checked={filters.modality === "remoto"}
            onChange={() => update({ modality: "remoto" })}
          />
          <RadioRow
            name="modality"
            label="Híbrido"
            checked={filters.modality === "hibrido"}
            onChange={() => update({ modality: "hibrido" })}
          />
          <RadioRow
            name="modality"
            label="Presencial"
            checked={filters.modality === "presencial"}
            onChange={() => update({ modality: "presencial" })}
          />
        </FilterSection>

        <FilterSection title="Ciudad">
          <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
            {CITY_OPTIONS.map((c) => (
              <CheckRow
                key={c}
                label={c}
                checked={filters.cities.includes(c)}
                onChange={() => toggleInArray("cities", c)}
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Fuente / Portal">
          <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
            {SOURCE_OPTIONS.map((s) => (
              <CheckRow
                key={s}
                label={s}
                checked={filters.sources.includes(s)}
                onChange={() => toggleInArray("sources", s)}
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Rol buscado">
          <input
            type="text"
            value={roleSearch}
            onChange={(e) => setRoleSearch(e.target.value)}
            placeholder="Buscar rol..."
            className="w-full px-2.5 py-1.5 mb-2 bg-[#fafafa] border border-[#e6e8e4] rounded text-foreground text-xs focus:outline-none focus:border-primary/50"
          />
          <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
            {filteredRoleOptions.length === 0 ? (
              <p className="text-ink-faint text-xs py-1">Sin coincidencias.</p>
            ) : (
              filteredRoleOptions.map((role) => (
                <CheckRow
                  key={role}
                  label={role}
                  checked={filters.selectedRoles.includes(role)}
                  onChange={() => toggleInArray("selectedRoles", role)}
                />
              ))
            )}
          </div>
        </FilterSection>
      </div>
    </aside>
  );
};
