import { useState, useEffect } from 'react';
import './App.css';
import DataCleaningAssistant from "./components/DataCleaningAssistant";
import Login from "./components/Auth/Login";
import Register from "./components/Auth/Register";
import API_URL from "./config/api";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [loading, setLoading] = useState(true); // ✅ loader pendant vérification

  // Vérifier le token au chargement AVEC appel serveur
  useEffect(() => {
    const verifyToken = async () => {
      const token = localStorage.getItem('token');

      if (!token) {
        setLoading(false);
        return;
      }

      try {
        // ✅ Vérifier le token côté serveur (pas juste localStorage)
        const response = await fetch(`${API_URL}/api/verify`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          // ✅ Mettre à jour les données utilisateur fraîches depuis le serveur
          setCurrentUser(data.user);
          setIsAuthenticated(true);
          localStorage.setItem('user', JSON.stringify(data.user));
        } else {
          // Token expiré ou invalide → déconnexion propre
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      } catch (err) {
        // Serveur inaccessible → on tente avec les données locales en fallback
        const savedUser = localStorage.getItem('user');
        if (savedUser) {
          try {
            setCurrentUser(JSON.parse(savedUser));
            setIsAuthenticated(true);
          } catch {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
          }
        }
      } finally {
        setLoading(false);
      }
    };

    verifyToken();
  }, []);

  const handleLogin = (user) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
  };

  const handleRegister = (user) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    const token = localStorage.getItem('token');

    // ✅ Appel logout côté serveur (optionnel mais propre)
    try {
      if (token) {
        await fetch(`${API_URL}/api/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    } catch (err) {
      // Ignorer les erreurs réseau lors du logout
    }

    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setCurrentUser(null);
    setIsAuthenticated(false);
    setShowRegister(false);
  };

  // ✅ Loader pendant la vérification du token
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mx-auto mb-4"></div>
          <p className="text-white text-sm">Vérification de la session...</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <DataCleaningAssistant user={currentUser} onLogout={handleLogout} />;
  }

  if (showRegister) {
    return (
      <Register
        onRegister={handleRegister}
        onSwitchToLogin={() => setShowRegister(false)}
      />
    );
  }

  return (
    <Login
      onLogin={handleLogin}
      onSwitchToRegister={() => setShowRegister(true)}
    />
  );
}

export default App;