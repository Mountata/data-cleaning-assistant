# config.py - Configuration centralisée pour l'application

import os
from datetime import timedelta

DATABASE_TYPE = "sqlite"   # "postgres" plus tard
DATABASE_PATH = "sessions.db"
class Config:
    """Configuration de base"""

    # Clé secrète Flask (changer en production !)
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'

    # Dossiers
    BASE_DIR = os.path.abspath(os.path.dirname(__file__))
    UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
    CLEANED_FOLDER = os.path.join(BASE_DIR, 'cleaned')

    # Fichiers autorisés
    ALLOWED_EXTENSIONS = {'csv', 'json', 'xlsx', 'xls', 'xml'}
    MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50MB

    # CORS
    #CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:5173']  # React dev servers
    CORS_ORIGINS = '*'  # React dev servers

    # Sessions
    SESSION_LIFETIME = timedelta(hours=24)
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)

    # Performance
    MAX_WORKERS = 4
    REQUEST_TIMEOUT = 300  # 5 minutes

    # Nettoyage automatique des fichiers
    AUTO_CLEANUP_ENABLED = True
    FILE_RETENTION_DAYS = 7  # Supprimer les fichiers après 7 jours

    # Limites de nettoyage
    MAX_ROWS_FOR_OUTLIER_DETECTION = 100000  # Ne pas détecter outliers au-delà
    MAX_ROWS_IN_MEMORY = 500000  # Limite pour traitement en mémoire

    # Analyse
    MISSING_VALUE_THRESHOLD = 0.8  # 80% de valeurs manquantes = colonne suspecte
    OUTLIER_METHOD = 'IQR'  # IQR ou Z-score
    IQR_MULTIPLIER = 1.5
    Z_SCORE_THRESHOLD = 3

    # Formats de dates reconnus
    DATE_FORMATS = [
        '%Y-%m-%d',
        '%d/%m/%Y',
        '%m/%d/%Y',
        '%Y/%m/%d',
        '%d-%m-%Y',
        '%m-%d-%Y',
        '%Y%m%d',
        '%d.%m.%Y',
        '%Y-%m-%d %H:%M:%S',
        '%d/%m/%Y %H:%M:%S'
    ]

    # Séparateurs CSV à tester
    CSV_DELIMITERS = [',', ';', '\t', '|']

    # Encodages à tester
    CSV_ENCODINGS = ['utf-8', 'latin-1', 'iso-8859-1', 'cp1252']

    # Logging
    LOG_LEVEL = 'INFO'
    LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    LOG_FILE = os.path.join(BASE_DIR, 'app.log')


class DevelopmentConfig(Config):
    """Configuration pour le développement"""
    DEBUG = True
    TESTING = False

    # Logs verbeux en dev
    LOG_LEVEL = 'DEBUG'

    CORS_ORIGINS = [
        'http://localhost:3000',  # React Web (Vite)
        'http://localhost:5173',  # React Web (Vite alternatif)
        'http://localhost:19006',  # Expo Web
        'http://192.168.1.33:5000',  # ← IMPORTANT : Votre IP locale pour mobile
        '*'  # ⚠️ Uniquement en dev !
    ]


class ProductionConfig(Config):
    """Configuration pour la production"""
    DEBUG = False
    TESTING = False

    # Sécurité renforcée
    MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # 25MB en prod

    # Base de données en production
    DATABASE_PATH = os.environ.get('DATABASE_URI', '/opt/render/data/data_cleaning.db')

    # CORS - Ajoutez votre domaine Vercel
    CORS_ORIGINS = [
        'https://data-cleaning-assistant-pi.vercel.app',  # ← Remplacez par votre URL Vercel
        'https://data-cleaning-assistant.onrender.com'
    ]

    # Vous pouvez aussi utiliser une variable d'environnement
    # CORS_ORIGINS = os.environ.get('ALLOWED_ORIGINS', '').split(',')

    # Logs moins verbeux
    LOG_LEVEL = 'WARNING'

