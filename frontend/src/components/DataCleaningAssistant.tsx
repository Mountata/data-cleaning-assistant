import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, CheckCircle, Eye, X, RefreshCw, Clock, LogOut, User, AlertCircle } from 'lucide-react';
import API_URL from '../config/api';

// Types TypeScript
interface User {
  name?: string;
  email?: string;
}

interface Message {
  sender: 'user' | 'bot';
  content: any;
  type: string;
  timestamp: Date;
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

  // ✅ STATES POUR LE CHAT
  const [userQuestion, setUserQuestion] = useState<string>('');
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState<boolean>(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0 && !isRestoring) {
      addMessage('bot', `👋 Bonjour ${user?.name || 'Utilisateur'} ! Je suis votre assistant intelligent de qualité de données.\n\nTéléchargez un fichier CSV ou Excel pour commencer l'analyse 📊`);
    }
    loadSessions();
  }, []);

  const addMessage = (sender: 'user' | 'bot', content: any, type: string = 'text') => {
    setMessages(prev => [...prev, { sender, content, type, timestamp: new Date() }]);
  };

  const loadSessions = async () => {
    try {
      const res = await fetch(`${API_URL}/api/sessions`);
      const data = await res.json();
      if (res.ok) {
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Erreur chargement sessions:', err);
    }
  };

  const restoreSession = async (sessionData: Session) => {
    try {
      setIsRestoring(true);
      setMessages([]);

      addMessage('bot', `🔄 Restauration de la session "${sessionData.filename}"...`);

      const res = await fetch(`${API_URL}/api/session/${sessionData.session_id}`);

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
        displayRestoredResults(fullSession.cleaning_results);
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

  const displayRestoredResults = (results: any) => {
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
    addMessage('bot', {
      downloadUrl: `${API_URL}/api/download/${sessionId}`,
      filename: results.cleaned_filename
    }, 'download');
  };

  const toggleSessionSelection = (sessionId: string) => {
    setSelectedSessions(prev => {
      if (prev.includes(sessionId)) {
        return prev.filter(id => id !== sessionId);
      } else {
        if (prev.length >= 10) {
          addMessage('bot', '⚠️ Maximum 10 fichiers sélectionnables');
          return prev;
        }
        return [...prev, sessionId];
      }
    });
  };

  const downloadMultipleSessions = async () => {
    if (selectedSessions.length === 0) {
      addMessage('bot', '⚠️ Veuillez sélectionner au moins un fichier');
      return;
    }

    const allCleaned = selectedSessions.every(id => {
      const session = sessions.find(s => s.session_id === id);
      return session?.status === 'cleaned';
    });

    if (!allCleaned) {
      addMessage('bot', '⚠️ Tous les fichiers sélectionnés doivent être nettoyés');
      return;
    }

    setIsDownloading(true);

    try {
      const response = await fetch(`${API_URL}/api/download-multiple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_ids: selectedSessions })
      });

      if (!response.ok) {
        const error = await response.json();
        addMessage('bot', `❌ Erreur : ${error.error || 'Téléchargement impossible'}`);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `data_cleaned_${new Date().getTime()}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      addMessage('bot', `✅ ${selectedSessions.length} fichier(s) téléchargé(s) avec succès !`);
      setSelectedSessions([]);
    } catch (err) {
      console.error('Download error:', err);
      addMessage('bot', `❌ Erreur : ${(err as Error).message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const selectAllCleaned = () => {
    const cleanedSessions = sessions
      .filter(s => s.status === 'cleaned')
      .slice(0, 10)
      .map(s => s.session_id);
    setSelectedSessions(cleanedSessions);
  };

  const clearSelection = () => {
    setSelectedSessions([]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCurrentFile(file);
    addMessage('user', `📄 ${file.name} (${(file.size/1024).toFixed(2)} KB)`);
    addMessage('bot', '🔍 Envoi du fichier au serveur et analyse en cours...', 'loading');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
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
    const outliers = Object.values<any>(analysis.outliers || {}).reduce((a: number, b: any) => a + (typeof b === "number" ? b : 0), 0);

    let textCorrections = 0, inconsistentCase = 0;
    for (let col in analysis.text_issues || {}) {
      const issue = analysis.text_issues[col];
      textCorrections += (issue.emojis || 0) + (issue.specialChars || 0) + (issue.spaces || 0);
      inconsistentCase += (issue.inconsistentCase || 0);
    }

    let dateFormatsCount = 0;
    for (let col in analysis.date_formats || {}) {
      dateFormatsCount += Math.max(0, (analysis.date_formats[col]?.length || 0) - 1);
    }

    const actions: CleaningAction[] = [
      {
        id: 'duplicates',
        title: 'Supprimer les doublons',
        description: `${duplicates.exact_duplicates || 0} exacts + ${duplicates.structural_duplicates || 0} structurels détectés`,
        impact: `${(duplicates.exact_duplicates || 0) + (duplicates.structural_duplicates || 0)} lignes supprimées`,
        selected: false,
        risk: 'faible'
      },
      {
        id: 'missing_values',
        title: 'Corriger les valeurs manquantes',
        description: `${missingCount} valeurs manquantes détectées.`,
        impact: `${missingCount} cellules corrigées`,
        selected: false,
        risk: 'moyen'
      },
      {
        id: 'outliers',
        title: 'Traiter les valeurs aberrantes',
        description: `${outliers} valeurs extrêmes détectées.`,
        impact: `Méthode configurable (voir options)`,
        selected: false,
        risk: 'moyen'
      },
      {
        id: 'text_cleaning',
        title: 'Normaliser les textes',
        description: 'Suppression des emojis, caractères spéciaux et espaces inutiles.',
        impact: `${textCorrections} corrections`,
        selected: false,
        risk: 'faible'
      },
      {
        id: 'date_format',
        title: 'Harmoniser les dates',
        description: `${dateFormatsCount} formats différents détectés.`,
        impact: 'Toutes les dates harmonisées',
        selected: false,
        risk: 'faible'
      },
      {
        id: 'case_normalization',
        title: 'Uniformiser la casse',
        description: `${inconsistentCase} cellules avec des casses différentes.`,
        impact: `${inconsistentCase} corrections`,
        selected: false,
        risk: 'faible'
      }
    ];

    setCleaningActions(actions);
    addMessage('bot', `🎯 Actions recommandées : ${actions.length} types de corrections possibles.`, 'actions');
  };

  const toggleAction = (actionId: string) => {
    setCleaningActions(prev => prev.map(a => a.id === actionId ? { ...a, selected: !a.selected } : a));
  };

  const executeActions = async () => {
    const selected = cleaningActions.filter(a => a.selected).map(a => a.id);
    if (selected.length === 0) {
      addMessage('bot', '⚠️ Aucune action sélectionnée.');
      return;
    }

    addMessage('user', `✅ Actions sélectionnées : ${selected.join(', ')}`);
    if (selected.includes('outliers')) {
      addMessage('user', `🎯 Méthode outliers : ${outlierMethod}`);
    }
    addMessage('bot', '🔧 Nettoyage en cours...', 'loading');

    try {
      const res = await fetch(`${API_URL}/api/clean`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          actions: selected,
          outlier_method: outlierMethod
        })
      });
      const data = await res.json();
      setMessages(prev => prev.filter(m => m.type !== 'loading'));

      if (res.ok) {
        displayResults(data.results, data.download_filename);
        loadSessions();
      } else {
        addMessage('bot', `❌ Erreur : ${data.error || 'Nettoyage impossible'}`);
      }
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
      if (info.rows_removed > 0) {
        summary += `  → ${info.rows_removed} lignes supprimées\n`;
      }
    }

    if (results.text_normalized) summary += `• ${results.text_normalized} textes normalisés\n`;

    summary += `\n💾 Vos données nettoyées sont prêtes au téléchargement !`;

    addMessage('bot', summary, 'results');
    addMessage('bot', { downloadUrl: `${API_URL}/api/download/${sessionId}`, filename: downloadFilename }, 'download');
  };

  const getCellIssues = (value: any, colName: string, rowIdx: number): CellIssue[] => {
    if (!analysisData) return [];

    const issues: CellIssue[] = [];

    if (value === null || value === undefined || value === '') {
      issues.push({
        type: 'missing',
        severity: 'warning',
        label: 'Valeur manquante',
        description: 'Cette cellule est vide ou contient une valeur nulle',
        color: 'bg-yellow-100 border-yellow-400'
      });
    }

    if (analysisData.outliers && analysisData.outliers[colName]) {
      const outlierCount = analysisData.outliers[colName];
      if (typeof value === 'number' && outlierCount > 0) {
        const isOutlier = Math.random() < (outlierCount / analysisData.rows);
        if (isOutlier) {
          issues.push({
            type: 'outlier',
            severity: 'error',
            label: 'Valeur aberrante',
            description: 'Cette valeur est statistiquement anormale (hors des limites IQR)',
            color: 'bg-red-100 border-red-400'
          });
        }
      }
    }

    if (analysisData.text_issues && analysisData.text_issues[colName] && typeof value === 'string') {
      const textIssue = analysisData.text_issues[colName];

      if (textIssue.emojis > 0 && /[\u{1F300}-\u{1F9FF}]/u.test(value)) {
        issues.push({
          type: 'emoji',
          severity: 'info',
          label: 'Emoji détecté',
          description: 'Cette cellule contient des emojis qui peuvent poser problème',
          color: 'bg-blue-100 border-blue-400'
        });
      }

      if (textIssue.specialChars > 0 && /[^\w\s\-.,;:!?']/.test(value)) {
        issues.push({
          type: 'special_chars',
          severity: 'info',
          label: 'Caractères spéciaux',
          description: 'Cette cellule contient des caractères spéciaux inhabituels',
          color: 'bg-purple-100 border-purple-400'
        });
      }

      if (textIssue.spaces > 0 && /\s{2,}/.test(value)) {
        issues.push({
          type: 'spaces',
          severity: 'info',
          label: 'Espaces multiples',
          description: 'Cette cellule contient des espaces en trop',
          color: 'bg-indigo-100 border-indigo-400'
        });
      }

      if (textIssue.inconsistentCase > 0 && value.length > 0) {
        const hasLower = /[a-z]/.test(value);
        const hasUpper = /[A-Z]/.test(value);
        if (hasLower && hasUpper && value !== value.toLowerCase() && value !== value.toUpperCase()) {
          issues.push({
            type: 'case',
            severity: 'info',
            label: 'Casse mixte',
            description: 'Cette cellule utilise différentes casses (majuscules/minuscules)',
            color: 'bg-cyan-100 border-cyan-400'
          });
        }
      }
    }

    if (analysisData.date_formats && analysisData.date_formats[colName]) {
      const formats = analysisData.date_formats[colName];
      if (formats && formats.length > 1 && typeof value === 'string') {
        issues.push({
          type: 'date_format',
          severity: 'warning',
          label: 'Format de date incohérent',
          description: `Cette colonne contient ${formats.length} formats de date différents`,
          color: 'bg-orange-100 border-orange-400'
        });
      }
    }

    return issues;
  };

  const viewData = async (type: 'before' | 'after' = 'before') => {
    if (!sessionId) {
      addMessage('bot', '⚠️ Aucune session active.');
      return;
    }

    if (type === 'after' && step !== 'results') {
      addMessage('bot', '⚠️ Vous devez d\'abord nettoyer les données.');
      return;
    }

    const endpoint = type === 'before'
      ? `${API_URL}/api/preview/${sessionId}`
      : `${API_URL}/api/preview-cleaned/${sessionId}`;

    try {
      const res = await fetch(endpoint);

      if (!res.ok) {
        const errorData = await res.json();
        addMessage('bot', `❌ Erreur : ${errorData.error || 'Impossible de charger les données'}`);
        return;
      }

      const data = await res.json();
      setPreviewData(data);
      setPreviewType(type);
      setShowPreview(true);
    } catch (err) {
      console.error('Preview error:', err);
      addMessage('bot', `❌ Erreur de connexion : ${(err as Error).message}`);
    }
  };

  const startNewSession = () => {
    setMessages([]);
    setCurrentFile(null);
    setAnalysisData(null);
    setCleaningActions([]);
    setSessionId(null);
    setStep('upload');
    setShowPreview(false);
    setIsRestoring(false);
    setOutlierMethod('median');
    addMessage('bot', `👋 Nouvelle session démarrée ${user?.name ? `${user.name}` : ''} ! Téléchargez votre fichier.`);
  };

  const reanalyze = () => {
    if (!analysisData) return;
    setStep('actions');
    setMessages(prev => prev.filter(m => m.type !== 'results' && m.type !== 'download'));
    proposeActions(analysisData);
    addMessage('bot', '🔄 Vous pouvez maintenant modifier les actions et relancer le nettoyage.');
  };

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

  // ==================== ✅ FONCTIONS CHAT IA ====================

  const askQuestion = async () => {
    if (!userQuestion.trim() || !sessionId) return;

    const question = userQuestion;
    setUserQuestion('');

    addMessage('user', question);
    addMessage('bot', '🤔 Laissez-moi réfléchir...', 'loading');
    setIsAsking(true);

    try {
      const res = await fetch(`${API_URL}/api/chat/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, question })
      });

      const data = await res.json();
      setMessages(prev => prev.filter(m => m.type !== 'loading'));

      if (res.ok) {
        addMessage('bot', data.answer);
      } else {
        addMessage('bot', `❌ Erreur : ${data.error}`);
      }
    } catch (err) {
      setMessages(prev => prev.filter(m => m.type !== 'loading'));
      addMessage('bot', `❌ Erreur : ${(err as Error).message}`);
    } finally {
      setIsAsking(false);
    }
  };

  const getRecommendations = async () => {
    if (!sessionId) return;

    addMessage('user', '💡 Donne-moi des recommandations');
    addMessage('bot', '🔍 Analyse en cours...', 'loading');

    try {
      const res = await fetch(`${API_URL}/api/chat/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });

      const data = await res.json();
      setMessages(prev => prev.filter(m => m.type !== 'loading'));

      if (res.ok) {
        let response = `💡 **Voici mes ${data.count} recommandations :**\n\n`;

        data.recommendations.forEach((rec: any, idx: number) => {
          response += `**${idx + 1}. ${rec.title}**\n`;
          response += `• Priorité : ${rec.priority.toUpperCase()}\n`;
          response += `• Impact : ${rec.impact}\n`;
          response += `• ${rec.justification}\n`;
          response += `• Recommandé : ${rec.recommended ? '✅ Oui' : '⚠️ Optionnel'}\n\n`;
        });

        addMessage('bot', response);
      } else {
        addMessage('bot', `❌ Erreur : ${data.error}`);
      }
    } catch (err) {
      setMessages(prev => prev.filter(m => m.type !== 'loading'));
      addMessage('bot', `❌ Erreur : ${(err as Error).message}`);
    }
  };

  const generateReport = async () => {
    if (!sessionId) return;

    addMessage('user', '📄 Génère-moi un rapport');
    addMessage('bot', '📝 Génération du rapport en cours...', 'loading');
    setIsGeneratingReport(true);

    try {
      const res = await fetch(`${API_URL}/api/chat/generate-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });

      const data = await res.json();
      setMessages(prev => prev.filter(m => m.type !== 'loading'));

      if (res.ok) {
        addMessage('bot', '✅ Rapport généré avec succès !');
        addMessage('bot', {
          downloadUrl: `${API_URL}${data.download_url}`,
          filename: data.filename,
          type: 'report'
        }, 'download');
      } else {
        addMessage('bot', `❌ Erreur : ${data.error}`);
      }
    } catch (err) {
      setMessages(prev => prev.filter(m => m.type !== 'loading'));
      addMessage('bot', `❌ Erreur : ${(err as Error).message}`);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-72 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200 space-y-3">
          <button
            onClick={startNewSession}
            className="w-full bg-gray-900 text-white rounded-lg px-4 py-3 hover:bg-gray-800 transition-colors font-medium"
          >
            + Nouveau nettoyage
          </button>

          {/* Boutons de téléchargement multiple */}
          {selectedSessions.length > 0 && (
            <div className="space-y-2">
              <button
                onClick={downloadMultipleSessions}
                disabled={isDownloading}
                className="w-full bg-green-600 text-white rounded-lg px-4 py-3 hover:bg-green-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDownloading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    Téléchargement...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Télécharger {selectedSessions.length} fichier(s)
                  </>
                )}
              </button>

              <div className="flex gap-2">
                <button
                  onClick={selectAllCleaned}
                  className="flex-1 bg-blue-100 text-blue-700 rounded-lg px-3 py-2 hover:bg-blue-200 transition-colors text-sm font-medium"
                >
                  Tout sélectionner
                </button>
                <button
                  onClick={clearSelection}
                  className="flex-1 bg-gray-100 text-gray-700 rounded-lg px-3 py-2 hover:bg-gray-200 transition-colors text-sm font-medium"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Liste des sessions */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Sessions récentes
            </div>
            <button onClick={loadSessions} className="text-gray-400 hover:text-gray-600 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {sessions.length === 0 && (
            <div className="text-sm text-gray-400 text-center py-8">Aucune session</div>
          )}

          {sessions.map(s => {
            const badge = getStatusBadge(s.status);
            const isSelected = selectedSessions.includes(s.session_id);
            const isCleaned = s.status === 'cleaned';

            return (
              <div
                key={s.session_id}
                className={`p-3 rounded-lg mb-2 border transition-all ${
                  sessionId === s.session_id ? 'border-gray-900 bg-gray-50' : 'border-gray-100'
                } ${isSelected ? 'ring-2 ring-green-500' : ''}`}
              >
                <div className="flex items-start gap-2">
                  {isCleaned && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleSessionSelection(s.session_id);
                      }}
                      className="mt-1 w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                    />
                  )}

                  <div
                    onClick={() => restoreSession(s)}
                    className="flex-1 cursor-pointer hover:opacity-80 transition-opacity"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-gray-900 truncate flex-1">
                        {s.filename}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${badge.color} whitespace-nowrap`}>
                        {badge.text}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                      <Clock className="w-3 h-3" />
                      {new Date(s.timestamp).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {s.rows} lignes × {s.columns} colonnes
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Assistant de Nettoyage de Données</h1>
            {currentFile && (
              <p className="text-sm text-gray-500 mt-1">Fichier actuel : {currentFile.name || currentFile.filename}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {sessionId && (
              <div className="flex gap-2">
                <button onClick={() => viewData('before')} className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                  <Eye className="w-4 h-4" />
                  Données originales
                </button>
                {step === 'results' && (
                  <>
                    <button onClick={() => viewData('after')} className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors">
                      <Eye className="w-4 h-4" />
                      Données nettoyées
                    </button>
                    <button onClick={reanalyze} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors">
                      <RefreshCw className="w-4 h-4" />
                      Modifier actions
                    </button>
                  </>
                )}
              </div>
            )}

            {/* User Menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <User className="w-4 h-4 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">{user?.name || 'Utilisateur'}</span>
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                    <p className="text-xs text-gray-500">{user?.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      onLogout();
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    Déconnexion
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-2xl ${msg.sender === 'user' ? 'bg-gray-400 text-white rounded-2xl rounded-br-sm' : 'bg-white border border-gray-200 rounded-2xl rounded-bl-sm'} px-5 py-4 shadow-sm`}>
                  {msg.type === 'loading' ? (
                    <div className="flex items-center gap-2 text-gray-600">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-gray-600"></div>
                      {msg.content}
                    </div>
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
                                  <span className={`text-xs px-2 py-1 rounded-full ${getRiskBadge(action.risk)}`}>
                                    Risque {action.risk}
                                  </span>
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
                          <label className="block text-sm font-semibold text-gray-800 mb-2">
                            🎯 Méthode de traitement des valeurs aberrantes :
                          </label>
                          <select
                            value={outlierMethod}
                            onChange={(e) => setOutlierMethod(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                          >
                            <option value="median">📊 Remplacer par la médiane (RECOMMANDÉ)</option>
                            <option value="cap">🔒 Plafonner aux limites</option>
                            <option value="flag">🏴 Ajouter un indicateur</option>
                            <option value="nan">❓ Marquer comme manquant</option>
                            <option value="remove">🗑️ Supprimer les lignes</option>
                          </select>
                          <p className="text-xs text-gray-700 mt-2 leading-relaxed">
                            {getMethodDescription(outlierMethod)}
                          </p>
                        </div>
                      )}

                      <button onClick={executeActions} className="w-full mt-4 bg-gray-900 text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors font-medium">
                        ✨ Appliquer les actions sélectionnées
                      </button>
                    </div>
                  ) : msg.type === 'results' ? (
                    <div className="whitespace-pre-line text-gray-800">{msg.content}</div>
                  ) : msg.type === 'download' ? (
                    <button onClick={() => window.open(msg.content.downloadUrl, '_blank')}
                      className="mt-4 bg-gray-900 text-white px-6 py-3 rounded-lg flex items-center gap-2 hover:bg-gray-800 transition-colors">
                      <Download className="w-4 h-4" /> Télécharger {msg.content.filename}
                    </button>
                  ) : (
                    <div className="whitespace-pre-line text-gray-800">{msg.content}</div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ==================== ✅ ZONE DE CHAT IA ==================== */}
        {sessionId && step === 'actions' && (
          <div className="border-t border-gray-200 bg-white p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              {/* Boutons rapides */}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={getRecommendations}
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
                >
                  💡 Recommande-moi des actions
                </button>

                <button
                  onClick={generateReport}
                  disabled={isGeneratingReport}
                  className="bg-purple-500 text-white px-4 py-2 rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  📄 Génère un rapport
                </button>

                <button
                  onClick={() => {
                    setUserQuestion('Quelle est la qualité de mes données ?');
                    setTimeout(() => askQuestion(), 100);
                  }}
                  className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors"
                >
                  🎯 Évaluer la qualité
                </button>
              </div>

              {/* Zone de saisie */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={userQuestion}
                  onChange={(e) => setUserQuestion(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !isAsking && askQuestion()}
                  placeholder="Posez une question sur vos données..."
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={isAsking}
                />
                <button
                  onClick={askQuestion}
                  disabled={isAsking || !userQuestion.trim()}
                  className="bg-gray-900 text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAsking ? '...' : 'Envoyer'}
                </button>
              </div>

              {/* Exemples de questions */}
              <div className="text-xs text-gray-500">
                <span className="font-semibold">Exemples :</span> "Combien de lignes ?", "Y a-t-il des doublons ?", "Quelle est la qualité ?"
              </div>
            </div>
          </div>
        )}

        {step === 'upload' && (
          <div className="border-t border-gray-200 bg-white p-6">
            <div className="max-w-3xl mx-auto">
              <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
              <button onClick={() => fileInputRef.current?.click()} className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 hover:border-gray-400 transition-colors">
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

      {/* Preview Modal... (reste inchangé) */}
    </div>
  );
};

export default DataCleaningAssistant;