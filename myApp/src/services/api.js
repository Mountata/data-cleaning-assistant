import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ⚠️ IMPORTANT: Remplacez par VOTRE adresse IP locale

//const BASE_URL = 'http://192.168.1.27:5000';

// reseau datascience
const BASE_URL = 'http://192.168.1.33:5000';
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ✅ Intercepteur pour ajouter automatiquement le token à chaque requête
api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    console.log(`🔵 [API] ${config.method.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('❌ [API] Erreur de requête:', error);
    return Promise.reject(error);
  }
);

// ✅ Intercepteur pour gérer les erreurs de réponse
api.interceptors.response.use(
  (response) => {
    console.log(`✅ [API] Réponse ${response.status}:`, response.data);
    return response;
  },
  (error) => {
    console.error('❌ [API] Erreur de réponse:', error.response?.data || error.message);

    // Si le token est expiré (401), déconnecter automatiquement
    if (error.response?.status === 401) {
      AsyncStorage.removeItem('token');
      AsyncStorage.removeItem('user');
      // Vous pouvez aussi déclencher une navigation vers Login ici
    }

    return Promise.reject(error);
  }
);

// ==================== AUTHENTIFICATION ====================

export const register = async (name, email, password) => {
  const response = await api.post('/api/register', { name, email, password });

  if (response.data.token) {
    await AsyncStorage.setItem('token', response.data.token);
    await AsyncStorage.setItem('user', JSON.stringify(response.data.user));
  }

  return response.data;
};

export const login = async (email, password) => {
  const response = await api.post('/api/login', { email, password });

  if (response.data.token) {
    await AsyncStorage.setItem('token', response.data.token);
    await AsyncStorage.setItem('user', JSON.stringify(response.data.user));
  }

  return response.data;
};

export const logout = async () => {
  await api.post('/api/logout');
  await AsyncStorage.removeItem('token');
  await AsyncStorage.removeItem('user');
};

export const verifyToken = async () => {
  const response = await api.get('/api/verify');
  return response.data;
};

export const getProfile = async () => {
  const response = await api.get('/api/profile');
  return response.data;
};

// ==================== UPLOAD ====================

export const uploadFile = async (fileUri, fileName) => {
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: 'application/octet-stream',
  });

  const response = await api.post('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return response.data;
};

// ==================== SESSIONS ====================

export const getSessions = async () => {
  const response = await api.get('/api/sessions');
  return response.data.sessions || [];
};

export const getSession = async (sessionId) => {
  // ❌ ERREUR CORRIGÉE: Vous aviez mis des backticks au lieu de parenthèses
  const response = await api.get(`/api/session/${sessionId}`);
  return response.data;
};

// ==================== CLEAN ====================

export const cleanData = async (sessionId, actions) => {
  const response = await api.post('/api/clean', {
    session_id: sessionId,
    actions,
  });
  return response.data;
};

// ==================== PREVIEW ====================

export const previewData = async (sessionId) => {
  // ❌ ERREUR CORRIGÉE: Vous aviez mis des backticks au lieu de parenthèses
  const response = await api.get(`/api/preview/${sessionId}`);
  return response.data;
};

export const previewCleanedData = async (sessionId) => {
  // ❌ ERREUR CORRIGÉE: Vous aviez mis des backticks au lieu de parenthèses
  const response = await api.get(`/api/preview-cleaned/${sessionId}`);
  return response.data;
};

// ==================== DOWNLOAD ====================

export const getDownloadUrl = (sessionId) => {
  return `${BASE_URL}/api/download/${sessionId}`;
};

// ==================== STATISTICS ====================

export const getStatistics = async () => {
  const response = await api.get('/api/statistics');
  return response.data;
};

export default api;