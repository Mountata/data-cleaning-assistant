import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  Modal,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Dimensions
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import * as DocumentPicker from 'expo-document-picker';

const { width, height } = Dimensions.get('window');

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
  const [showSidebar, setShowSidebar] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scrollViewRef = useRef(null);

  useEffect(() => {
    if (messages.length === 0 && !isRestoring) {
      addMessage('bot', `👋 Bonjour ${user?.name || 'Utilisateur'} ! Je suis votre assistant intelligent de qualité de données.\n\nTéléchargez un fichier CSV ou Excel pour commencer l'analyse 📊`);
    }
    loadSessions();
  }, []);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

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

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  };

  const restoreSession = async (sessionData) => {
    setShowSidebar(false);
    try {
      setIsRestoring(true);
      setMessages([]);

      addMessage('bot', `🔄 Restauration de la session "${sessionData.filename}"...`);

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

  const handleFileUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        copyToCacheDirectory: true,
      });

      if (result.type === 'cancel') {
        return;
      }

      const file = result;
      setCurrentFile(file);
      addMessage('user', `📄 ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
      addMessage('bot', '🔍 Envoi du fichier au serveur et analyse en cours...', 'loading');

      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        type: file.mimeType || 'application/octet-stream',
        name: file.name,
      });

      const res = await fetch('http://localhost:5000/api/upload', {
        method: 'POST',
        body: formData,
      });
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
        impact: `${outliers} lignes supprimées`,
        selected: false,
        risk: 'élevé'
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

  const toggleAction = (actionId) => {
    setCleaningActions(prev =>
      prev.map(a => (a.id === actionId ? { ...a, selected: !a.selected } : a))
    );
  };

  const executeActions = async () => {
    const selected = cleaningActions.filter(a => a.selected).map(a => a.id);
    if (selected.length === 0) {
      Alert.alert('Attention', 'Aucune action sélectionnée.');
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
        loadSessions();
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
    addMessage('bot', {
      downloadUrl: `http://localhost:5000/api/download/${sessionId}`,
      filename: downloadFilename
    }, 'download');
  };

  const viewData = async (type = 'before') => {
    if (!sessionId) {
      Alert.alert('Attention', 'Aucune session active.');
      return;
    }

    if (type === 'after' && step !== 'results') {
      Alert.alert('Attention', 'Vous devez d\'abord nettoyer les données.');
      return;
    }

    const endpoint = type === 'before'
      ? `http://localhost:5000/api/preview/${sessionId}`
      : `http://localhost:5000/api/preview-cleaned/${sessionId}`;

    try {
      const res = await fetch(endpoint);

      if (!res.ok) {
        const errorData = await res.json();
        Alert.alert('Erreur', errorData.error || 'Impossible de charger les données');
        return;
      }

      const data = await res.json();
      setPreviewData(data);
      setPreviewType(type);
      setShowPreview(true);
    } catch (err) {
      console.error('Preview error:', err);
      Alert.alert('Erreur', `Erreur de connexion : ${err.message}`);
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

  const getRiskBadgeStyle = (risk) => {
    switch (risk) {
      case 'faible':
        return { backgroundColor: '#D1FAE5', color: '#065F46' };
      case 'moyen':
        return { backgroundColor: '#FEF3C7', color: '#92400E' };
      case 'élevé':
        return { backgroundColor: '#FEE2E2', color: '#991B1B' };
      default:
        return { backgroundColor: '#F3F4F6', color: '#374151' };
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'cleaned':
        return { color: '#D1FAE5', textColor: '#065F46', text: 'Nettoyé' };
      case 'uploaded':
        return { color: '#DBEAFE', textColor: '#1E40AF', text: 'Analysé' };
      default:
        return { color: '#F3F4F6', textColor: '#374151', text: 'En cours' };
    }
  };

  const renderMessage = ({ item }) => {
    const isUser = item.sender === 'user';

    return (
      <View style={[styles.messageContainer, isUser && styles.userMessageContainer]}>
        <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.botBubble]}>
          {item.type === 'loading' ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#6B7280" size="small" />
              <Text style={styles.loadingText}>{item.content}</Text>
            </View>
          ) : item.type === 'actions' ? (
            <View>
              <Text style={styles.messageText}>{item.content}</Text>
              <View style={styles.actionsContainer}>
                {cleaningActions.map(action => (
                  <TouchableOpacity
                    key={action.id}
                    onPress={() => toggleAction(action.id)}
                    style={[
                      styles.actionCard,
                      action.selected && styles.actionCardSelected
                    ]}
                  >
                    <View style={styles.actionHeader}>
                      <View style={[
                        styles.checkbox,
                        action.selected && styles.checkboxSelected
                      ]}>
                        {action.selected && <Icon name="check" size={14} color="#ffffff" />}
                      </View>
                      <View style={styles.actionTitleContainer}>
                        <Text style={styles.actionTitle}>{action.title}</Text>
                        <View style={[
                          styles.riskBadge,
                          { backgroundColor: getRiskBadgeStyle(action.risk).backgroundColor }
                        ]}>
                          <Text style={[
                            styles.riskBadgeText,
                            { color: getRiskBadgeStyle(action.risk).color }
                          ]}>
                            Risque {action.risk}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <Text style={styles.actionDescription}>{action.description}</Text>
                    <Text style={styles.actionImpact}>
                      <Text style={styles.actionImpactLabel}>Impact : </Text>
                      {action.impact}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={styles.executeButton} onPress={executeActions}>
                <Text style={styles.executeButtonText}>✨ Appliquer les actions</Text>
              </TouchableOpacity>
            </View>
          ) : item.type === 'download' ? (
            <TouchableOpacity
              style={styles.downloadButton}
              onPress={() => {
                // Implémenter le téléchargement pour mobile
                Alert.alert('Téléchargement', `Fichier: ${item.content.filename}`);
              }}
            >
              <Icon name="download" size={18} color="#ffffff" />
              <Text style={styles.downloadButtonText}>
                Télécharger {item.content.filename}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.messageText, isUser && styles.userMessageText]}>
              {item.content}
            </Text>
          )}
        </View>
      </View>
    );
  };

  const renderSessionItem = ({ item }) => {
    const badge = getStatusBadge(item.status);
    const isActive = sessionId === item.session_id;

    return (
      <TouchableOpacity
        onPress={() => restoreSession(item)}
        style={[styles.sessionCard, isActive && styles.sessionCardActive]}
      >
        <View style={styles.sessionHeader}>
          <Text style={styles.sessionFilename} numberOfLines={1}>
            {item.filename}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: badge.color }]}>
            <Text style={[styles.statusBadgeText, { color: badge.textColor }]}>
              {badge.text}
            </Text>
          </View>
        </View>
        <View style={styles.sessionMeta}>
          <Icon name="clock" size={12} color="#9CA3AF" />
          <Text style={styles.sessionDate}>
            {new Date(item.timestamp).toLocaleString('fr-FR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </Text>
        </View>
        <Text style={styles.sessionInfo}>
          {item.rows} lignes × {item.columns} colonnes
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => setShowSidebar(true)} style={styles.menuButton}>
            <Icon name="menu" size={24} color="#111827" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Data Cleaner</Text>
            {currentFile && (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {currentFile.name || currentFile.filename}
              </Text>
            )}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => setShowUserMenu(!showUserMenu)}
          style={styles.userButton}
        >
          <Icon name="user" size={20} color="#111827" />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <FlatList
        ref={scrollViewRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item, index) => index.toString()}
        contentContainerStyle={styles.messagesContainer}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Action Buttons */}
      {sessionId && (
        <View style={styles.actionButtonsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <TouchableOpacity
              style={[styles.actionButton, styles.actionButtonBlue]}
              onPress={() => viewData('before')}
            >
              <Icon name="eye" size={16} color="#ffffff" />
              <Text style={styles.actionButtonText}>Originales</Text>
            </TouchableOpacity>
            {step === 'results' && (
              <>
                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonGreen]}
                  onPress={() => viewData('after')}
                >
                  <Icon name="eye" size={16} color="#ffffff" />
                  <Text style={styles.actionButtonText}>Nettoyées</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonOrange]}
                  onPress={reanalyze}
                >
                  <Icon name="refresh-cw" size={16} color="#ffffff" />
                  <Text style={styles.actionButtonText}>Modifier</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      )}

      {/* Upload Button */}
      {step === 'upload' && (
        <View style={styles.uploadContainer}>
          <TouchableOpacity style={styles.uploadButton} onPress={handleFileUpload}>
            <Icon name="upload" size={32} color="#9CA3AF" />
            <Text style={styles.uploadTitle}>Télécharger un fichier</Text>
            <Text style={styles.uploadSubtitle}>CSV, XLSX, XLS (max 50MB)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sidebar Modal */}
      <Modal
        visible={showSidebar}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSidebar(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.sidebar}>
            <View style={styles.sidebarHeader}>
              <Text style={styles.sidebarTitle}>Sessions</Text>
              <TouchableOpacity onPress={() => setShowSidebar(false)}>
                <Icon name="x" size={24} color="#111827" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.newSessionButton}
              onPress={() => {
                setShowSidebar(false);
                startNewSession();
              }}
            >
              <Text style={styles.newSessionButtonText}>+ Nouveau nettoyage</Text>
            </TouchableOpacity>
            <FlatList
              data={sessions}
              renderItem={renderSessionItem}
              keyExtractor={(item) => item.session_id}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
              ListEmptyComponent={
                <Text style={styles.emptyText}>Aucune session</Text>
              }
            />
          </View>
        </View>
      </Modal>

      {/* User Menu Modal */}
      <Modal
        visible={showUserMenu}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowUserMenu(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowUserMenu(false)}
        >
          <View style={styles.userMenu}>
            <View style={styles.userMenuHeader}>
              <Text style={styles.userName}>{user?.name}</Text>
              <Text style={styles.userEmail}>{user?.email}</Text>
            </View>
            <TouchableOpacity
              style={styles.logoutButton}
              onPress={() => {
                setShowUserMenu(false);
                onLogout();
              }}
            >
              <Icon name="log-out" size={18} color="#DC2626" />
              <Text style={styles.logoutText}>Déconnexion</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Preview Modal */}
      <Modal
        visible={showPreview}
        animationType="slide"
        onRequestClose={() => setShowPreview(false)}
      >
        <View style={styles.previewContainer}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle}>
              {previewType === 'before' ? '📋 Données Originales' : '✨ Données Nettoyées'}
            </Text>
            <TouchableOpacity onPress={() => setShowPreview(false)}>
              <Icon name="x" size={24} color="#111827" />
            </TouchableOpacity>
          </View>
          {previewData && (
            <ScrollView horizontal>
              <ScrollView style={styles.previewScroll}>
                <View style={styles.table}>
                  {/* Table Header */}
                  <View style={styles.tableRow}>
                    <View style={[styles.tableCell, styles.tableHeaderCell]}>
                      <Text style={styles.tableHeaderText}>#</Text>
                    </View>
                    {previewData.columns.map((col, i) => (
                      <View key={i} style={[styles.tableCell, styles.tableHeaderCell]}>
                        <Text style={styles.tableHeaderText}>{col}</Text>
                      </View>
                    ))}
                  </View>
                  {/* Table Rows */}
                  {previewData.rows.map((row, rowIdx) => (
                    <View key={rowIdx} style={styles.tableRow}>
                      <View style={[styles.tableCell, styles.tableIndexCell]}>
                        <Text style={styles.tableIndexText}>{rowIdx + 1}</Text>
                      </View>
                      {row.map((cell, cellIdx) => (
                        <View key={cellIdx} style={styles.tableCell}>
                          <Text style={styles.tableCellText}>
                            {cell === null || cell === undefined || cell === ''
                              ? '∅'
                              : String(cell)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  menuButton: {
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  userButton: {
    padding: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
  },
  messagesContainer: {
    padding: 16,
  },
  messageContainer: {
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  userMessageContainer: {
    alignItems: 'flex-end',
  },
  messageBubble: {
    maxWidth: '85%',
    padding: 16,
    borderRadius: 16,
  },
  botBubble: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    backgroundColor: '#111827',
    borderBottomRightRadius: 4,
  },
  messageText: {
    fontSize: 14,
    color: '#111827',
    lineHeight: 20,
  },
  userMessageText: {
    color: '#ffffff',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#6B7280',
  },
  actionsContainer: {
    marginTop: 16,
  },
  actionCard: {
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  actionCardSelected: {
    borderColor: '#111827',
    backgroundColor: '#F9FAFB',
  },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderRadius: 4,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  actionTitleContainer: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  riskBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  riskBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  actionDescription: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 6,
  },
  actionImpact: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  actionImpactLabel: {
    fontWeight: '600',
  },
  executeButton: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  executeButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  downloadButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  actionButtonsContainer: {
    padding: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginRight: 8,
  },
  actionButtonBlue: {
    backgroundColor: '#3B82F6',
  },
  actionButtonGreen: {
    backgroundColor: '#10B981',
  },
  actionButtonOrange: {
    backgroundColor: '#F97316',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  uploadContainer: {
    padding: 16,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  uploadButton: {
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginTop: 12,
  },
  uploadSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sidebar: {
    backgroundColor: '#ffffff',
    height: height * 0.8,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sidebarTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  newSessionButton: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  newSessionButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  sessionCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sessionCardActive: {
    borderColor: '#111827',
    backgroundColor: '#F3F4F6',
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sessionFilename: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  sessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  sessionDate: {
    fontSize: 11,
    color: '#6B7280',
    marginLeft: 4,
  },
  sessionInfo: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  emptyText: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 32,
  },
  userMenu: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    margin: 16,
    marginTop: 80,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  userMenuHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  userEmail: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  logoutText: {
    fontSize: 14,
    color: '#DC2626',
    marginLeft: 8,
    fontWeight: '500',
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  previewScroll: {
    flex: 1,
  },
  table: {
    padding: 16,
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableCell: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    padding: 8,
    minWidth: 100,
  },
  tableHeaderCell: {
    backgroundColor: '#F3F4F6',
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  tableIndexCell: {
    backgroundColor: '#F9FAFB',
    minWidth: 50,
  },
  tableIndexText: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  tableCellText: {
    fontSize: 13,
    color: '#111827',
  },
});

export default DataCleaningAssistant;