import React, { useState } from 'react';

export interface FilterState {
  search: string;
  source: string;
  modality: string;
  freshness: string;
  savedOnly: boolean;
}

export interface FilterBarProps {
  onFilterChange: (filters: FilterState) => void;
  availableSources?: string[];
}

export const FilterBar: React.FC<FilterBarProps> = ({ onFilterChange, availableSources = [] }) => {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('all');
  const [modality, setModality] = useState('all');
  const [freshness, setFreshness] = useState('all');
  const [savedOnly, setSavedOnly] = useState(false);

  const updateFilters = (newPartial: Partial<FilterState>) => {
    const updated: FilterState = {
      search: newPartial.search !== undefined ? newPartial.search : search,
      source: newPartial.source !== undefined ? newPartial.source : source,
      modality: newPartial.modality !== undefined ? newPartial.modality : modality,
      freshness: newPartial.freshness !== undefined ? newPartial.freshness : freshness,
      savedOnly: newPartial.savedOnly !== undefined ? newPartial.savedOnly : savedOnly,
    };

    if (newPartial.search !== undefined) setSearch(newPartial.search);
    if (newPartial.source !== undefined) setSource(newPartial.source);
    if (newPartial.modality !== undefined) setModality(newPartial.modality);
    if (newPartial.freshness !== undefined) setFreshness(newPartial.freshness);
    if (newPartial.savedOnly !== undefined) setSavedOnly(newPartial.savedOnly);

    onFilterChange(updated);
  };

  const sourcesList = ['all', ...Array.from(new Set([
    'LinkedIn', 'Computrabajo', 'Elempleo', 'Torre', 'Magneto',
    'Workana', 'WeRemoto', 'GetOnBoard', 'RemoteOK', 'Indeed', 'Glassdoor',
    ...availableSources
  ]))];

  return (
    <div className="rounded-xl border border-[#262A31] bg-[#131519] p-4 mb-6 space-y-3 font-sans">
      {/* Top Search Row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => updateFilters({ search: e.target.value })}
            placeholder="Filtrar por título, empresa o palabra clave..."
            className="w-full pl-9 pr-4 py-2 bg-[#0A0B0D] border border-[#262A31] rounded-lg text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500/50 font-sans"
          />
        </div>

        {/* Saved Toggle Button */}
        <button
          onClick={() => updateFilters({ savedOnly: !savedOnly })}
          className={`px-4 py-2 rounded-lg border text-xs font-mono transition-colors ${
            savedOnly
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-semibold'
              : 'border-[#262A31] bg-[#0A0B0D] text-slate-400 hover:text-slate-200'
          }`}
        >
          {savedOnly ? '★ Mis Guardadas' : '☆ Ver Guardadas'}
        </button>
      </div>

      {/* Select Filters Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs font-mono">
        {/* Source Selector */}
        <div>
          <label className="block text-slate-500 mb-1">Fuente / Portal:</label>
          <select
            value={source}
            onChange={(e) => updateFilters({ source: e.target.value })}
            className="w-full px-3 py-1.5 bg-[#0A0B0D] border border-[#262A31] rounded-lg text-slate-200 focus:outline-none focus:border-emerald-500/50"
          >
            {sourcesList.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? '🌐 Todas las Fuentes' : s}
              </option>
            ))}
          </select>
        </div>

        {/* Modality Selector */}
        <div>
          <label className="block text-slate-500 mb-1">Modalidad:</label>
          <select
            value={modality}
            onChange={(e) => updateFilters({ modality: e.target.value })}
            className="w-full px-3 py-1.5 bg-[#0A0B0D] border border-[#262A31] rounded-lg text-slate-200 focus:outline-none focus:border-emerald-500/50"
          >
            <option value="all">🏠 Todas las Modalidades</option>
            <option value="remoto">💻 100% Remoto</option>
            <option value="hibrido">🏢 Híbrido</option>
            <option value="presencial">📍 Presencial</option>
          </select>
        </div>

        {/* Freshness Selector */}
        <div>
          <label className="block text-slate-500 mb-1">Frescura / Publicación:</label>
          <select
            value={freshness}
            onChange={(e) => updateFilters({ freshness: e.target.value })}
            className="w-full px-3 py-1.5 bg-[#0A0B0D] border border-[#262A31] rounded-lg text-slate-200 focus:outline-none focus:border-emerald-500/50"
          >
            <option value="all">⏱️ Cualquier Fecha</option>
            <option value="24h">🔥 Últimas 24 Horas</option>
            <option value="48h">⚡ Últimas 48 Horas</option>
            <option value="7d">📅 Última Semana (7d)</option>
          </select>
        </div>
      </div>
    </div>
  );
};
