import React, { useState, useRef, useEffect } from 'react';
import {
  Upload, Download, CheckCircle, Eye, X, RefreshCw, Clock,
  LogOut, User, AlertCircle, Sparkles, ChevronDown, ChevronUp,
  History, Settings2, FlaskConical, Hash, Type, Calendar,
  AlertTriangle, Info, Layers, Filter
} from 'lucide-react';
import API_URL from '../config/api';

// ─── Auth helper ──────────────────────────────────────────────────────────────
const authFetch = (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = localStorage.getItem('token');
  return fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface UserInfo { name?: string; email?: string }

interface Message {
  sender: 'user' | 'bot';
  content: any;
  type: string;
  timestamp: Date;
  suggestions?: string[];
}

interface Session {
  session_id: string; filename: string; status: string;
  timestamp: string; rows: number; columns: number;
  operation_count?: number;
}

interface ActionOptions {
  numericStrategy?: 'mean' | 'median' | 'mode' | 'zero' | 'drop';
  textStrategy?: 'mode' | 'empty' | 'drop';
  mixedStrategy?: 'to_numeric' | 'replace_median' | 'replace_mean' | 'drop_rows';
  outlierMethod?: 'median' | 'mean' | 'cap' | 'nan' | 'remove' | 'flag';
  removeEmojis?: boolean; removeSpecialChars?: boolean;
  trimSpaces?: boolean; deduplicateSpaces?: boolean;
  targetFormat?: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
  caseStyle?: 'title' | 'lower' | 'upper';
}

interface CleaningAction {
  id: string; title: string; description: string;
  impact: string; selected: boolean;
  risk: 'faible' | 'moyen' | 'élevé';
  icon: React.ReactNode; options: ActionOptions;
  showOptions: boolean;
}

type DownloadFormat = 'csv' | 'xlsx' | 'json' | 'xml';

interface HistoryEntry {
  id: string;
  timestamp: Date;
  actionTitle: string;
  options: ActionOptions;
  result?: string;
  status: 'success' | 'error' | 'pending';
}

interface HoveredCell { row: number; col: number }
interface Props { user: UserInfo; onLogout: () => void }

// ─── Labels ───────────────────────────────────────────────────────────────────
const numericStrategyLabels: Record<string, string> = {
  mean:   '📐 Remplacer par la moyenne',
  median: '📊 Remplacer par la médiane (recommandé)',
  mode:   '🔢 Remplacer par la valeur la plus fréquente',
  zero:   '0️⃣ Remplacer par zéro',
  drop:   '🗑️ Supprimer les lignes concernées',
};
const textStrategyLabels: Record<string, string> = {
  mode:  '🔡 Remplacer par la valeur la plus fréquente',
  empty: '⬜ Remplacer par une chaîne vide',
  drop:  '🗑️ Supprimer les lignes concernées',
};
const mixedStrategyLabels: Record<string, string> = {
  to_numeric:     '🔢 Convertir en numérique (texte → NaN puis traité)',
  replace_median: '📊 Remplacer la valeur texte par la médiane',
  replace_mean:   '📐 Remplacer la valeur texte par la moyenne',
  drop_rows:      '🗑️ Supprimer les lignes avec valeur texte',
};
const outlierMethodLabels: Record<string, string> = {
  median: '📊 Remplacer par la médiane (RECOMMANDÉ)',
  mean:   '📐 Remplacer par la moyenne',
  cap:    '🔒 Plafonner aux limites IQR',
  nan:    '❓ Marquer comme manquant',
  remove: '🗑️ Supprimer les lignes',
  flag:   '🏴 Ajouter colonne indicateur',
};
const caseStyleLabels: Record<string, string> = {
  title: '🅃 Title Case (Première Lettre En Majuscule)',
  lower: '🔡 lowercase (tout en minuscule)',
  upper: '🔠 UPPERCASE (TOUT EN MAJUSCULE)',
};
const dateFormatLabels: Record<string, string> = {
  'YYYY-MM-DD': '📅 ISO : 2024-01-31',
  'DD/MM/YYYY': '📅 Européen : 31/01/2024',
  'MM/DD/YYYY': '📅 US : 01/31/2024',
};

// ─── Format de téléchargement ─────────────────────────────────────────────────
const downloadFormatConfig: Record<DownloadFormat, { icon: string; label: string; description: string; color: string }> = {
  csv:  { icon: '📄', label: 'CSV',  description: 'Universel',    color: 'emerald' },
  xlsx: { icon: '📊', label: 'XLSX', description: 'Excel natif',  color: 'green'   },
  json: { icon: '{ }',label: 'JSON', description: 'API / Web',    color: 'blue'    },
  xml:  { icon: '🏷️', label: 'XML',  description: 'Structuré',    color: 'purple'  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const backendEntryToHistoryEntry = (be: any): HistoryEntry => {
  const summary = be.results_summary || {};
  const actions: string[] = be.actions || [];
  const actionLabel = summary.actions_performed?.join(' · ') || actions.join(', ') || 'Nettoyage';
  const result = summary.initial_rows != null
    ? `${summary.initial_rows} → ${summary.final_rows} lignes`
    : undefined;
  return {
    id: be.id,
    timestamp: new Date(be.timestamp),
    actionTitle: actionLabel,
    options: be.options || {},
    result,
    status: be.status === 'success' ? 'success' : be.status === 'error' ? 'error' : 'pending',
  };
};

// ─── Sub-option panels ────────────────────────────────────────────────────────
const InfoBox: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-start gap-2 text-xs text-gray-500 mt-1">
    <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
    <span>{text}</span>
  </div>
);

const MissingValuesOptions: React.FC<{
  opts: ActionOptions; onChange: (o: Partial<ActionOptions>) => void
}> = ({ opts, onChange }) => (
  <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4 text-sm">
    <div>
      <label className="font-semibold text-gray-700 block mb-1">
        <Hash className="w-3.5 h-3.5 inline mr-1 text-blue-500" />
        Colonnes <strong>numériques</strong> — stratégie de remplacement
      </label>
      <select
        value={opts.numericStrategy || 'median'}
        onChange={e => onChange({ numericStrategy: e.target.value as any })}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-400"
      >
        {Object.entries(numericStrategyLabels).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
    </div>
    <div>
      <label className="font-semibold text-gray-700 block mb-1">
        <Type className="w-3.5 h-3.5 inline mr-1 text-purple-500" />
        Colonnes <strong>texte</strong> — stratégie de remplacement
      </label>
      <select
        value={opts.textStrategy || 'mode'}
        onChange={e => onChange({ textStrategy: e.target.value as any })}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-400"
      >
        {Object.entries(textStrategyLabels).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
    </div>
    <InfoBox text="Les valeurs manquantes dans les colonnes mixtes sont traitées séparément via l'action dédiée." />
  </div>
);

const MixedColumnsOptions: React.FC<{
  opts: ActionOptions; onChange: (o: Partial<ActionOptions>) => void; mixedCols: string[];
}> = ({ opts, onChange, mixedCols }) => (
  <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-3 text-sm">
    <div className="flex items-start gap-2 text-orange-800 font-medium">
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span>Colonnes détectées avec mélange numérique/texte : <strong>{mixedCols.join(', ')}</strong></span>
    </div>
    <div>
      <label className="font-semibold text-gray-700 block mb-1">Stratégie pour les valeurs texte dans ces colonnes</label>
      <div className="space-y-2">
        {Object.entries(mixedStrategyLabels).map(([k, v]) => (
          <label key={k} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
            (opts.mixedStrategy || 'replace_median') === k
              ? 'border-orange-400 bg-orange-100' : 'border-gray-200 bg-white hover:border-orange-200'
          }`}>
            <input type="radio" name="mixed-strategy" value={k}
              checked={(opts.mixedStrategy || 'replace_median') === k}
              onChange={() => onChange({ mixedStrategy: k as any })}
              className="text-orange-500" />
            <span>{v}</span>
          </label>
        ))}
      </div>
    </div>
    <InfoBox text='Ex : NUM_BEDROOMS contient "HURLEY" ou "na" → sera traité selon la stratégie choisie.' />
  </div>
);

const OutliersOptions: React.FC<{
  opts: ActionOptions; onChange: (o: Partial<ActionOptions>) => void
}> = ({ opts, onChange }) => (
  <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-4 space-y-3 text-sm">
    <label className="font-semibold text-gray-700 block mb-1">Méthode de traitement des valeurs aberrantes</label>
    <div className="space-y-2">
      {Object.entries(outlierMethodLabels).map(([k, v]) => (
        <label key={k} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
          (opts.outlierMethod || 'median') === k
            ? 'border-red-400 bg-red-100' : 'border-gray-200 bg-white hover:border-red-200'
        }`}>
          <input type="radio" name="outlier-method" value={k}
            checked={(opts.outlierMethod || 'median') === k}
            onChange={() => onChange({ outlierMethod: k as any })}
            className="text-red-500" />
          <span>{v}</span>
        </label>
      ))}
    </div>
  </div>
);

const TextCleaningOptions: React.FC<{
  opts: ActionOptions; onChange: (o: Partial<ActionOptions>) => void
}> = ({ opts, onChange }) => (
  <div className="mt-3 bg-indigo-50 border border-indigo-200 rounded-lg p-4 space-y-2 text-sm">
    <label className="font-semibold text-gray-700 block mb-2">Sélectionnez les nettoyages à appliquer</label>
    {([
      ['removeEmojis',       '😊 Supprimer les emojis'],
      ['removeSpecialChars', '# Supprimer les caractères spéciaux'],
      ['trimSpaces',         '▶ Supprimer les espaces en début/fin'],
      ['deduplicateSpaces',  '⎵ Réduire les espaces multiples'],
    ] as [keyof ActionOptions, string][]).map(([key, label]) => (
      <label key={key} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-indigo-100 transition-colors">
        <input type="checkbox" checked={(opts[key] as boolean) !== false}
          onChange={e => onChange({ [key]: e.target.checked })}
          className="w-4 h-4 text-indigo-600 rounded" />
        <span>{label}</span>
      </label>
    ))}
  </div>
);

const DateOptions: React.FC<{
  opts: ActionOptions; onChange: (o: Partial<ActionOptions>) => void
}> = ({ opts, onChange }) => (
  <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-4 space-y-2 text-sm">
    <label className="font-semibold text-gray-700 block mb-2">
      <Calendar className="w-3.5 h-3.5 inline mr-1 text-green-600" />Format cible
    </label>
    <div className="space-y-2">
      {Object.entries(dateFormatLabels).map(([k, v]) => (
        <label key={k} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
          (opts.targetFormat || 'YYYY-MM-DD') === k
            ? 'border-green-400 bg-green-100' : 'border-gray-200 bg-white hover:border-green-200'
        }`}>
          <input type="radio" name="date-format" value={k}
            checked={(opts.targetFormat || 'YYYY-MM-DD') === k}
            onChange={() => onChange({ targetFormat: k as any })}
            className="text-green-500" />
          <span>{v}</span>
        </label>
      ))}
    </div>
  </div>
);

const CaseOptions: React.FC<{
  opts: ActionOptions; onChange: (o: Partial<ActionOptions>) => void
}> = ({ opts, onChange }) => (
  <div className="mt-3 bg-cyan-50 border border-cyan-200 rounded-lg p-4 space-y-2 text-sm">
    <label className="font-semibold text-gray-700 block mb-2">Style de casse cible</label>
    <div className="space-y-2">
      {Object.entries(caseStyleLabels).map(([k, v]) => (
        <label key={k} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
          (opts.caseStyle || 'title') === k
            ? 'border-cyan-400 bg-cyan-100' : 'border-gray-200 bg-white hover:border-cyan-200'
        }`}>
          <input type="radio" name="case-style" value={k}
            checked={(opts.caseStyle || 'title') === k}
            onChange={() => onChange({ caseStyle: k as any })}
            className="text-cyan-500" />
          <span>{v}</span>
        </label>
      ))}
    </div>
  </div>
);

