import React, { useState } from "react";
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";
import { Checkbox } from "./ui/checkbox.js";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group.js";
import { Input } from "./ui/input.js";

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
    <div className="border-b border-border py-4 last:border-b-0">
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
      {open && <div className="mt-3 space-y-2.5">{children}</div>}
    </div>
  );
};

const RadioRow: React.FC<{ id: string; value: string; label: string }> = ({ id, value, label }) => (
  <label
    htmlFor={id}
    className="flex items-center gap-2.5 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
  >
    <RadioGroupItem id={id} value={value} />
    {label}
  </label>
);

const CheckRow: React.FC<{
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ id, label, checked, onChange }) => (
  <label
    htmlFor={id}
    className="flex items-center gap-2.5 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
  >
    <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
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
    <div className="w-full">
      <div className="rounded-xl border border-border bg-card p-4">
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
            id="filter-saved"
            label="★ Guardadas"
            checked={filters.savedOnly}
            onChange={(v) => update({ savedOnly: v })}
          />
          <CheckRow
            id="filter-applied"
            label="✓ Aplicadas"
            checked={filters.appliedOnly}
            onChange={(v) => update({ appliedOnly: v })}
          />
        </FilterSection>

        <FilterSection title="Fecha de publicación">
          <RadioGroup
            value={filters.freshness}
            onValueChange={(v) => update({ freshness: v })}
          >
            <RadioRow id="freshness-all" value="all" label="Todas" />
            <RadioRow id="freshness-24h" value="24h" label="Últimas 24 horas" />
            <RadioRow id="freshness-48h" value="48h" label="Últimas 48 horas" />
            <RadioRow id="freshness-7d" value="7d" label="Última semana" />
          </RadioGroup>
        </FilterSection>

        <FilterSection title="Modalidad">
          <RadioGroup value={filters.modality} onValueChange={(v) => update({ modality: v })}>
            <RadioRow id="modality-all" value="all" label="Cualquiera" />
            <RadioRow id="modality-remoto" value="remoto" label="100% remoto" />
            <RadioRow id="modality-hibrido" value="hibrido" label="Híbrido" />
            <RadioRow id="modality-presencial" value="presencial" label="Presencial" />
          </RadioGroup>
        </FilterSection>

        <FilterSection title="Ciudad">
          <div className="max-h-40 overflow-y-auto space-y-2.5 pr-1">
            {CITY_OPTIONS.map((c) => (
              <CheckRow
                key={c}
                id={`city-${c}`}
                label={c}
                checked={filters.cities.includes(c)}
                onChange={() => toggleInArray("cities", c)}
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Fuente / Portal">
          <div className="max-h-40 overflow-y-auto space-y-2.5 pr-1">
            {SOURCE_OPTIONS.map((s) => (
              <CheckRow
                key={s}
                id={`source-${s}`}
                label={s}
                checked={filters.sources.includes(s)}
                onChange={() => toggleInArray("sources", s)}
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Rol buscado">
          <Input
            type="text"
            value={roleSearch}
            onChange={(e) => setRoleSearch(e.target.value)}
            placeholder="Buscar rol..."
            className="h-8 mb-2 text-xs"
          />
          <div className="max-h-48 overflow-y-auto space-y-2.5 pr-1">
            {filteredRoleOptions.length === 0 ? (
              <p className="text-ink-faint text-xs py-1">Sin coincidencias.</p>
            ) : (
              filteredRoleOptions.map((role) => (
                <CheckRow
                  key={role}
                  id={`role-${role}`}
                  label={role}
                  checked={filters.selectedRoles.includes(role)}
                  onChange={() => toggleInArray("selectedRoles", role)}
                />
              ))
            )}
          </div>
        </FilterSection>
      </div>
    </div>
  );
};
