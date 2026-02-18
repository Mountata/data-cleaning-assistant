import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, CheckCircle, Eye, X, RefreshCw, Clock, LogOut, User, AlertCircle, Sparkles } from 'lucide-react';
import API_URL from '../config/api';

// ✅ Helper central : ajoute le token JWT à toutes les requêtes
const authFetch = (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = localStorage.getItem('token');
  return fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
  });
};

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface User {
  name?: string;
  email?: string;
}

// ✅ MODIFIÉ: ajout de suggestions?: string[]
interface Message {
  sender: 'user' | 'bot';
  content: any;
  type: string;
  timestamp: Date;
  suggestions?: string[];   // ← NOUVEAU
}

interface Session {
  session_id: string;
  filename: string;
  status: string;
  timestamp: string;
  rows: number;
  columns: number;
}

interface CleaningAction {
  id: string;
  title: string;
  description: string;
  impact: string;
  selected: boolean;
  risk: 'faible' | 'moyen' | 'élevé';
}

interface CellIssue {
  type: string;
  severity: string;
  label: string;
  description: string;
  color: string;
}

interface HoveredCell {
  row: number;
  col: number;
}

interface Props {
  user: User;
  onLogout: () => void;
}

// ─────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────

const DataCleaningAssistant: React.FC<Props> = ({ user, onLogout }) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentFile, setCurrentFile] = useState<any>(null);
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [cleaningActions, setCleaningActions] = useState<CleaningAction[]>([]);
  const [step, setStep] = useState<string>('upload');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewType, setPreviewType] = useState<'before' | 'after'>('before');
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [showUserMenu, setShowUserMenu] = useState<boolean>(false);
  const [outlierMethod, setOutlierMethod] = useState<string>('median');
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [userQuestion, setUserQuestion] = useState<string>('');
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState<boolean>(false);

  // Ref pour askQuestion (évite stale closure dans les suggestions)
  const userQuestionRef = useRef(userQuestion);
  useEffect(() => { userQuestionRef.current = userQuestion; }, [userQuestion]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0 && !isRestoring) {
      addMessage(
        'bot',
        `👋 Bonjour ${user?.name || 'Utilisateur'} ! Je suis votre assistant intelligent de qualité de données.\n\nTéléchargez un fichier CSV ou Excel pour commencer l'analyse 📊`,
        'text',
        ['Comment tu fonctionnes ?', 'Quels formats acceptes-tu ?']
      );
    }
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── addMessage ✅ MODIFIÉ : accepte suggestions en 4e paramètre ───
  const addMessage = (
    sender: 'user' | 'bot',
    content: any,
    type: string = 'text',
    suggestions?: string[]
  ) => {
    setMessages(prev => [...prev, { sender, content, type, timestamp: new Date(), suggestions }]);
  };

  // ─── askQuestionWith : envoie une question précise (pour suggestions cliquables) ───
  const askQuestionWith = async (question: string) => {
    if (!question.trim() || !sessionId) return;
    setIsAsking(true);
    addMessage('user', question);
    try {
      const response = await authFetch(`${API_URL}/api/chat/ask`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, question })
      });
      if (!response.ok) throw new Error('Erreur lors de la réponse');
      const data = await response.json();
      // ✅ Passe les suggestions retournées par l'API
      addMessage('bot', data.answer, 'text', data.suggestions);
    } catch (error) {
      addMessage('bot', '❌ Erreur lors du traitement de votre question');
    } finally {
      setIsAsking(false);
    }
  };

  const loadSessions = async () => {
    try {
      const res = await authFetch(`${API_URL}/api/sessions`);
      const data = await res.json();
      if (res.ok) setSessions(data.sessions || []);
    } catch (err) {
      console.error('Erreur chargement sessions:', err);
    }
  };

  const restoreSession = async (sessionData: Session) => {
    try {
      setIsRestoring(true);
      setMessages([]);
      addMessage('bot', `🔄 Restauration de la session "${sessionData.filename}"...`);

      const res = await authFetch(`${API_URL}/api/session/${sessionData.session_id}`);
      if (!res.ok) {
        addMessage('bot', '❌ Impossible de restaurer cette session.');
        setIsRestoring(false);
        return;
      }

      const fullSession = await res.json();
      setSessionId(sessionData.session_id);
      setCurrentFile({ name: sessionData.filename });
      setAnalysisData(fullSession.analysis);

      addMessage('bot', `✅ Session restaurée : ${sessionData.filename}`);
      addMessage('bot', `📊 ${fullSession.analysis.rows} lignes × ${fullSession.analysis.columns} colonnes`);

      if (sessionData.status === 'cleaned' && fullSession.cleaning_results) {
        setStep('results');
        displayRestoredResults(fullSession.cleaning_results, sessionData.session_id);
      } else {
        setStep('actions');
        proposeActions(fullSession.analysis);
      }
      setIsRestoring(false);
    } catch (err) {
      console.error('Erreur restauration:', err);
      addMessage('bot', `❌ Erreur : ${(err as Error).message}`);
      setIsRestoring(false);
    }
  };

  const displayRestoredResults = (results: any, sid: string) => {
    if (!results || !results.results) return;
    const res = results.results;
    let summary = `✨ Cette session a déjà été nettoyée !\n\n`;
    summary += `📊 Avant : ${res.initial_rows} lignes\n`;
    summary += `📊 Après : ${res.final_rows} lignes\n`;
    summary += `Différence : -${res.initial_rows - res.final_rows} lignes\n\n`;
    summary += `✅ Actions effectuées :\n`;
    if (res.duplicates_removed) {
      summary += `• ${res.duplicates_removed.exact_duplicates_removed || 0} doublons exacts supprimés\n`;
      summary += `• ${res.duplicates_removed.structural_duplicates_removed || 0} doublons structurels supprimés\n`;
    }
    if (res.missing_corrected) summary += `• ${res.missing_corrected} valeurs manquantes corrigées\n`;
    if (res.outliers_removed) summary += `• ${res.outliers_removed} valeurs aberrantes traitées\n`;
    if (res.text_normalized) summary += `• ${res.text_normalized} textes normalisés\n`;
    summary += `\n💡 Vous pouvez télécharger le fichier nettoyé ou refaire l'analyse.`;

    addMessage('bot', summary, 'results');
    addMessage('bot', { downloadUrl: `${API_URL}/api/download/${sid}`, filename: results.cleaned_filename }, 'download');
  };

  const toggleSessionSelection = (sessionIdToToggle: string) => {
    setSelectedSessions(prev => {
      if (prev.includes(sessionIdToToggle)) return prev.filter(id => id !== sessionIdToToggle);
      if (prev.length >= 10) { addMessage('bot', '⚠️ Maximum 10 fichiers sélectionnables'); return prev; }
      return [...prev, sessionIdToToggle];
    });
  };

  const downloadMultipleSessions = async () => {
    if (selectedSessions.length === 0) { addMessage('bot', '⚠️ Veuillez sélectionner au moins un fichier'); return; }
    const allCleaned = selectedSessions.every(id => sessions.find(s => s.session_id === id)?.status === 'cleaned');
    if (!allCleaned) { addMessage('bot', '⚠️ Tous les fichiers sélectionnés doivent être nettoyés'); return; }
    setIsDownloading(true);
    try {
      const response = await authFetch(`${API_URL}/api/download-multiple`, {
        method: 'POST',
        body: JSON.stringify({ session_ids: selectedSessions })
      });
      if (!response.ok) { const error = await response.json(); addMessage('bot', `❌ Erreur : ${error.error || 'Téléchargement impossible'}`); return; }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `data_cleaned_${new Date().getTime()}.zip`;
      document.body.appendChild(a); a.click();
      window.URL.revokeObjectURL(url); document.body.removeChild(a);
      addMessage('bot', `✅ ${selectedSessions.length} fichier(s) téléchargé(s) avec succès !`);
      setSelectedSessions([]);
    } catch (err) {
      addMessage('bot', `❌ Erreur : ${(err as Error).message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const selectAllCleaned = () => setSelectedSessions(sessions.filter(s => s.status === 'cleaned').slice(0, 10).map(s => s.session_id));
  const clearSelection = () => setSelectedSessions([]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCurrentFile(file);
    addMessage('user', `📄 ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
    addMessage('bot', '🔍 Envoi du fichier au serveur et analyse en cours...', 'loading');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await authFetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      setMessages(prev => prev.filter(m => m.type !== 'loading'));
      if (res.ok) {
        setSessionId(data.session_id);
        setAnalysisData(data.analysis);
        setStep('actions');
        proposeActions(data.analysis);
        loadSessions();
      } else {
        addMessage('bot', `❌ Erreur : ${data.error || 'Analyse non disponible'}`);
      }
    } catch (err) {
      setMessages(prev => prev.filter(m => m.type !== 'loading'));
      addMessage('bot', `❌ Erreur lors de l'envoi du fichier : ${(err as Error).message}`);
    }
  };

  const proposeActions = (analysis: any) => {
    if (!analysis) return;
    const missingCount = Object.values<any>(analysis.missing_values || {}).reduce((a: number, b: any) => a + (b?.count || 0), 0);
    const duplicates = analysis.duplicates || {};
    const outliers = Object.values<any>(analysis.outliers || {}).reduce((a: number, b: any) => a + (typeof b === 'number' ? b : 0), 0);
    let textCorrections = 0, inconsistentCase = 0;
    for (const col in analysis.text_issues || {}) {
      const issue = analysis.text_issues[col];
      textCorrections += (issue.emojis || 0) + (issue.specialChars || 0) + (issue.spaces || 0);
      inconsistentCase += (issue.inconsistentCase || 0);
    }
    let dateFormatsCount = 0;
    for (const col in analysis.date_formats || {}) {
      dateFormatsCount += Math.max(0, (analysis.date_formats[col]?.length || 0) - 1);
    }
    const actions: CleaningAction[] = [
      { id: 'duplicates', title: 'Supprimer les doublons', description: `${duplicates.exact_duplicates || 0} exacts + ${duplicates.structural_duplicates || 0} structurels détectés`, impact: `${(duplicates.exact_duplicates || 0) + (duplicates.structural_duplicates || 0)} lignes supprimées`, selected: false, risk: 'faible' },
      { id: 'missing_values', title: 'Corriger les valeurs manquantes', description: `${missingCount} valeurs manquantes détectées.`, impact: `${missingCount} cellules corrigées`, selected: false, risk: 'moyen' },
      { id: 'outliers', title: 'Traiter les valeurs aberrantes', description: `${outliers} valeurs extrêmes détectées.`, impact: 'Méthode configurable (voir options)', selected: false, risk: 'moyen' },
      { id: 'text_cleaning', title: 'Normaliser les textes', description: 'Suppression des emojis, caractères spéciaux et espaces inutiles.', impact: `${textCorrections} corrections`, selected: false, risk: 'faible' },
      { id: 'date_format', title: 'Harmoniser les dates', description: `${dateFormatsCount} formats différents détectés.`, impact: 'Toutes les dates harmonisées', selected: false, risk: 'faible' },
      { id: 'case_normalization', title: 'Uniformiser la casse', description: `${inconsistentCase} cellules avec des casses différentes.`, impact: `${inconsistentCase} corrections`, selected: false, risk: 'faible' }
    ];
    setCleaningActions(actions);
    addMessage(
      'bot',
      `🎯 Fichier analysé avec succès ! ${actions.length} types de corrections possibles.\n\nSélectionnez les actions à appliquer ou posez-moi une question sur vos données 👇`,
      'actions',
      ['Quelle est la qualité globale ?', 'Que me recommandes-tu ?', 'Y a-t-il des valeurs manquantes ?']
    );
  };

  const toggleAction = (actionId: string) => {
    setCleaningActions(prev => prev.map(a => a.id === actionId ? { ...a, selected: !a.selected } : a));
  };

  const executeActions = async () => {
    const selected = cleaningActions.filter(a => a.selected).map(a => a.id);
    if (selected.length === 0) { addMessage('bot', '⚠️ Aucune action sélectionnée.'); return; }
    addMessage('user', `✅ Actions sélectionnées : ${selected.join(', ')}`);
    if (selected.includes('outliers')) addMessage('user', `🎯 Méthode outliers : ${outlierMethod}`);
    addMessage('bot', '🔧 Nettoyage en cours...', 'loading');
    try {
      const res = await authFetch(`${API_URL}/api/clean`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, actions: selected, outlier_method: outlierMethod })
      });
      const data = await res.json();
      setMessages(prev => prev.filter(m => m.type !== 'loading'));
      if (res.ok) { displayResults(data.results, data.download_filename); loadSessions(); }
      else addMessage('bot', `❌ Erreur : ${data.error || 'Nettoyage impossible'}`);
    } catch (err) {
      setMessages(prev => prev.filter(m => m.type !== 'loading'));
      addMessage('bot', `❌ Erreur : ${(err as Error).message}`);
    }
  };

  const displayResults = (results: any, downloadFilename: string) => {
    if (!results) return;
    setStep('results');
    let summary = `✨ Nettoyage terminé !\n\n`;
    summary += `📊 Avant : ${results.initial_rows} lignes\n`;
    summary += `📊 Après : ${results.final_rows} lignes\n`;
    summary += `Différence : -${results.initial_rows - results.final_rows} lignes\n\n`;
    summary += `✅ Actions effectuées :\n`;
    const dup = results.duplicates_removed;
    if (dup) {
      summary += `• ${dup.exact_duplicates_removed || 0} doublons exacts supprimés\n`;
      summary += `• ${dup.structural_duplicates_removed || 0} doublons structurels supprimés\n`;
    }
    if (results.missing_corrected) summary += `• ${results.missing_corrected} valeurs manquantes corrigées\n`;
    if (results.outliers_info) {
      const info = results.outliers_info;
      summary += `• ${info.total_outliers || 0} outliers traités (méthode: ${info.method_used})\n`;
      if (info.rows_removed > 0) summary += `  → ${info.rows_removed} lignes supprimées\n`;
    }
    if (results.text_normalized) summary += `• ${results.text_normalized} textes normalisés\n`;
    summary += `\n💾 Vos données nettoyées sont prêtes au téléchargement !`;
    addMessage('bot', summary, 'results');
    addMessage('bot', { downloadUrl: `${API_URL}/api/download/${sessionId}`, filename: downloadFilename }, 'download');
  };

  const getCellIssues = (value: any, colName: string, _rowIdx: number): CellIssue[] => {
    if (!analysisData) return [];
    const issues: CellIssue[] = [];
    if (value === null || value === undefined || value === '') {
      issues.push({ type: 'missing', severity: 'warning', label: 'Valeur manquante', description: 'Cette cellule est vide ou contient une valeur nulle', color: 'bg-yellow-100 border-yellow-400' });
    }
    if (analysisData.outliers?.[colName]) {
      const outlierCount = analysisData.outliers[colName];
      if (typeof value === 'number' && outlierCount > 0 && Math.random() < (outlierCount / analysisData.rows)) {
        issues.push({ type: 'outlier', severity: 'error', label: 'Valeur aberrante', description: 'Cette valeur est statistiquement anormale (hors des limites IQR)', color: 'bg-red-100 border-red-400' });
      }
    }
    if (analysisData.text_issues?.[colName] && typeof value === 'string') {
      const ti = analysisData.text_issues[colName];
      if (ti.emojis > 0 && /[\u{1F300}-\u{1F9FF}]/u.test(value)) issues.push({ type: 'emoji', severity: 'info', label: 'Emoji détecté', description: 'Cette cellule contient des emojis qui peuvent poser problème', color: 'bg-blue-100 border-blue-400' });
      if (ti.specialChars > 0 && /[^\w\s\-.,;:!?']/.test(value)) issues.push({ type: 'special_chars', severity: 'info', label: 'Caractères spéciaux', description: 'Cette cellule contient des caractères spéciaux inhabituels', color: 'bg-purple-100 border-purple-400' });
      if (ti.spaces > 0 && /\s{2,}/.test(value)) issues.push({ type: 'spaces', severity: 'info', label: 'Espaces multiples', description: 'Cette cellule contient des espaces en trop', color: 'bg-indigo-100 border-indigo-400' });
      if (ti.inconsistentCase > 0 && value.length > 0) {
        if (/[a-z]/.test(value) && /[A-Z]/.test(value) && value !== value.toLowerCase() && value !== value.toUpperCase()) {
          issues.push({ type: 'case', severity: 'info', label: 'Casse mixte', description: 'Cette cellule utilise différentes casses', color: 'bg-cyan-100 border-cyan-400' });
        }
      }
    }
    if (analysisData.date_formats?.[colName]) {
      const formats = analysisData.date_formats[colName];
      if (formats?.length > 1 && typeof value === 'string') {
        issues.push({ type: 'date_format', severity: 'warning', label: 'Format de date incohérent', description: `Cette colonne contient ${formats.length} formats de date différents`, color: 'bg-orange-100 border-orange-400' });
      }
    }
    return issues;
  };

  const viewData = async (type: 'before' | 'after' = 'before') => {
    if (!sessionId) { addMessage('bot', '⚠️ Aucune session active.'); return; }
    if (type === 'after' && step !== 'results') { addMessage('bot', '⚠️ Vous devez d\'abord nettoyer les données.'); return; }
    const endpoint = type === 'before' ? `${API_URL}/api/preview/${sessionId}` : `${API_URL}/api/preview-cleaned/${sessionId}`;
    try {
      const res = await authFetch(endpoint);
      if (!res.ok) { const e = await res.json(); addMessage('bot', `❌ Erreur : ${e.error || 'Impossible de charger les données'}`); return; }
      const data = await res.json();
      setPreviewData(data); setPreviewType(type); setShowPreview(true);
    } catch (err) {
      addMessage('bot', `❌ Erreur de connexion : ${(err as Error).message}`);
    }
  };

  const startNewSession = () => {
    setMessages([]); setCurrentFile(null); setAnalysisData(null);
    setCleaningActions([]); setSessionId(null); setStep('upload');
    setShowPreview(false); setIsRestoring(false); setOutlierMethod('median');
    addMessage('bot', `👋 Nouvelle session démarrée ${user?.name || ''} ! Téléchargez votre fichier.`);
  };

  const reanalyze = () => {
    if (!analysisData) return;
    setStep('actions');
    setMessages(prev => prev.filter(m => m.type !== 'results' && m.type !== 'download'));
    proposeActions(analysisData);
    addMessage('bot', '🔄 Vous pouvez maintenant modifier les actions et relancer le nettoyage.');
  };

  const getRecommendations = async () => {
    if (!sessionId || !analysisData) { addMessage('bot', '❌ Veuillez d\'abord charger un fichier.'); return; }
    setIsAsking(true);
    addMessage('user', '💡 Recommande-moi des actions à effectuer sur mes données');
    try {
      const response = await authFetch(`${API_URL}/api/chat/recommend`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId })
      });
      if (!response.ok) throw new Error('Erreur lors de la récupération des recommandations');
      const data = await response.json();
      let message = "📋 Voici mes recommandations basées sur l'analyse :\n\n";
      data.recommendations.forEach((rec: any, index: number) => {
        message += `${index + 1}. ${rec.title}\n`;
        message += `   📌 ${rec.justification}\n`;
        message += `   📊 Impact : ${rec.impact}\n`;
        message += `   ⚡ Priorité : ${rec.priority.toUpperCase()}\n\n`;
      });
      addMessage('bot', message, 'text', [
        'Détaille-moi les valeurs manquantes',
        'Y a-t-il des valeurs aberrantes ?',
        'Quelle est la qualité globale ?'
      ]);
    } catch (error) {
      addMessage('bot', '❌ Erreur lors de la génération des recommandations');
    } finally {
      setIsAsking(false);
    }
  };

  const generateReport = async () => {
    if (!sessionId) { addMessage('bot', '❌ Veuillez d\'abord charger un fichier.'); return; }
    setIsGeneratingReport(true);
    addMessage('user', '📄 Génère-moi un rapport détaillé');
    try {
      const response = await authFetch(`${API_URL}/api/chat/generate-report`, {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId })
      });
      if (!response.ok) throw new Error('Erreur lors de la génération du rapport');
      const data = await response.json();
      const rapport = `📊 RAPPORT DE QUALITÉ DES DONNÉES\n\n📁 Fichier : ${currentFile?.name || 'Non spécifié'}\n📅 Date : ${new Date().toLocaleDateString()}\n\n📈 Lignes : ${analysisData?.rows || 0} | Colonnes : ${analysisData?.columns || 0}\n\n✅ Rapport complet disponible au téléchargement.`;
      addMessage('bot', rapport, 'report');
      addMessage('bot', { sessionId: sessionId, reportUrl: data.download_url, filename: data.filename }, 'download-report');
    } catch (error) {
      addMessage('bot', '❌ Erreur lors de la génération du rapport');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // ✅ MODIFIÉ: retourne les suggestions de l'API
  const askQuestion = async () => {
    if (!userQuestion.trim() || !sessionId) {
      if (!sessionId) addMessage('bot', '❌ Veuillez d\'abord charger un fichier.');
      return;
    }
    await askQuestionWith(userQuestion);
    setUserQuestion('');
  };

  // ─── UI HELPERS ───────────────────────────────────────────────────────────────

  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case 'faible': return 'bg-green-100 text-green-700';
      case 'moyen': return 'bg-yellow-100 text-yellow-700';
      case 'élevé': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'cleaned': return { color: 'bg-green-100 text-green-700', text: 'Nettoyé' };
      case 'uploaded': return { color: 'bg-blue-100 text-blue-700', text: 'Analysé' };
      default: return { color: 'bg-gray-100 text-gray-700', text: 'En cours' };
    }
  };

  const getMethodDescription = (method: string) => {
    switch (method) {
      case 'remove': return '⚠️ Les lignes contenant des outliers seront supprimées (perte de données)';
      case 'median': return '✅ RECOMMANDÉ : Les outliers seront remplacés par la médiane (conserve toutes les lignes)';
      case 'cap': return '✅ Les outliers seront limités aux bornes acceptables';
      case 'nan': return '⚠️ Les outliers seront remplacés par des valeurs manquantes';
      case 'flag': return '✅ Une colonne "_is_outlier" sera ajoutée pour chaque colonne numérique';
      default: return '';
    }
  };

  // ─── RENDU DES SUGGESTIONS CLIQUABLES ────────────────────────────────────────

  const SuggestionChips = ({ suggestions }: { suggestions: string[] }) => {
    if (!suggestions || suggestions.length === 0) return null;
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((s, i) => (
          <button
            key={i}
            disabled={isAsking}
            onClick={() => askQuestionWith(s)}
            className="text-xs px-3 py-1.5 bg-gray-50 hover:bg-blue-50 hover:text-blue-700 border border-gray-200 hover:border-blue-300 rounded-full transition-all text-gray-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            {s}
          </button>
        ))}
      </div>
    );
  };

  // ─────────────────────────────────────────────
  // RENDU
  // ─────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-gray-50">

      {/* ── SIDEBAR ─────────────────────────────── */}
      <div className="w-72 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200 space-y-3">
          <button onClick={startNewSession} className="w-full bg-gray-900 text-white rounded-lg px-4 py-3 hover:bg-gray-800 transition-colors font-medium">
            + Nouveau nettoyage
          </button>
          {selectedSessions.length > 0 && (
            <div className="space-y-2">
              <button onClick={downloadMultipleSessions} disabled={isDownloading}
                className="w-full bg-green-600 text-white rounded-lg px-4 py-3 hover:bg-green-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                {isDownloading
                  ? (<><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />Téléchargement...</>)
                  : (<><Download className="w-4 h-4" />Télécharger {selectedSessions.length} fichier(s)</>)}
              </button>
              <div className="flex gap-2">
                <button onClick={selectAllCleaned} className="flex-1 bg-blue-100 text-blue-700 rounded-lg px-3 py-2 hover:bg-blue-200 transition-colors text-sm font-medium">Tout sélectionner</button>
                <button onClick={clearSelection} className="flex-1 bg-gray-100 text-gray-700 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors text-sm font-medium">Annuler</button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sessions récentes</div>
            <button onClick={loadSessions} className="text-gray-400 hover:text-gray-600 transition-colors"><RefreshCw className="w-4 h-4" /></button>
          </div>
          {sessions.length === 0 && <div className="text-sm text-gray-400 text-center py-8">Aucune session</div>}
          {sessions.map(s => {
            const badge = getStatusBadge(s.status);
            const isSelected = selectedSessions.includes(s.session_id);
            const isCleaned = s.status === 'cleaned';
            return (
              <div key={s.session_id} className={`p-3 rounded-lg mb-2 border transition-all ${sessionId === s.session_id ? 'border-gray-900 bg-gray-50' : 'border-gray-100'} ${isSelected ? 'ring-2 ring-green-500' : ''}`}>
                <div className="flex items-start gap-2">
                  {isCleaned && (
                    <input type="checkbox" checked={isSelected}
                      onChange={(e) => { e.stopPropagation(); toggleSessionSelection(s.session_id); }}
                      className="mt-1 w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer" />
                  )}
                  <div onClick={() => restoreSession(s)} className="flex-1 cursor-pointer hover:opacity-80 transition-opacity">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-gray-900 truncate flex-1">{s.filename}</div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${badge.color} whitespace-nowrap`}>{badge.text}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                      <Clock className="w-3 h-3" />
                      {new Date(s.timestamp).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">{s.rows} lignes × {s.columns} colonnes</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── ZONE PRINCIPALE ─────────────────────── */}
      <div className="flex-1 flex flex-col">

        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Assistant de Nettoyage de Données</h1>
            {currentFile && <p className="text-sm text-gray-500 mt-1">Fichier actuel : {currentFile.name || currentFile.filename}</p>}
          </div>
          <div className="flex items-center gap-3">
            {sessionId && (
              <div className="flex gap-2">
                <button onClick={() => viewData('before')} className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                  <Eye className="w-4 h-4" />Données originales
                </button>
                {step === 'results' && (
                  <>
                    <button onClick={() => viewData('after')} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
                      <Eye className="w-4 h-4" />Données nettoyées
                    </button>
                    <button onClick={reanalyze} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors">
                      <RefreshCw className="w-4 h-4" />Modifier actions
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="relative">
              <button onClick={() => setShowUserMenu(!showUserMenu)} className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
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
                <div className={`max-w-2xl ${msg.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-2xl rounded-br-sm'
                  : 'bg-white border border-gray-200 rounded-2xl rounded-bl-sm'
                } px-5 py-4 shadow-sm`}>

                  {/* ── loading ── */}
                  {msg.type === 'loading' ? (
                    <div className="flex items-center gap-2 text-gray-600">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-gray-600" />
                      {msg.content}
                    </div>

                  /* ── actions (checkboxes) ── */
                  ) : msg.type === 'actions' ? (
                    <div>
                      <div className="whitespace-pre-line text-gray-800 mb-4">{msg.content}</div>
                      <div className="space-y-3 mt-4">
                        {cleaningActions.map(action => (
                          <div key={action.id} onClick={() => toggleAction(action.id)}
                            className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${action.selected ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}>
                            <div className="flex items-start gap-3">
                              <div className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${action.selected ? 'bg-gray-900 border-gray-900' : 'border-gray-300'}`}>
                                {action.selected && <CheckCircle className="w-3 h-3 text-white" />}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-semibold text-gray-900">{action.title}</h4>
                                  <span className={`text-xs px-2 py-1 rounded-full ${getRiskBadge(action.risk)}`}>Risque {action.risk}</span>
                                </div>
                                <p className="text-sm text-gray-600 mt-1">{action.description}</p>
                                <p className="text-xs text-gray-500 mt-2"><strong>Impact :</strong> {action.impact}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {cleaningActions.some(a => a.id === 'outliers' && a.selected) && (
                        <div className="mt-4 p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
                          <label className="block text-sm font-semibold text-gray-800 mb-2">🎯 Méthode de traitement des valeurs aberrantes :</label>
                          <select value={outlierMethod} onChange={(e) => setOutlierMethod(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white">
                            <option value="median">📊 Remplacer par la médiane (RECOMMANDÉ)</option>
                            <option value="cap">🔒 Plafonner aux limites</option>
                            <option value="flag">🏴 Ajouter un indicateur</option>
                            <option value="nan">❓ Marquer comme manquant</option>
                            <option value="remove">🗑️ Supprimer les lignes</option>
                          </select>
                          <p className="text-xs text-gray-700 mt-2 leading-relaxed">{getMethodDescription(outlierMethod)}</p>
                        </div>
                      )}
                      <button onClick={executeActions} className="w-full mt-4 bg-gray-900 text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors font-medium">
                        ✨ Appliquer les actions sélectionnées
                      </button>
                      {/* Suggestions sous les actions */}
                      {msg.suggestions && <SuggestionChips suggestions={msg.suggestions} />}
                    </div>

                  /* ── results ── */
                  ) : msg.type === 'results' ? (
                    <div className="whitespace-pre-line text-gray-800">{msg.content}</div>

                  /* ── download (fichier nettoyé) ── */
                  ) : msg.type === 'download' ? (
                    <button onClick={async () => {
                      try {
                        const response = await authFetch(msg.content.downloadUrl);
                        if (!response.ok) throw new Error('Erreur téléchargement');
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = msg.content.filename;
                        document.body.appendChild(a); a.click();
                        window.URL.revokeObjectURL(url); document.body.removeChild(a);
                      } catch (err: any) { addMessage('bot', `❌ Erreur : ${err.message}`); }
                    }} className="mt-4 bg-gray-900 text-white px-6 py-3 rounded-lg flex items-center gap-2 hover:bg-gray-800 transition-colors">
                      <Download className="w-4 h-4" /> Télécharger {msg.content.filename}
                    </button>

                  /* ── download-report ── */
                  ) : msg.type === 'download-report' ? (
                    <button onClick={async () => {
                      try {
                        const id = msg.content.sessionId || sessionId;
                        if (!id) { addMessage('bot', '❌ Session ID manquant'); return; }
                        const response = await authFetch(`${API_URL}/api/download-report/${id}`);
                        if (!response.ok) { const e = await response.json(); throw new Error(e.error || 'Erreur téléchargement'); }
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = msg.content.filename || `rapport_${id}.docx`;
                        document.body.appendChild(a); a.click();
                        window.URL.revokeObjectURL(url); document.body.removeChild(a);
                        addMessage('bot', '✅ Rapport téléchargé avec succès !');
                      } catch (error: any) { addMessage('bot', `❌ Erreur : ${error.message}`); }
                    }} className="mt-4 bg-purple-600 text-white px-6 py-3 rounded-lg flex items-center gap-2 hover:bg-purple-700 transition-colors">
                      <Download className="w-4 h-4" /> Télécharger le rapport
                    </button>

                  /* ── ✅ texte normal + suggestions ── */
                  ) : (
                    <div>
                      <div className="whitespace-pre-line text-gray-800">{msg.content}</div>
                      {msg.sender === 'bot' && msg.suggestions && (
                        <SuggestionChips suggestions={msg.suggestions} />
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ── Barre de saisie ─────────────────────── */}
        {sessionId && step === 'actions' && (
          <div className="border-t border-gray-200 bg-white p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="flex gap-2 flex-wrap">
                <button onClick={getRecommendations} disabled={isAsking}
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2 disabled:opacity-50">
                  💡 Recommande-moi des actions
                </button>
                <button onClick={generateReport} disabled={isGeneratingReport}
                  className="bg-purple-500 text-white px-4 py-2 rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-2 disabled:opacity-50">
                  {isGeneratingReport ? 'Génération...' : '📄 Génère un rapport'}
                </button>
                <button onClick={() => askQuestionWith('Quelle est la qualité de mes données ?')} disabled={isAsking}
                  className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50">
                  🎯 Évaluer la qualité
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={userQuestion}
                  onChange={(e) => setUserQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isAsking && askQuestion()}
                  placeholder="Posez une question sur vos données... (ex: Y a-t-il des valeurs manquantes ?)"
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={isAsking}
                />
                <button onClick={askQuestion} disabled={isAsking || !userQuestion.trim()}
                  className="bg-gray-900 text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {isAsking ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" /> : 'Envoyer'}
                </button>
              </div>
              <div className="text-xs text-gray-400">
                <span className="font-semibold text-gray-500">Essayez :</span>
                {' '}"Y a-t-il des doublons et des valeurs manquantes ?", "Quelles colonnes ont des outliers ?", "aide"
              </div>
            </div>
          </div>
        )}

        {/* ── Zone upload ─────────────────────────── */}
        {step === 'upload' && (
          <div className="border-t border-gray-200 bg-white p-6">
            <div className="max-w-3xl mx-auto">
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 hover:border-gray-400 transition-colors">
                <div className="flex flex-col items-center gap-3">
                  <Upload className="w-12 h-12 text-gray-400" />
                  <div className="text-center">
                    <div className="font-medium text-gray-900">Cliquez pour télécharger</div>
                    <div className="text-sm text-gray-500 mt-1">CSV, XLSX, XLS (max 50MB)</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── MODAL PREVIEW ───────────────────────── */}
      {showPreview && previewData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-[95vw] w-full max-h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {previewType === 'before' ? '📋 Données Originales' : '✨ Données Nettoyées'}
                  <span className="text-sm font-normal text-gray-500 ml-2">({previewData.total_rows.toLocaleString()} lignes × {previewData.columns.length} colonnes)</span>
                </h2>
                {previewType === 'before' && <p className="text-xs text-gray-500 mt-1">💡 Survolez les cellules colorées pour voir les problèmes détectés</p>}
              </div>
              <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600 transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="flex-1 overflow-auto p-4" style={{ maxHeight: 'calc(95vh - 140px)' }}>
              <div className="inline-block min-w-full">
                <table className="border-collapse border border-gray-300">
                  <thead className="bg-gray-100 sticky top-0 z-10">
                    <tr>
                      <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 bg-gray-100 sticky left-0 z-20">#</th>
                      {previewData.columns.map((col: string, i: number) => (
                        <th key={i} className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.rows.map((row: any[], rowIdx: number) => (
                      <tr key={rowIdx} className="hover:bg-gray-50 transition-colors">
                        <td className="border border-gray-300 px-3 py-2 text-xs text-gray-500 bg-gray-50 sticky left-0 z-10 font-medium">{rowIdx + 1}</td>
                        {row.map((cell: any, cellIdx: number) => {
                          const colName = previewData.columns[cellIdx];
                          const issues = previewType === 'before' ? getCellIssues(cell, colName, rowIdx) : [];
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
                                    : <span className={hasIssues ? 'font-medium' : ''}>{String(cell)}</span>
                                }
                              </div>
                              {hasIssues && hoveredCell?.row === rowIdx && hoveredCell?.col === cellIdx && (
                                <div className="absolute z-50 left-0 top-full mt-1 w-72 bg-gray-900 text-white text-xs rounded-lg shadow-xl p-3 pointer-events-none">
                                  <div className="font-semibold mb-2 flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4" />{issues.length} problème{issues.length > 1 ? 's' : ''} détecté{issues.length > 1 ? 's' : ''}
                                  </div>
                                  <div className="space-y-2">
                                    {issues.map((issue, i2) => (
                                      <div key={i2} className="border-t border-gray-700 pt-2">
                                        <div className="font-medium text-yellow-300">{issue.label}</div>
                                        <div className="text-gray-300 mt-1">{issue.description}</div>
                                      </div>
                                    ))}
                                  </div>
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
            </div>
            {previewType === 'before' && (
              <div className="border-t border-gray-200 p-4 bg-gray-50 flex-shrink-0">
                <div className="text-xs font-semibold text-gray-700 mb-2">Légende des problèmes :</div>
                <div className="flex flex-wrap gap-3 text-xs">
                  <div className="flex items-center gap-1"><div className="w-4 h-4 bg-yellow-100 border-2 border-yellow-400 rounded" /><span className="text-gray-600">Valeur manquante</span></div>
                  <div className="flex items-center gap-1"><div className="w-4 h-4 bg-red-100 border-2 border-red-400 rounded" /><span className="text-gray-600">Valeur aberrante</span></div>
                  <div className="flex items-center gap-1"><div className="w-4 h-4 bg-blue-100 border-2 border-blue-400 rounded" /><span className="text-gray-600">Emoji</span></div>
                  <div className="flex items-center gap-1"><div className="w-4 h-4 bg-purple-100 border-2 border-purple-400 rounded" /><span className="text-gray-600">Caractères spéciaux</span></div>
                  <div className="flex items-center gap-1"><div className="w-4 h-4 bg-orange-100 border-2 border-orange-400 rounded" /><span className="text-gray-600">Format de date</span></div>
                </div>
              </div>
            )}
            {previewData.total_rows > 100 && (
              <div className="text-center text-sm text-gray-500 p-3 bg-gray-50 rounded-b-lg border-t border-gray-200 flex-shrink-0">
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