// ─── Format Selector Component ────────────────────────────────────────────────
const FormatSelector: React.FC<{
  selected: DownloadFormat;
  onChange: (f: DownloadFormat) => void;
}> = ({ selected, onChange }) => {
  const colorMap: Record<string, string> = {
    emerald: 'border-emerald-500 bg-emerald-50 text-emerald-800',
    green:   'border-green-500 bg-green-50 text-green-800',
    blue:    'border-blue-500 bg-blue-50 text-blue-800',
    purple:  'border-purple-500 bg-purple-50 text-purple-800',
  };
  const inactiveClass = 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50';

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-gray-700">📥 Format de téléchargement :</p>
      <div className="grid grid-cols-4 gap-2">
        {(Object.entries(downloadFormatConfig) as [DownloadFormat, typeof downloadFormatConfig[DownloadFormat]][]).map(([fmt, cfg]) => {
          const isSelected = selected === fmt;
          return (
            <button
              key={fmt}
              onClick={() => onChange(fmt)}
              className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all text-center ${
                isSelected ? colorMap[cfg.color] : inactiveClass
              }`}
            >
              <span className="text-xl mb-1">{cfg.icon}</span>
              <span className="font-bold text-xs tracking-wide">{cfg.label}</span>
              <span className={`text-xs mt-0.5 ${isSelected ? 'opacity-80' : 'text-gray-400'}`}>
                {cfg.description}
              </span>
              {isSelected && (
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-current inline-block" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ─── Download Button with Format ──────────────────────────────────────────────
const DownloadMessage: React.FC<{
  content: { downloadUrl: string; filename: string };
  onMessage: (text: string) => void;
}> = ({ content, onMessage }) => {
  const [fmt, setFmt] = useState<DownloadFormat>('csv');
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const url = `${content.downloadUrl}?format=${fmt}`;
      const res = await authFetch(url);
      if (!res.ok) {
        const err = await res.json();
        onMessage(`❌ Erreur : ${err.error || 'Téléchargement impossible'}`);
        return;
      }
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const baseName = content.filename.replace(/^cleaned_/, '').replace(/\.[^.]+$/, '');
      a.href = objectUrl;
      a.download = `cleaned_${baseName}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(objectUrl);
      document.body.removeChild(a);
      onMessage(`✅ Fichier téléchargé en ${fmt.toUpperCase()} !`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="mt-2 space-y-3 p-1">
      <FormatSelector selected={fmt} onChange={setFmt} />
      <button
        onClick={handleDownload}
        disabled={isDownloading}
        className="w-full bg-gray-900 text-white px-6 py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-gray-800 transition-all font-medium disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isDownloading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
            Préparation du fichier…
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            Télécharger en {fmt.toUpperCase()}
          </>
        )}
      </button>
    </div>
  );
};

// ─── Multi-download with Format ───────────────────────────────────────────────
const MultiDownloadBar: React.FC<{
  selectedSessions: string[];
  onDownload: (fmt: DownloadFormat) => void;
  onSelectAll: () => void;
  onClear: () => void;
  isDownloading: boolean;
}> = ({ selectedSessions, onDownload, onSelectAll, onClear, isDownloading }) => {
  const [fmt, setFmt] = useState<DownloadFormat>('csv');

  return (
    <div className="space-y-2 mt-2">
      {/* mini format tabs */}
      <div className="flex gap-1">
        {(Object.entries(downloadFormatConfig) as [DownloadFormat, any][]).map(([f, cfg]) => (
          <button key={f} onClick={() => setFmt(f)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              fmt === f ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-400'
            }`}>
            {cfg.label}
          </button>
        ))}
      </div>
      <button
        onClick={() => onDownload(fmt)}
        disabled={isDownloading}
        className="w-full bg-green-600 text-white rounded-lg px-4 py-2.5 hover:bg-green-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
      >
        {isDownloading
          ? <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />Téléchargement…</>
          : <><Download className="w-4 h-4" />Télécharger {selectedSessions.length} fichier(s) en {fmt.toUpperCase()}</>
        }
      </button>
      <div className="flex gap-2">
        <button onClick={onSelectAll}
          className="flex-1 bg-blue-100 text-blue-700 rounded-lg px-3 py-2 hover:bg-blue-200 text-xs font-medium">
          Tout sélect.
        </button>
        <button onClick={onClear}
          className="flex-1 bg-gray-100 text-gray-700 rounded-lg px-3 py-2 hover:bg-gray-200 text-xs font-medium">
          Annuler
        </button>
      </div>
    </div>
  );
};

// ─── History Panel ────────────────────────────────────────────────────────────
const HistoryPanel: React.FC<{
  history: HistoryEntry[];
  isLoading: boolean;
  onClose: () => void;
}> = ({ history, isLoading, onClose }) => (
  <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col">
    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50">
      <div className="flex items-center gap-2">
        <History className="w-5 h-5 text-gray-600" />
        <h2 className="font-semibold text-gray-900">Historique des opérations</h2>
      </div>
      <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
        <X className="w-5 h-5" />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {isLoading && (
        <div className="flex items-center justify-center py-12 gap-2 text-gray-400 text-sm">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-gray-600" />
          Chargement…
        </div>
      )}
      {!isLoading && history.length === 0 && (
        <div className="text-center text-sm text-gray-400 py-12">
          <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
          Aucune opération enregistrée
        </div>
      )}
      {!isLoading && history.map(entry => (
        <div key={entry.id} className="border border-gray-100 rounded-xl p-4 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                entry.status === 'success' ? 'bg-green-500' :
                entry.status === 'error'   ? 'bg-red-500'   : 'bg-yellow-400'
              }`} />
              <div>
                <div className="font-medium text-sm text-gray-900">{entry.actionTitle}</div>
                <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3" />
                  {entry.timestamp.toLocaleString('fr-FR', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                  })}
                </div>
              </div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              entry.status === 'success' ? 'bg-green-100 text-green-700' :
              entry.status === 'error'   ? 'bg-red-100 text-red-700'     :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {entry.status === 'success' ? '✓ OK' : entry.status === 'error' ? '✗ Erreur' : '⏳ En cours'}
            </span>
          </div>

          <div className="mt-3 space-y-1 text-xs text-gray-600 bg-gray-50 rounded-lg p-3">
            {entry.options.numericStrategy && (
              <div><span className="text-gray-400">Num. manquants :</span> {numericStrategyLabels[entry.options.numericStrategy]}</div>
            )}
            {entry.options.textStrategy && (
              <div><span className="text-gray-400">Txt. manquants :</span> {textStrategyLabels[entry.options.textStrategy]}</div>
            )}
            {entry.options.mixedStrategy && (
              <div><span className="text-gray-400">Colonnes mixtes :</span> {mixedStrategyLabels[entry.options.mixedStrategy]}</div>
            )}
            {entry.options.outlierMethod && (
              <div><span className="text-gray-400">Outliers :</span> {outlierMethodLabels[entry.options.outlierMethod]}</div>
            )}
            {entry.options.targetFormat && (
              <div><span className="text-gray-400">Format date :</span> {dateFormatLabels[entry.options.targetFormat]}</div>
            )}
            {entry.options.caseStyle && (
              <div><span className="text-gray-400">Casse :</span> {caseStyleLabels[entry.options.caseStyle]}</div>
            )}
            {entry.options.removeEmojis !== undefined && (
              <div><span className="text-gray-400">Emojis :</span> {entry.options.removeEmojis ? 'supprimés' : 'conservés'}</div>
            )}
          </div>

          {entry.result && (
            <div className="mt-2 text-xs text-gray-500 border-t border-gray-100 pt-2">{entry.result}</div>
          )}
        </div>
      ))}
    </div>
  </div>
);

// ─── Suggestion chips ─────────────────────────────────────────────────────────
const SuggestionChips: React.FC<{
  suggestions: string[]; disabled: boolean; onSelect: (s: string) => void;
}> = ({ suggestions, disabled, onSelect }) => {
  if (!suggestions?.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {suggestions.map((s, i) => (
        <button key={i} disabled={disabled} onClick={() => onSelect(s)}
          className="text-xs px-3 py-1.5 bg-gray-50 hover:bg-blue-50 hover:text-blue-700 border border-gray-200 hover:border-blue-300 rounded-full transition-all text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
          <Sparkles className="w-3 h-3" />{s}
        </button>
      ))}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
const DataCleaningAssistant: React.FC<Props> = ({ user, onLogout }) => {
  const [sessionId, setSessionId]             = useState<string | null>(null);
  const [messages, setMessages]               = useState<Message[]>([]);
  const [currentFile, setCurrentFile]         = useState<any>(null);
  const [analysisData, setAnalysisData]       = useState<any>(null);
  const [cleaningActions, setCleaningActions] = useState<CleaningAction[]>([]);
  const [step, setStep]                       = useState<string>('upload');
  const [sessions, setSessions]               = useState<Session[]>([]);
  const [showPreview, setShowPreview]         = useState(false);
  const [previewData, setPreviewData]         = useState<any>(null);
  const [previewType, setPreviewType]         = useState<'before' | 'after'>('before');
  const [isRestoring, setIsRestoring]         = useState(false);
  const [showUserMenu, setShowUserMenu]       = useState(false);
  const [hoveredCell, setHoveredCell]         = useState<HoveredCell | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [isDownloading, setIsDownloading]     = useState(false);
  const [userQuestion, setUserQuestion]       = useState('');
  const [isAsking, setIsAsking]               = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const [operationHistory, setOperationHistory] = useState<HistoryEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [showHistory, setShowHistory]           = useState(false);
  const [mixedColumns, setMixedColumns]         = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (messages.length === 0 && !isRestoring) {
      addMessage('bot',
        `👋 Bonjour ${user?.name || 'Utilisateur'} ! Je suis votre assistant intelligent de qualité de données.\n\nTéléchargez un fichier CSV, Excel, JSON ou XML pour commencer l'analyse 📊`,
        'text', ['Comment tu fonctionnes ?', 'Quels formats acceptes-tu ?']);
    }
    loadSessions();
  }, []);

  const addMessage = (sender: 'user' | 'bot', content: any, type = 'text', suggestions?: string[]) => {
    setMessages(prev => [...prev, { sender, content, type, timestamp: new Date(), suggestions }]);
  };

  const loadHistory = async (sid: string) => {
    setIsHistoryLoading(true);
    try {
      const res = await authFetch(`${API_URL}/api/session/${sid}/history`);
      if (!res.ok) return;
      const data = await res.json();
      setOperationHistory((data.history || []).map(backendEntryToHistoryEntry));
    } catch {
      // ignore
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const openHistory = async () => {
    setShowHistory(true);
    if (sessionId) await loadHistory(sessionId);
  };

  const addLocalHistoryEntry = (actionTitle: string, options: ActionOptions): string => {
    const id = crypto.randomUUID();
    setOperationHistory(prev => [{ id, timestamp: new Date(), actionTitle, options, status: 'pending' }, ...prev]);
    return id;
  };

  const updateLocalHistoryEntry = (id: string, status: 'success' | 'error', result?: string) => {
    setOperationHistory(prev => prev.map(e => e.id === id ? { ...e, status, result } : e));
  };

  const askQuestionWith = async (question: string) => {
    if (!question.trim() || !sessionId) return;
    setIsAsking(true);
    addMessage('user', question);
    try {
      const res = await authFetch(`${API_URL}/api/chat/ask`, {
        method: 'POST', body: JSON.stringify({ session_id: sessionId, question })
      });
      if (!res.ok) throw new Error('Erreur lors de la réponse');
      const data = await res.json();
      addMessage('bot', data.answer, 'text', data.suggestions);
    } catch {
      addMessage('bot', '❌ Erreur lors du traitement de votre question');
    } finally { setIsAsking(false); }
  };

  const loadSessions = async () => {
    try {
      const res = await authFetch(`${API_URL}/api/sessions`);
      const data = await res.json();
      if (res.ok) setSessions(data.sessions || []);
    } catch {}
  };

  const restoreSession = async (s: Session) => {
    try {
      setIsRestoring(true);
      setMessages([]);
      setOperationHistory([]);
      addMessage('bot', `🔄 Restauration de la session "${s.filename}"...`);
      const res = await authFetch(`${API_URL}/api/session/${s.session_id}`);
      if (!res.ok) { addMessage('bot', '❌ Impossible de restaurer cette session.'); return; }
      const full = await res.json();
      setSessionId(s.session_id);
      setCurrentFile({ name: s.filename });
      setAnalysisData(full.analysis);

      const backendMixed: string[] = full.analysis?.mixed_columns || [];
      setMixedColumns(backendMixed);
      setOperationHistory((full.operation_history || []).map(backendEntryToHistoryEntry));

      addMessage('bot', `✅ Session restaurée : ${s.filename}`);
      addMessage('bot', `📊 ${full.analysis.rows} lignes × ${full.analysis.columns} colonnes`);

      if (backendMixed.length > 0) {
        addMessage('bot', `⚠️ Colonnes mixtes détectées : ${backendMixed.join(', ')}`);
      }

      if (s.status === 'cleaned' && full.cleaning_results) {
        setStep('results');
        displayRestoredResults(full.cleaning_results, s.session_id);
      } else {
        setStep('actions');
        proposeActions(full.analysis, backendMixed);
      }
    } finally { setIsRestoring(false); }
  };

  const displayRestoredResults = (results: any, sid: string) => {
    if (!results?.results) return;
    const res = results.results;
    let summary = `✨ Cette session a déjà été nettoyée !\n\n`;
    summary += `📊 Avant : ${res.initial_rows} lignes → Après : ${res.final_rows} lignes\n\n✅ Actions effectuées :\n`;
    if (res.duplicates_removed)  summary += `• ${res.duplicates_removed.exact_duplicates_removed || 0} doublons exacts + ${res.duplicates_removed.structural_duplicates_removed || 0} structurels supprimés\n`;
    if (res.missing_corrected)   summary += `• ${res.missing_corrected} valeurs manquantes corrigées\n`;
    if (res.outliers_removed)    summary += `• ${res.outliers_removed} valeurs aberrantes traitées\n`;
    if (res.text_normalized)     summary += `• ${res.text_normalized} textes normalisés\n`;
    summary += `\n💡 Téléchargez le fichier nettoyé ou relancez une analyse.`;
    addMessage('bot', summary, 'results');
    addMessage('bot', { downloadUrl: `${API_URL}/api/download/${sid}`, filename: results.cleaned_filename }, 'download');
  };

  const defaultOptions = (): ActionOptions => ({
    numericStrategy: 'median', textStrategy: 'mode', mixedStrategy: 'replace_median',
    outlierMethod: 'median', removeEmojis: true, removeSpecialChars: true,
    trimSpaces: true, deduplicateSpaces: true, targetFormat: 'YYYY-MM-DD', caseStyle: 'title',
  });

  const proposeActions = (analysis: any, mixedCols: string[] = []) => {
    if (!analysis) return;
    const missingCount = Object.values<any>(analysis.missing_values || {}).reduce((a, b) => a + (b?.count || 0), 0);
    const dups = analysis.duplicates || {};
    const outliers = Object.values<any>(analysis.outliers || {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    let textFixes = 0, inconsistentCase = 0;
    for (const col in analysis.text_issues || {}) {
      const ti = analysis.text_issues[col];
      textFixes += (ti.emojis || 0) + (ti.specialChars || 0) + (ti.spaces || 0);
      inconsistentCase += ti.inconsistentCase || 0;
    }
    const dateFormatsCount = Object.values<any>(analysis.date_formats || {}).reduce((a, v) => a + Math.max(0, (v?.length || 0) - 1), 0);
    const opts = defaultOptions();

    const actions: CleaningAction[] = [
      {
        id: 'duplicates', title: 'Supprimer les doublons',
        description: `${dups.exact_duplicates || 0} exacts + ${dups.structural_duplicates || 0} structurels détectés`,
        impact: `${(dups.exact_duplicates || 0) + (dups.structural_duplicates || 0)} lignes supprimées`,
        selected: false, risk: 'faible', showOptions: false,
        icon: <Layers className="w-4 h-4" />, options: { ...opts },
      },
      {
        id: 'missing_values', title: 'Corriger les valeurs manquantes',
        description: `${missingCount} valeurs manquantes — choisissez la stratégie par type de colonne`,
        impact: `${missingCount} cellules corrigées`,
        selected: false, risk: 'moyen', showOptions: false,
        icon: <Filter className="w-4 h-4" />, options: { ...opts },
      },
      ...(mixedCols.length > 0 ? [{
        id: 'mixed_columns', title: 'Nettoyer les colonnes mixtes',
        description: `${mixedCols.length} colonne(s) avec mélange numérique/texte : ${mixedCols.slice(0, 3).join(', ')}${mixedCols.length > 3 ? '…' : ''}`,
        impact: 'Conversion ou remplacement des valeurs texte dans colonnes numériques',
        selected: false, risk: 'moyen' as const, showOptions: false,
        icon: <FlaskConical className="w-4 h-4" />, options: { ...opts },
      }] : []),
      {
        id: 'outliers', title: 'Traiter les valeurs aberrantes',
        description: `${outliers} valeurs extrêmes détectées (méthode IQR)`,
        impact: 'Méthode configurable ci-dessous',
        selected: false, risk: 'moyen', showOptions: false,
        icon: <AlertTriangle className="w-4 h-4" />, options: { ...opts },
      },
      {
        id: 'text_cleaning', title: 'Normaliser les textes',
        description: 'Emojis, caractères spéciaux, espaces inutiles',
        impact: `${textFixes} corrections estimées`,
        selected: false, risk: 'faible', showOptions: false,
        icon: <Type className="w-4 h-4" />, options: { ...opts },
      },
      {
        id: 'date_format', title: 'Harmoniser les dates',
        description: `${dateFormatsCount} formats différents détectés`,
        impact: 'Toutes les dates converties au format choisi',
        selected: false, risk: 'faible', showOptions: false,
        icon: <Calendar className="w-4 h-4" />, options: { ...opts },
      },
      {
        id: 'case_normalization', title: 'Uniformiser la casse',
        description: `${inconsistentCase} cellules avec casses différentes`,
        impact: `${inconsistentCase} corrections`,
        selected: false, risk: 'faible', showOptions: false,
        icon: <Settings2 className="w-4 h-4" />, options: { ...opts },
      },
    ];

    setCleaningActions(actions);

    let intro = `🎯 Fichier analysé avec succès !\n\n`;
    if (mixedCols.length > 0) {
      intro += `⚠️ Colonnes mixtes détectées (numérique + texte) : **${mixedCols.join(', ')}**\n`;
      intro += `→ Une action dédiée a été ajoutée.\n\n`;
    }
    intro += `${actions.length} types de corrections disponibles.\nCliquez sur ⚙️ pour configurer chaque action, puis appliquez.`;

    addMessage('bot', intro, 'actions', [
      'Quelle est la qualité globale ?', 'Que me recommandes-tu ?', 'Y a-t-il des valeurs manquantes ?'
    ]);
  };

  const toggleAction  = (id: string) => setCleaningActions(prev => prev.map(a => a.id === id ? { ...a, selected: !a.selected } : a));
  const toggleOptions = (id: string) => setCleaningActions(prev => prev.map(a => a.id === id ? { ...a, showOptions: !a.showOptions } : a));
  const updateOptions = (id: string, patch: Partial<ActionOptions>) =>
    setCleaningActions(prev => prev.map(a => a.id === id ? { ...a, options: { ...a.options, ...patch } } : a));

  const executeActions = async () => {
    const selected = cleaningActions.filter(a => a.selected);
    if (selected.length === 0) { addMessage('bot', '⚠️ Aucune action sélectionnée.'); return; }

    const mergedOpts: ActionOptions = selected.reduce((acc, a) => ({ ...acc, ...a.options }), {} as ActionOptions);
    const actionIds = selected.map(a => a.id);
    const combinedTitle = selected.map(a => a.title).join(' · ');

    addMessage('user', `✅ Actions : ${selected.map(a => a.title).join(', ')}`);
    addMessage('bot', '🔧 Nettoyage en cours...', 'loading');

    const localId = addLocalHistoryEntry(combinedTitle, mergedOpts);

    try {
      const res = await authFetch(`${API_URL}/api/clean`, {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          actions: actionIds,
          options: mergedOpts,
          outlier_method: mergedOpts.outlierMethod || 'median',
        })
      });
      const data = await res.json();
      setMessages(prev => prev.filter(m => m.type !== 'loading'));

      if (res.ok) {
        const rowResult = `${data.results?.initial_rows || '?'} → ${data.results?.final_rows || '?'} lignes`;
        updateLocalHistoryEntry(localId, 'success', rowResult);

        if (data.history_entry) {
          const backendEntry = backendEntryToHistoryEntry(data.history_entry);
          setOperationHistory(prev => [backendEntry, ...prev.filter(e => e.id !== localId)]);
        }

        displayResults(data.results, data.download_filename);
        loadSessions();
      } else {
        updateLocalHistoryEntry(localId, 'error', data.error);
        addMessage('bot', `❌ Erreur : ${data.error || 'Nettoyage impossible'}`);
      }
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.type !== 'loading'));
      updateLocalHistoryEntry(localId, 'error', err.message);
      addMessage('bot', `❌ Erreur : ${err.message}`);
    }
  };

  const displayResults = (results: any, downloadFilename: string) => {
    if (!results) return;
    setStep('results');
    let summary = `✨ Nettoyage terminé !\n\n`;
    summary += `📊 Avant : ${results.initial_rows} lignes → Après : ${results.final_rows} lignes\n`;
    summary += `Différence : -${results.initial_rows - results.final_rows} lignes\n\n✅ Effectué :\n`;
    if (results.duplicates_removed) summary += `• ${results.duplicates_removed.exact_duplicates_removed || 0} doublons exacts + ${results.duplicates_removed.structural_duplicates_removed || 0} structurels\n`;
    if (results.missing_corrected)  summary += `• ${results.missing_corrected} valeurs manquantes corrigées\n`;
    if (results.mixed_columns_corrected) summary += `• ${results.mixed_columns_corrected} valeurs mixtes corrigées\n`;
    if (results.outliers_info)      summary += `• ${results.outliers_info.total_outliers || 0} outliers (${results.outliers_info.method_used})\n`;
    if (results.text_normalized)    summary += `• ${results.text_normalized} textes normalisés\n`;
    summary += `\n💾 Choisissez le format et téléchargez vos données nettoyées !`;
    addMessage('bot', summary, 'results');
    addMessage('bot', { downloadUrl: `${API_URL}/api/download/${sessionId}`, filename: downloadFilename }, 'download');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCurrentFile(file);
    addMessage('user', `📄 ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
    addMessage('bot', '🔍 Envoi du fichier et analyse en cours...', 'loading');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await authFetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      setMessages(prev => prev.filter(m => m.type !== 'loading'));
      if (res.ok) {
        setSessionId(data.session_id);
        setAnalysisData(data.analysis);
        setOperationHistory([]);

        const backendMixed: string[] = data.analysis?.mixed_columns || [];
        setMixedColumns(backendMixed);

        setStep('actions');
        proposeActions(data.analysis, backendMixed);
        loadSessions();
      } else {
        addMessage('bot', `❌ Erreur : ${data.error || 'Analyse non disponible'}`);
      }
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.type !== 'loading'));
      addMessage('bot', `❌ ${err.message}`);
    }
  };

  const viewData = async (type: 'before' | 'after' = 'before') => {
    if (!sessionId) return;
    const endpoint = type === 'before'
      ? `${API_URL}/api/preview/${sessionId}`
      : `${API_URL}/api/preview-cleaned/${sessionId}`;
    try {
      const res = await authFetch(endpoint);
      if (!res.ok) { const e = await res.json(); addMessage('bot', `❌ ${e.error}`); return; }
      const data = await res.json();
      if (data.mixed_columns) setMixedColumns(data.mixed_columns);
      setPreviewData(data); setPreviewType(type); setShowPreview(true);
    } catch (err: any) { addMessage('bot', `❌ ${err.message}`); }
  };

  const startNewSession = () => {
    setMessages([]); setCurrentFile(null); setAnalysisData(null);
    setCleaningActions([]); setSessionId(null); setStep('upload');
    setShowPreview(false); setIsRestoring(false);
    setMixedColumns([]); setOperationHistory([]);
    addMessage('bot', `👋 Nouvelle session démarrée. Téléchargez votre fichier.`);
  };

  const reanalyze = () => {
    setStep('actions');
    setMessages(prev => prev.filter(m => m.type !== 'results' && m.type !== 'download'));
    proposeActions(analysisData, mixedColumns);
    addMessage('bot', '🔄 Modifiez les actions et relancez le nettoyage.');
  };

  const getRecommendations = async () => {
    if (!sessionId) { addMessage('bot', '❌ Chargez d\'abord un fichier.'); return; }
    setIsAsking(true);
    addMessage('user', '💡 Recommande-moi des actions');
    try {
      const res = await authFetch(`${API_URL}/api/chat/recommend`, {
        method: 'POST', body: JSON.stringify({ session_id: sessionId })
      });
      const data = await res.json();
      let msg = "📋 Recommandations :\n\n";
      data.recommendations.forEach((r: any, i: number) => {
        msg += `${i + 1}. ${r.title}\n   📌 ${r.justification}\n   📊 ${r.impact}\n   ⚡ ${r.priority.toUpperCase()}\n\n`;
      });
      addMessage('bot', msg, 'text', ['Détaille les valeurs manquantes', 'Y a-t-il des outliers ?', 'Qualité globale ?']);
    } finally { setIsAsking(false); }
  };

  const generateReport = async () => {
    if (!sessionId) { addMessage('bot', '❌ Chargez d\'abord un fichier.'); return; }
    setIsGeneratingReport(true);
    addMessage('user', '📄 Génère un rapport détaillé');
    try {
      const res = await authFetch(`${API_URL}/api/chat/generate-report`, {
        method: 'POST', body: JSON.stringify({ session_id: sessionId })
      });
      const data = await res.json();
      addMessage('bot', `📊 Rapport généré pour ${currentFile?.name}`, 'report');
      addMessage('bot', { sessionId, reportUrl: data.download_url, filename: data.filename }, 'download-report');
    } finally { setIsGeneratingReport(false); }
  };

  const askQuestion = async () => {
    if (!userQuestion.trim() || !sessionId) {
      if (!sessionId) addMessage('bot', '❌ Chargez d\'abord un fichier.');
      return;
    }
    await askQuestionWith(userQuestion);
    setUserQuestion('');
  };

  const getRiskBadge = (risk: string) =>
    risk === 'faible' ? 'bg-green-100 text-green-700' :
    risk === 'moyen'  ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';

  const getStatusBadge = (status: string) =>
    status === 'cleaned'  ? { color: 'bg-green-100 text-green-700', text: 'Nettoyé' } :
    status === 'uploaded' ? { color: 'bg-blue-100 text-blue-700',   text: 'Analysé' } :
    { color: 'bg-gray-100 text-gray-700', text: 'En cours' };

  const renderSubOptions = (action: CleaningAction) => {
    if (!action.showOptions) return null;
    const update = (patch: Partial<ActionOptions>) => updateOptions(action.id, patch);
    switch (action.id) {
      case 'missing_values':    return <MissingValuesOptions opts={action.options} onChange={update} />;
      case 'mixed_columns':     return <MixedColumnsOptions opts={action.options} onChange={update} mixedCols={mixedColumns} />;
      case 'outliers':          return <OutliersOptions opts={action.options} onChange={update} />;
      case 'text_cleaning':     return <TextCleaningOptions opts={action.options} onChange={update} />;
      case 'date_format':       return <DateOptions opts={action.options} onChange={update} />;
      case 'case_normalization':return <CaseOptions opts={action.options} onChange={update} />;
      default: return null;
    }
  };

  const getCellIssues = (value: any, colName: string) => {
    if (!analysisData) return [];
    const issues: any[] = [];
    if (value === null || value === undefined || value === '')
      issues.push({ label: 'Valeur manquante', description: 'Cellule vide ou nulle', color: 'bg-yellow-100 border-yellow-400' });
    if (analysisData.outliers?.[colName] && typeof value === 'number')
      issues.push({ label: 'Valeur aberrante', description: 'Statistiquement anormale (IQR)', color: 'bg-red-100 border-red-400' });
    if (analysisData.text_issues?.[colName] && typeof value === 'string') {
      const ti = analysisData.text_issues[colName];
      if (ti.emojis > 0 && /\p{Emoji}/u.test(value))
        issues.push({ label: 'Emoji', description: 'Contient des emojis', color: 'bg-blue-100 border-blue-400' });
      if (ti.specialChars > 0 && /[^\w\s\-.,;:!?']/.test(value))
        issues.push({ label: 'Caract. spéciaux', description: 'Caractères inhabituels', color: 'bg-purple-100 border-purple-400' });
      if (ti.spaces > 0 && /\s{2,}/.test(value))
        issues.push({ label: 'Espaces multiples', description: 'Espaces en trop', color: 'bg-indigo-100 border-indigo-400' });
    }
    if (analysisData.date_formats?.[colName]?.length > 1)
      issues.push({ label: 'Format date mixte', description: `${analysisData.date_formats[colName].length} formats différents`, color: 'bg-orange-100 border-orange-400' });
    if (mixedColumns.includes(colName) && value !== null && value !== undefined && value !== '' && isNaN(Number(value)))
      issues.push({ label: 'Valeur texte inattendue', description: 'Colonne attendue numérique', color: 'bg-pink-100 border-pink-400' });
    return issues;
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-gray-50">

      {/* SIDEBAR */}
      <div className="w-72 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200 space-y-2">
          <button onClick={startNewSession}
            className="w-full bg-gray-900 text-white rounded-lg px-4 py-3 hover:bg-gray-800 transition-colors font-medium">
            + Nouveau nettoyage
          </button>
          <button onClick={openHistory}
            className="w-full flex items-center justify-center gap-2 border border-gray-200 text-gray-600 rounded-lg px-4 py-2.5 hover:bg-gray-50 transition-colors text-sm font-medium">
            <History className="w-4 h-4" />
            Historique des opérations
            {operationHistory.length > 0 && (
              <span className="ml-auto bg-gray-900 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {operationHistory.length}
              </span>
            )}
          </button>

          {/* ── Multi-download avec sélecteur de format ─────────────────── */}
          {selectedSessions.length > 0 && (
            <MultiDownloadBar
              selectedSessions={selectedSessions}
              isDownloading={isDownloading}
              onSelectAll={() => setSelectedSessions(sessions.filter(s => s.status === 'cleaned').slice(0, 10).map(s => s.session_id))}
              onClear={() => setSelectedSessions([])}
              onDownload={async (fmt) => {
                setIsDownloading(true);
                try {
                  const res = await authFetch(`${API_URL}/api/download-multiple`, {
                    method: 'POST',
                    body: JSON.stringify({ session_ids: selectedSessions, format: fmt })
                  });
                  if (!res.ok) { const e = await res.json(); addMessage('bot', `❌ ${e.error}`); return; }
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = `data_cleaned_${Date.now()}.zip`;
                  document.body.appendChild(a); a.click();
                  window.URL.revokeObjectURL(url); document.body.removeChild(a);
                  addMessage('bot', `✅ ${selectedSessions.length} fichier(s) téléchargé(s) en ${fmt.toUpperCase()} !`);
                  setSelectedSessions([]);
                } finally { setIsDownloading(false); }
              }}
            />
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sessions récentes</div>
            <button onClick={loadSessions} className="text-gray-400 hover:text-gray-600"><RefreshCw className="w-4 h-4" /></button>
          </div>
          {sessions.length === 0 && <div className="text-sm text-gray-400 text-center py-8">Aucune session</div>}
          {sessions.map(s => {
            const badge = getStatusBadge(s.status);
            const isSelected = selectedSessions.includes(s.session_id);
            return (
              <div key={s.session_id}
                className={`p-3 rounded-lg mb-2 border transition-all ${sessionId === s.session_id ? 'border-gray-900 bg-gray-50' : 'border-gray-100'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                <div className="flex items-start gap-2">
                  {s.status === 'cleaned' && (
                    <input type="checkbox" checked={isSelected}
                      onChange={e => { e.stopPropagation(); setSelectedSessions(prev => isSelected ? prev.filter(id => id !== s.session_id) : [...prev, s.session_id]); }}
                      className="mt-1 w-4 h-4 rounded border-gray-300 text-green-600 cursor-pointer" />
                  )}
                  <div onClick={() => restoreSession(s)} className="flex-1 cursor-pointer hover:opacity-80">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-gray-900 truncate flex-1">{s.filename}</div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${badge.color} whitespace-nowrap`}>{badge.text}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                      <Clock className="w-3 h-3" />
                      {new Date(s.timestamp).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">{s.rows} lignes × {s.columns} colonnes</div>
                    {(s.operation_count || 0) > 0 && (
                      <div className="text-xs text-blue-500 mt-1 flex items-center gap-1">
                        <History className="w-3 h-3" />{s.operation_count} opération(s)
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MAIN */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Assistant de Nettoyage de Données</h1>
            {currentFile && <p className="text-sm text-gray-500 mt-1">Fichier : {currentFile.name || currentFile.filename}</p>}
          </div>
          <div className="flex items-center gap-2">
            {sessionId && (
              <>
                <button onClick={() => viewData('before')}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm">
                  <Eye className="w-4 h-4" />Original
                </button>
                {step === 'results' && (
                  <>
                    <button onClick={() => viewData('after')}
                      className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm">
                      <Eye className="w-4 h-4" />Nettoyé
                    </button>
                    <button onClick={reanalyze}
                      className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors text-sm">
                      <RefreshCw className="w-4 h-4" />Modifier
                    </button>
                  </>
                )}
              </>
            )}
            <div className="relative">
              <button onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                <User className="w-4 h-4 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">{user?.name || 'Utilisateur'}</span>
              </button>
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                    <p className="text-xs text-gray-500">{user?.email}</p>
                  </div>
                  <button onClick={() => { setShowUserMenu(false); onLogout(); }}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                    <LogOut className="w-4 h-4" />Déconnexion
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-2xl w-full ${msg.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-2xl rounded-br-sm'
                  : 'bg-white border border-gray-200 rounded-2xl rounded-bl-sm'
                } px-5 py-4 shadow-sm`}>

                  {msg.type === 'loading' ? (
                    <div className="flex items-center gap-2 text-gray-600">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-gray-600" />
                      {msg.content}
                    </div>

                  ) : msg.type === 'actions' ? (
                    <div>
                      <div className="whitespace-pre-line text-gray-800 mb-4">{msg.content}</div>
                      <div className="space-y-3 mt-4">
                        {cleaningActions.map(action => (
                          <div key={action.id}
                            className={`border-2 rounded-xl transition-all ${action.selected ? 'border-gray-900 bg-gray-50' : 'border-gray-200'}`}>
                            <div className="flex items-start gap-3 p-4">
                              <div onClick={() => toggleAction(action.id)}
                                className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 cursor-pointer ${action.selected ? 'bg-gray-900 border-gray-900' : 'border-gray-300'}`}>
                                {action.selected && <CheckCircle className="w-3 h-3 text-white" />}
                              </div>
                              <div className="flex-1 cursor-pointer" onClick={() => toggleAction(action.id)}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-gray-500">{action.icon}</span>
                                  <h4 className="font-semibold text-gray-900">{action.title}</h4>
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${getRiskBadge(action.risk)}`}>
                                    Risque {action.risk}
                                  </span>
                                  {action.id === 'mixed_columns' && (
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-pink-100 text-pink-700 font-medium">
                                      ⚠️ Nouveau
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-gray-600 mt-1">{action.description}</p>
                                <p className="text-xs text-gray-400 mt-1"><strong>Impact :</strong> {action.impact}</p>
                              </div>
                              {action.id !== 'duplicates' && (
                                <button onClick={() => toggleOptions(action.id)}
                                  className={`flex-shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-all ${action.showOptions ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}>
                                  <Settings2 className="w-3.5 h-3.5" />
                                  {action.showOptions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                </button>
                              )}
                            </div>
                            {action.showOptions && (
                              <div className="px-4 pb-4">{renderSubOptions(action)}</div>
                            )}
                          </div>
                        ))}
                      </div>
                      <button onClick={executeActions}
                        className="w-full mt-4 bg-gray-900 text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors font-medium">
                        ✨ Appliquer les actions sélectionnées
                      </button>
                      {msg.suggestions && (
                        <SuggestionChips suggestions={msg.suggestions} disabled={isAsking} onSelect={askQuestionWith} />
                      )}
                    </div>

                  ) : msg.type === 'results' ? (
                    <div className="whitespace-pre-line text-gray-800">{msg.content}</div>

                  ) : msg.type === 'download' ? (
                    /* ── Sélecteur de format + bouton téléchargement ── */
                    <DownloadMessage
                      content={msg.content}
                      onMessage={(text) => addMessage('bot', text)}
                    />

                  ) : msg.type === 'download-report' ? (
                    <button onClick={async () => {
                      const id = msg.content.sessionId || sessionId;
                      const res = await authFetch(`${API_URL}/api/download-report/${id}`);
                      const blob = await res.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = msg.content.filename || `rapport.docx`;
                      document.body.appendChild(a); a.click();
                      window.URL.revokeObjectURL(url); document.body.removeChild(a);
                    }} className="mt-2 bg-purple-600 text-white px-6 py-3 rounded-lg flex items-center gap-2 hover:bg-purple-700 transition-colors">
                      <Download className="w-4 h-4" /> Télécharger le rapport
                    </button>

                  ) : (
                    <div>
                      <div className="whitespace-pre-line text-gray-800">{msg.content}</div>
                      {msg.sender === 'bot' && msg.suggestions && (
                        <SuggestionChips suggestions={msg.suggestions} disabled={isAsking} onSelect={askQuestionWith} />
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input bar */}
        {sessionId && step === 'actions' && (
          <div className="border-t border-gray-200 bg-white p-5 flex-shrink-0">
            <div className="max-w-3xl mx-auto space-y-3">
              <div className="flex gap-2 flex-wrap">
                <button onClick={getRecommendations} disabled={isAsking}
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2 disabled:opacity-50 text-sm">
                  💡 Recommandations
                </button>
                <button onClick={generateReport} disabled={isGeneratingReport}
                  className="bg-purple-500 text-white px-4 py-2 rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-2 disabled:opacity-50 text-sm">
                  📄 {isGeneratingReport ? 'Génération...' : 'Rapport'}
                </button>
                <button onClick={() => askQuestionWith('Quelle est la qualité globale de mes données ?')} disabled={isAsking}
                  className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 text-sm">
                  🎯 Évaluer la qualité
                </button>
              </div>
              <div className="flex gap-2">
                <input type="text" value={userQuestion} onChange={e => setUserQuestion(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !isAsking && askQuestion()}
                  placeholder="Posez une question sur vos données..."
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  disabled={isAsking} />
                <button onClick={askQuestion} disabled={isAsking || !userQuestion.trim()}
                  className="bg-gray-900 text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50">
                  {isAsking ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" /> : 'Envoyer'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Upload zone */}
        {step === 'upload' && (
          <div className="border-t border-gray-200 bg-white p-6 flex-shrink-0">
            <div className="max-w-3xl mx-auto">
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.json,.xml" onChange={handleFileUpload} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 hover:border-gray-400 transition-colors">
                <div className="flex flex-col items-center gap-3">
                  <Upload className="w-12 h-12 text-gray-400" />
                  <div className="text-center">
                    <div className="font-medium text-gray-900">Cliquez pour télécharger</div>
                    <div className="text-sm text-gray-500 mt-1">CSV, XLSX, XLS, JSON, XML (max 50 MB)</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* HISTORY PANEL */}
      {showHistory && (
        <HistoryPanel history={operationHistory} isLoading={isHistoryLoading} onClose={() => setShowHistory(false)} />
      )}

      {/* PREVIEW MODAL */}
      {showPreview && previewData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-[95vw] w-full max-h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {previewType === 'before' ? '📋 Données Originales' : '✨ Données Nettoyées'}
                  <span className="text-sm font-normal text-gray-500 ml-2">
                    ({previewData.total_rows.toLocaleString()} lignes × {previewData.columns.length} colonnes)
                  </span>
                </h2>
                {previewType === 'before' && mixedColumns.length > 0 && (
                  <p className="text-xs text-pink-600 mt-1">
                    ⚠️ Colonnes mixtes détectées (rose) : {mixedColumns.join(', ')}
                  </p>
                )}
              </div>
              <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <table className="border-collapse border border-gray-300">
                <thead className="bg-gray-100 sticky top-0 z-10">
                  <tr>
                    <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 bg-gray-100 sticky left-0 z-20">#</th>
                    {previewData.columns.map((col: string, i: number) => (
                      <th key={i} className={`border border-gray-300 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap ${
                        mixedColumns.includes(col) && previewType === 'before' ? 'text-pink-700 bg-pink-50' : 'text-gray-700'
                      }`}>
                        {col}{mixedColumns.includes(col) && previewType === 'before' ? ' ⚠️' : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.rows.map((row: any[], rowIdx: number) => (
                    <tr key={rowIdx} className="hover:bg-gray-50">
                      <td className="border border-gray-300 px-3 py-2 text-xs text-gray-500 bg-gray-50 sticky left-0 z-10 font-medium">{rowIdx + 1}</td>
                      {row.map((cell: any, cellIdx: number) => {
                        const colName = previewData.columns[cellIdx];
                        const issues = previewType === 'before' ? getCellIssues(cell, colName) : [];
                        const hasIssues = issues.length > 0;
                        const primaryIssue = issues[0];
                        return (
                          <td key={cellIdx}
                            className={`border border-gray-300 px-3 py-2 text-sm text-gray-800 whitespace-nowrap relative group ${hasIssues ? `${primaryIssue.color} border-2` : ''}`}
                            onMouseEnter={() => hasIssues && setHoveredCell({ row: rowIdx, col: cellIdx })}
                            onMouseLeave={() => setHoveredCell(null)}>
                            <div className="flex items-center gap-1">
                              {hasIssues && <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0" />}
                              {cell === null || cell === undefined || cell === ''
                                ? <span className="text-gray-400 italic text-xs">∅ vide</span>
                                : typeof cell === 'number'
                                  ? <span className="text-blue-700 font-mono">{cell}</span>
                                  : <span>{String(cell)}</span>}
                            </div>
                            {hasIssues && hoveredCell?.row === rowIdx && hoveredCell?.col === cellIdx && (
                              <div className="absolute z-50 left-0 top-full mt-1 w-72 bg-gray-900 text-white text-xs rounded-lg shadow-xl p-3 pointer-events-none">
                                <div className="font-semibold mb-2 flex items-center gap-2">
                                  <AlertCircle className="w-4 h-4" />{issues.length} problème(s)
                                </div>
                                {issues.map((issue, i2) => (
                                  <div key={i2} className="border-t border-gray-700 pt-2 mt-2">
                                    <div className="font-medium text-yellow-300">{issue.label}</div>
                                    <div className="text-gray-300 mt-0.5">{issue.description}</div>
                                  </div>
                                ))}
                                <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-900 transform rotate-45" />
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Legend */}
            <div className="border-t border-gray-200 p-4 bg-gray-50 flex-shrink-0">
              <div className="text-xs font-semibold text-gray-700 mb-2">Légende :</div>
              <div className="flex flex-wrap gap-3 text-xs">
                {[
                  ['bg-yellow-100 border-yellow-400', 'Valeur manquante'],
                  ['bg-red-100 border-red-400',       'Valeur aberrante'],
                  ['bg-blue-100 border-blue-400',      'Emoji'],
                  ['bg-purple-100 border-purple-400',  'Caract. spéciaux'],
                  ['bg-orange-100 border-orange-400',  'Format date mixte'],
                  ['bg-pink-100 border-pink-400',      'Texte dans col. numérique'],
                ].map(([cls, label]) => (
                  <div key={label} className="flex items-center gap-1">
                    <div className={`w-4 h-4 border-2 rounded ${cls}`} />
                    <span className="text-gray-600">{label}</span>
                  </div>
                ))}
              </div>
            </div>
            {previewData.total_rows > 100 && (
              <div className="text-center text-sm text-gray-500 p-3 bg-gray-50 border-t border-gray-200 flex-shrink-0">
                Affichage des 100 premières lignes sur {previewData.total_rows.toLocaleString()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DataCleaningAssistant;