class TestingConfig(Config):
    """Configuration pour les tests"""
    TESTING = True
    DEBUG = True
    CORS_ORIGINS = '*'

    # Dossiers temporaires pour les tests
    UPLOAD_FOLDER = os.path.join(Config.BASE_DIR, 'test_uploads')
    CLEANED_FOLDER = os.path.join(Config.BASE_DIR, 'test_cleaned')

    # Limites réduites pour tests rapides
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5MB
    MAX_ROWS_IN_MEMORY = 10000


# Dictionnaire des configurations
config_dict = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}


def get_config(env=None):
    """Retourne la configuration selon l'environnement"""
    if env is None:
        env = os.environ.get('FLASK_ENV', 'development')

    return config_dict.get(env, DevelopmentConfig)


# Messages personnalisables
MESSAGES = {
    'welcome': {
        'fr': "👋 Bonjour ! Je suis votre assistant intelligent de qualité de données.\n\n"
              "Je vais vous aider à analyser et nettoyer vos données de manière interactive.\n\n"
              "**Commencez par télécharger votre fichier CSV, JSON, XLSX ou XML** 📊",
        'en': "👋 Hello! I'm your intelligent data quality assistant.\n\n"
              "I will help you analyze and clean your data interactively.\n\n"
              "**Start by uploading your CSV, JSON, XLSX or XML file** 📊"
    },

    'analyzing': {
        'fr': "🔍 Analyse en cours de votre fichier...",
        'en': "🔍 Analyzing your file..."
    },

    'analysis_complete': {
        'fr': "✅ **Analyse terminée !**\n\nVoici ce que j'ai trouvé dans vos données :",
        'en': "✅ **Analysis complete!**\n\nHere's what I found in your data:"
    },

    'cleaning_in_progress': {
        'fr': "🧹 Nettoyage en cours...",
        'en': "🧹 Cleaning in progress..."
    },

    'cleaning_complete': {
        'fr': "✨ **Nettoyage terminé avec succès !**",
        'en': "✨ **Cleaning completed successfully!**"
    },

    'no_actions_selected': {
        'fr': "⚠️ Aucune action sélectionnée. Veuillez choisir au moins une action à appliquer.",
        'en': "⚠️ No action selected. Please choose at least one action to apply."
    },

    'file_too_large': {
        'fr': "❌ Fichier trop volumineux. Taille maximale : {max_size}MB",
        'en': "❌ File too large. Maximum size: {max_size}MB"
    },

    'unsupported_format': {
        'fr': "❌ Format non supporté. Formats acceptés : CSV, JSON, XLSX, XML",
        'en': "❌ Unsupported format. Accepted formats: CSV, JSON, XLSX, XML"
    }
}


def get_message(key, lang='fr', **kwargs):
    """Récupère un message dans la langue spécifiée"""
    message = MESSAGES.get(key, {}).get(lang, '')
    if kwargs:
        message = message.format(**kwargs)
    return message


# Recommandations automatiques basées sur l'analyse
RECOMMENDATION_RULES = {
    'duplicates': {
        'threshold': 1,  # Recommander si au moins 1 doublon
        'priority': 'high',
        'description_fr': "Les doublons peuvent fausser vos analyses statistiques",
        'description_en': "Duplicates can skew your statistical analyses"
    },

    'missing_values': {
        'threshold_percentage': 5,  # Recommander si > 5% de valeurs manquantes
        'priority': 'high',
        'description_fr': "Les valeurs manquantes doivent être traitées pour la plupart des algorithmes",
        'description_en': "Missing values must be handled for most algorithms"
    },

    'outliers': {
        'threshold': 3,  # Recommander si au moins 3 outliers
        'priority': 'medium',
        'description_fr': "Les valeurs extrêmes peuvent influencer fortement les résultats",
        'description_en': "Extreme values can strongly influence results"
    },

    'text_issues': {
        'threshold': 5,  # Recommander si au moins 5 problèmes
        'priority': 'low',
        'description_fr': "Améliore la cohérence et la lisibilité des données",
        'description_en': "Improves data consistency and readability"
    }
}

# Exportation de la configuration par défaut
default_config = get_config()