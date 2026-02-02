import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, CheckCircle, Eye, X, RefreshCw, Clock, LogOut, User } from 'lucide-react';

const DataCleaningAssistant = ({ user, onLogout }) => {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [currentFile, setCurrentFile] = useState(null);
  const [analysisData, setAnalysisData] = useState(null);
  const [cleaningActions, setCleaningActions] = useState([]);
  const [step, setStep] = useState('upload');
  const [sessions, setSessions] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewType, setPreviewType] = useState('before');
  const [isRestoring, setIsRestoring] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0 && !isRestoring) {
      addMessage('bot', `👋 Bonjour ${user?.name || 'Utilisateur'} ! Je suis votre assistant intelligent de qualité de données.\n\nTéléchargez un fichier CSV ou Excel pour commencer l'analyse 📊`);
    }
    loadSessions();
  }, []);

  const addMessage = (sender, content, type = 'text') => {
    setMessages(prev => [...prev, { sender, content, type, timestamp: new Date() }]);
  };

  const loadSessions = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/sessions');
      const data = await res.json();
      if (res.ok) {
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Erreur chargement sessions:', err);
    }
  };

  const restoreSession = async (sessionData) => {
    try {
      setIsRestoring(true);
      setMessages([]);

      addMessage('bot', `🔄 Restauration de la session "${sessionData.filename}"...`);

      // Récupérer les détails complets de la session
      const res = await fetch(`http://localhost:5000/api/session/${sessionData.session_id}`);

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

      // Si la session a déjà été nettoyée
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
      addMessage('bot', `❌ Erreur : ${err.message}`);
      setIsRestoring(false);
    }
  };

  const displayRestoredResults = (results) => {
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
    if (res.outliers_removed) summary += `• ${res.outliers_removed} valeurs aberrantes supprimées\n`;
    if (res.text_normalized) summary += `• ${res.text_normalized} textes normalisés\n`;

    summary += `\n💡 Vous pouvez télécharger le fichier nettoyé ou refaire l'analyse.`;

    addMessage('bot', summary, 'results');
    addMessage('bot', {
      downloadUrl: `http://localhost:5000/api/download/${sessionId}`,
      filename: results.cleaned_filename
    }, 'download');
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setCurrentFile(file);
    addMessage('user', `📄 ${file.name} (${(file.size/1024).toFixed(2)} KB)`);
    addMessage('bot', '🔍 Envoi du fichier au serveur et analyse en cours...', 'loading');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('http://localhost:5000/api/upload', { method: 'POST', body: formData });
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
      addMessage('bot', `❌ Erreur lors de l'envoi du fichier : ${err.message}`);
    }
  };

  const proposeActions = (analysis) => {
    if (!analysis) return;

    const missingCount = Object.values(analysis.missing_values || {}).reduce((a, b) => a + (b.count || 0), 0);
    const duplicates = analysis.duplicates || {};
    const outliers = Object.values(analysis.outliers || {}).reduce((a, b) => a + b, 0);

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

    const actions = [
      { id: 'duplicates',title: 'Supprimer les doublons',description: `${duplicates.exact_duplicates || 0} exacts + ${duplicates.structural_duplicates || 0} structurels détectés`,impact: `${(duplicates.exact_duplicates || 0) + (duplicates.structural_duplicates || 0)} lignes supprimées`
, selected: false, risk: 'faible'  },
      { id: 'missing_values', title: 'Corriger les valeurs manquantes', description: `${missingCount} valeurs manquantes détectées.`, impact: `${missingCount} cellules corrigées`, selected: false, risk: 'moyen' },
      { id: 'outliers', title: 'Traiter les valeurs aberrantes', description: `${outliers} valeurs extrêmes détectées.`, impact: `${outliers} lignes supprimées`, selected: false, risk: 'élevé' },
      { id: 'text_cleaning', title: 'Normaliser les textes', description: 'Suppression des emojis, caractères spéciaux et espaces inutiles.', impact: `${textCorrections} corrections`, selected: false, risk: 'faible' },
      { id: 'date_format', title: 'Harmoniser les dates', description: `${dateFormatsCount} formats différents détectés.`, impact: 'Toutes les dates harmonisées', selected: false, risk: 'faible' },
      { id: 'case_normalization', title: 'Uniformiser la casse', description: `${inconsistentCase} cellules avec des casses différentes.`, impact: `${inconsistentCase} corrections`, selected: false, risk: 'faible' }
    ];

    setCleaningActions(actions);
    addMessage('bot', `🎯 Actions recommandées : ${actions.length} types de corrections possibles.`, 'actions');
  };

  const toggleAction = (actionId) => {
    setCleaningActions(prev => prev.map(a => a.id === actionId ? { ...a, selected: !a.selected } : a));
  };

  const executeActions = async () => {
    const selected = cleaningActions.filter(a => a.selected).map(a => a.id);
    if (selected.length === 0) {
      addMessage('bot', '⚠️ Aucune action sélectionnée.');
      return;
    }

    addMessage('user', `✅ Actions sélectionnées : ${selected.join(', ')}`);
    addMessage('bot', '🔧 Nettoyage en cours...', 'loading');

    try {
      const res = await fetch('http://localhost:5000/api/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, actions: selected })
      });
      const data = await res.json();
      setMessages(prev => prev.filter(m => m.type !== 'loading'));

      if (res.ok) {
        displayResults(data.results, data.download_filename);
        loadSessions(); // Rafraîchir la liste des sessions
      } else {
        addMessage('bot', `❌ Erreur : ${data.error || 'Nettoyage impossible'}`);
      }
    } catch (err) {
      setMessages(prev => prev.filter(m => m.type !== 'loading'));
      addMessage('bot', `❌ Erreur : ${err.message}`);
    }
  };

  const displayResults = (results, downloadFilename) => {
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
    if (results.outliers_removed) summary += `• ${results.outliers_removed} valeurs aberrantes supprimées\n`;
    if (results.text_normalized) summary += `• ${results.text_normalized} textes normalisés\n`;

    summary += `\n💾 Vos données nettoyées sont prêtes au téléchargement !`;

    addMessage('bot', summary, 'results');
    addMessage('bot', { downloadUrl: `http://localhost:5000/api/download/${sessionId}`, filename: downloadFilename }, 'download');
  };

  const viewData = async (type = 'before') => {
    if (!sessionId) {
      addMessage('bot', '⚠️ Aucune session active.');
      return;
    }

    if (type === 'after' && step !== 'results') {
      addMessage('bot', '⚠️ Vous devez d\'abord nettoyer les données.');
      return;
    }

    const endpoint = type === 'before'
      ? `http://localhost:5000/api/preview/${sessionId}`
      : `http://localhost:5000/api/preview-cleaned/${sessionId}`;

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
      addMessage('bot', `❌ Erreur de connexion : ${err.message}`);
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
    addMessage('bot', `👋 Nouvelle session démarrée ${user?.name ? `${user.name}` : ''} ! Téléchargez votre fichier.`);
  };

  const reanalyze = () => {
    if (!analysisData) return;
    setStep('actions');
    setMessages(prev => prev.filter(m => m.type !== 'results' && m.type !== 'download'));
    proposeActions(analysisData);
    addMessage('bot', '🔄 Vous pouvez maintenant modifier les actions et relancer le nettoyage.');
  };

  const getRiskBadge = (risk) => {
    switch (risk) {
      case 'faible': return 'bg-green-100 text-green-700';
      case 'moyen': return 'bg-yellow-100 text-yellow-700';
      case 'élevé': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'cleaned': return { color: 'bg-green-100 text-green-700', text: 'Nettoyé' };
      case 'uploaded': return { color: 'bg-blue-100 text-blue-700', text: 'Analysé' };
      default: return { color: 'bg-gray-100 text-gray-700', text: 'En cours' };
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-72 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <button onClick={startNewSession} className="w-full bg-gray-900 text-white rounded-lg px-4 py-3 hover:bg-gray-800 transition-colors">
            + Nouveau nettoyage
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Sessions récentes</div>
            <button onClick={loadSessions} className="text-gray-400 hover:text-gray-600 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {sessions.length === 0 && <div className="text-sm text-gray-400 text-center py-8">Aucune session</div>}
          {sessions.map(s => {
            const badge = getStatusBadge(s.status);
            return (
              <div
                key={s.session_id}
                onClick={() => restoreSession(s)}
                className={`p-3 rounded-lg mb-2 cursor-pointer hover:bg-gray-50 border transition-all ${
                  sessionId === s.session_id ? 'border-gray-900 bg-gray-50' : 'border-gray-100'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium text-gray-900 truncate flex-1">{s.filename}</div>
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
                <div className="text-xs text-gray-400 mt-1">{s.rows} lignes × {s.columns} colonnes</div>
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
                <div className={`max-w-2xl ${msg.sender === 'user' ? 'bg-gray-900 text-white rounded-2xl rounded-br-sm' : 'bg-white border border-gray-200 rounded-2xl rounded-bl-sm'} px-5 py-4 shadow-sm`}>
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
                      <button onClick={executeActions} className="w-full mt-4 bg-gray-900 text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors">
                        ✨ Appliquer les actions
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

      {/* Preview Modal avec barre de défilement */}
      {showPreview && previewData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-[95vw] w-full max-h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-900">
                {previewType === 'before' ? '📋 Données Originales' : '✨ Données Nettoyées'}
                <span className="text-sm font-normal text-gray-500 ml-2">
                  ({previewData.total_rows.toLocaleString()} lignes × {previewData.columns.length} colonnes)
                </span>
              </h2>
              <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Container avec scroll horizontal ET vertical */}
            <div className="flex-1 overflow-auto p-4" style={{ maxHeight: 'calc(95vh - 140px)' }}>
              <div className="inline-block min-w-full">
                <table className="border-collapse border border-gray-300">
                  <thead className="bg-gray-100 sticky top-0 z-10">
                    <tr>
                      <th className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 bg-gray-100 sticky left-0 z-20">
                        #
                      </th>
                      {previewData.columns.map((col, i) => (
                        <th key={i} className="border border-gray-300 px-3 py-2 text-left text-xs font-semibold text-gray-700 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.rows.map((row, rowIdx) => (
                      <tr key={rowIdx} className="hover:bg-gray-50 transition-colors">
                        <td className="border border-gray-300 px-3 py-2 text-xs text-gray-500 bg-gray-50 sticky left-0 z-10 font-medium">
                          {rowIdx + 1}
                        </td>
                        {row.map((cell, cellIdx) => (
                          <td key={cellIdx} className="border border-gray-300 px-3 py-2 text-sm text-gray-800 whitespace-nowrap">
                            {cell === null || cell === undefined || cell === '' ? (
                              <span className="text-gray-400 italic text-xs">∅ vide</span>
                            ) : typeof cell === 'number' ? (
                              <span className="text-blue-700 font-mono">{cell}</span>
                            ) : (
                              String(cell)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

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