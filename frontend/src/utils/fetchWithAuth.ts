// src/utils/fetchWithAuth.ts
// Utilitaire central pour toutes les requêtes API authentifiées

import API_URL from '../config/api';

/**
 * Wrapper autour de fetch() qui ajoute automatiquement le token JWT
 * et gère l'expiration du token (redirection vers login si 401)
 */
export const fetchWithAuth = async (
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> => {
  const token = localStorage.getItem('token');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Si FormData, laisser le navigateur gérer le Content-Type (boundary multipart)
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  // ✅ CORRECTION : backtick manquant dans le fetch original
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // Token expiré ou invalide → déconnexion automatique
  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
    throw new Error('Session expirée, veuillez vous reconnecter');
  }

  return response;
};

// Raccourcis pratiques
export const getWithAuth = (endpoint: string) =>
  fetchWithAuth(endpoint, { method: 'GET' });

export const postWithAuth = (endpoint: string, body: object) =>
  fetchWithAuth(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const postFormWithAuth = (endpoint: string, formData: FormData) =>
  fetchWithAuth(endpoint, {
    method: 'POST',
    body: formData,
  });

export default fetchWithAuth;