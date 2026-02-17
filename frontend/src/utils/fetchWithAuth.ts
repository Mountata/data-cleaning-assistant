// src/utils/fetchWithAuth.ts
// Utilitaire central pour toutes les requêtes API authentifiées
// Remplace fetch() partout dans le projet

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

  // Fusionner les headers avec le token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  // Ajouter le token si présent
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Si le body est FormData, ne pas forcer Content-Type (le navigateur le gère)
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // ✅ Si le token est expiré ou invalide → déconnexion automatique
  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/'; // Redirection vers login
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