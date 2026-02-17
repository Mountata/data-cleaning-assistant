import React, { useState, useEffect } from 'react';
import { Lock, AlertCircle, CheckCircle, Sparkles, Eye, EyeOff } from 'lucide-react';
import API_URL from '../../config/api';

interface Props {
  token: string;
  onBackToLogin: () => void;
}

const ResetPassword: React.FC<Props> = ({ token, onBackToLogin }) => {
  const [password, setPassword]       = useState('');
  const [confirm, setConfirm]         = useState('');
  const [showPwd, setShowPwd]         = useState(false);
  const [showConf, setShowConf]       = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [success, setSuccess]         = useState(false);

  useEffect(() => {
    if (!token) setError('Lien invalide. Veuillez refaire une demande de réinitialisation.');
  }, [token]);

  // ── Indicateur de force du mot de passe
  const strength = (() => {
    if (!password) return null;
    if (password.length < 6)  return { label: 'Faible',  color: 'bg-red-500',    w: '33%' };
    if (password.length < 10) return { label: 'Moyen',   color: 'bg-yellow-500', w: '66%' };
    return                           { label: 'Fort',    color: 'bg-green-500',  w: '100%' };
  })();

  const handleSubmit = async () => {
    setError('');
    if (password.length < 6)    { setError('Le mot de passe doit contenir au moins 6 caractères'); return; }
    if (password !== confirm)   { setError('Les mots de passe ne correspondent pas'); return; }

    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/api/reset-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(true);
      } else {
        setError(data.error || 'Une erreur est survenue');
      }
    } catch {
      setError('Erreur de connexion au serveur');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl mb-4">
            <Sparkles className="w-8 h-8 text-gray-900" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Data Cleaner</h1>
          <p className="text-gray-400">Réinitialisation du mot de passe</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">

          {/* ── SUCCÈS ── */}
          {success ? (
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Mot de passe mis à jour !</h2>
              <p className="text-sm text-gray-600 mb-6">
                Votre mot de passe a été réinitialisé avec succès.
                Vous pouvez maintenant vous connecter.
              </p>
              <button
                onClick={onBackToLogin}
                className="w-full bg-gray-900 text-white py-3 rounded-lg hover:bg-gray-800 transition-colors font-medium"
              >
                Se connecter
              </button>
            </div>

          ) : (
            /* ── FORMULAIRE ── */
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Nouveau mot de passe</h2>
              <p className="text-sm text-gray-600 mb-6">
                Choisissez un mot de passe sécurisé (minimum 6 caractères).
              </p>

              {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-red-800">{error}</p>
                    {(error.includes('invalide') || error.includes('expiré')) && (
                      <button onClick={onBackToLogin} className="text-sm text-red-700 underline mt-1">
                        Retour à la connexion
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {/* Nouveau mot de passe */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nouveau mot de passe
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                      placeholder="Minimum 6 caractères"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPwd ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>

                  {/* Barre de force */}
                  {strength && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${strength.color} transition-all duration-300`}
                          style={{ width: strength.w }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-600 w-10">{strength.label}</span>
                    </div>
                  )}
                </div>

                {/* Confirmation */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Confirmer le mot de passe
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type={showConf ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !loading && handleSubmit()}
                      className={`w-full pl-10 pr-12 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent ${
                        confirm && password !== confirm
                          ? 'border-red-300 bg-red-50'
                          : 'border-gray-300'
                      }`}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConf(!showConf)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showConf ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                    {confirm && password === confirm && (
                      <CheckCircle className="absolute right-10 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />
                    )}
                  </div>
                  {confirm && password !== confirm && (
                    <p className="text-xs text-red-600 mt-1">Les mots de passe ne correspondent pas</p>
                  )}
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={loading || !password || !confirm || password !== confirm}
                  className="w-full bg-gray-900 text-white py-3 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                      Mise à jour...
                    </span>
                  ) : 'Enregistrer le nouveau mot de passe'}
                </button>
              </div>

              <div className="mt-4 text-center">
                <button
                  onClick={onBackToLogin}
                  className="text-sm text-gray-500 hover:text-gray-700 hover:underline transition-colors"
                >
                  Retour à la connexion
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 text-center text-sm text-gray-400">
          © 2026 Data Cleaner. Tous droits réservés.
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;