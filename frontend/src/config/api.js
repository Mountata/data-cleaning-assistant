// Configuration de l'API
const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export default API_URL;

// Pour debug
console.log('🔗 Backend URL:', API_URL);