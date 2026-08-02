import React, { useState, useEffect } from "react";
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";
import { CITY_OPTIONS } from "../lib/job-filters.js";
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
  // Exact company name (never an array — single-select, matches the exact
  // string applyJobFilters()/GET /api/jobs use, unlike sources/cities which
  // are OR'd checkbox lists). "" = no filter.
  company: string;
}

export const EMPTY_FILTERS: FilterState = {
  search: "",
  sources: [],
  modality: "all",
  freshness: "all",
  savedOnly: false,
  appliedOnly: false,
  selectedRoles: [],
  cities: [],
  company: ""
};

interface CompanySearchResult {
  company: string;
  count: number;
}

const COMPANY_SEARCH_DEBOUNCE_MS = 300;

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
  const [companySearch, setCompanySearch] = useState("");
  const [companyResults, setCompanyResults] = useState<CompanySearchResult[]>([]);
  const [companyLoading, setCompanyLoading] = useState(false);

  const update = (partial: Partial<FilterState>) => onFilterChange({ ...filters, ...partial });

  // 5,525+ distinct companies in the real corpus (vs. ~10-13 cities/sources)
  // — too many to ever send the client a full list like CITY_OPTIONS/
  // SOURCE_OPTIONS. Server-side substring search instead, same debounce
  // treatment as the dashboard's own free-text search box.
  useEffect(() => {
    setCompanyLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/companies/search?q=${encodeURIComponent(companySearch)}&limit=20`)
        .then((res) => (res.ok ? res.json() : { companies: [] }))
        .then((data) => setCompanyResults(Array.isArray(data.companies) ? data.companies : []))
        .catch(() => setCompanyResults([]))
        .finally(() => setCompanyLoading(false));
    }, COMPANY_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [companySearch]);

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
    filters.appliedOnly ||
    filters.company !== "";

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

        <FilterSection title="Empresa">
          <Input
            type="text"
            value={companySearch}
            onChange={(e) => setCompanySearch(e.target.value)}
            placeholder="Buscar empresa..."
            className="h-8 mb-2 text-xs"
          />
          <div className="max-h-48 overflow-y-auto space-y-2.5 pr-1">
            {/* Keeps the active selection visible/removable even once it
                scrolls out of the current search results — filters.company
                itself never depends on what's currently rendered here. */}
            {filters.company && !companyResults.some((c) => c.company === filters.company) && (
              <button
                type="button"
                onClick={() => update({ company: "" })}
                className="w-full flex items-center justify-between gap-2 text-left text-sm text-primary font-medium py-0.5"
              >
                <span className="truncate">{filters.company}</span>
                <span className="text-[10px] font-mono text-ink-faint shrink-0">Quitar ✕</span>
              </button>
            )}
            {companyLoading ? (
              <p className="text-ink-faint text-xs py-1">Buscando...</p>
            ) : companyResults.length === 0 ? (
              <p className="text-ink-faint text-xs py-1">Sin coincidencias.</p>
            ) : (
              <RadioGroup
                value={filters.company}
                onValueChange={(v) => update({ company: v })}
              >
                {companyResults.map((c) => (
                  <label
                    key={c.company}
                    htmlFor={`company-${c.company}`}
                    className="flex items-center gap-2.5 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                  >
                    <RadioGroupItem id={`company-${c.company}`} value={c.company} />
                    <span className="truncate flex-1">{c.company}</span>
                    <span className="text-[11px] font-mono text-ink-faint shrink-0">
                      ({c.count})
                    </span>
                  </label>
                ))}
              </RadioGroup>
            )}
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
