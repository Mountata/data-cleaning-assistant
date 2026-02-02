# database.py - Gestion SQLite

import sqlite3
import json
from datetime import datetime
import os
from config import get_config

config = get_config()


class SessionDatabase:
    """Gestion des sessions avec SQLite"""

    def __init__(self, db_path='data_cleaning.db'):
        """Initialise la connexion"""


        self.db_path = os.getenv('DATABASE_URI', '/opt/render/data/data_cleaning.db')


        self.init_database()

    def get_connection(self):
        """Crée une nouvelle connexion"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_database(self):
        """Crée les tables si elles n'existent pas"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # Table des utilisateurs
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Index pour performance
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_users_email 
            ON users(email)
        ''')

        # Table des sessions
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                file_extension TEXT NOT NULL,
                filepath TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                analysis_json TEXT,
                status TEXT DEFAULT 'uploaded',
                user_id INTEGER,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        ''')

        # Table des résultats de nettoyage
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS cleaning_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                cleaned_filepath TEXT,
                cleaned_filename TEXT,
                results_json TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
            )
        ''')

        # Table des actions appliquées
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS actions_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                details_json TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE CASCADE
            )
        ''')

        # Index pour performance
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_sessions_timestamp 
            ON sessions(timestamp DESC)
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_cleaning_session 
            ON cleaning_results(session_id)
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_actions_session 
            ON actions_log(session_id, timestamp)
        ''')

        conn.commit()
        cursor.close()
        conn.close()

    def create_session(self, session_id, filename, file_extension, filepath, analysis=None, user_id=None):
        """Crée une nouvelle session"""
        conn = self.get_connection()
        cursor = conn.cursor()

        analysis_json = json.dumps(analysis) if analysis else None

        cursor.execute('''
            INSERT INTO sessions (session_id, filename, file_extension, filepath, analysis_json, user_id)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (session_id, filename, file_extension, filepath, analysis_json, user_id))

        conn.commit()
        cursor.close()
        conn.close()

        return session_id

    def get_session(self, session_id):
        """Récupère une session par son ID"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT session_id, filename, file_extension, filepath, 
                   timestamp, analysis_json, status, user_id
            FROM sessions
            WHERE session_id = ?
        ''', (session_id,))

        row = cursor.fetchone()
        cursor.close()
        conn.close()

        if row:
            return dict(row)
        return None

    def update_session_status(self, session_id, status):
        """Met à jour le statut d'une session"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            UPDATE sessions
            SET status = ?
            WHERE session_id = ?
        ''', (status, session_id))

        conn.commit()
        cursor.close()
        conn.close()

    def save_cleaning_result(self, session_id, cleaned_filepath, cleaned_filename, results):
        """Sauvegarde les résultats du nettoyage"""
        conn = self.get_connection()
        cursor = conn.cursor()

        results_json = json.dumps(results)

        cursor.execute('''
            INSERT INTO cleaning_results 
            (session_id, cleaned_filepath, cleaned_filename, results_json)
            VALUES (?, ?, ?, ?)
        ''', (session_id, cleaned_filepath, cleaned_filename, results_json))

        conn.commit()
        cursor.close()
        conn.close()

        self.update_session_status(session_id, 'cleaned')

    def get_cleaning_result(self, session_id):
        """Récupère le résultat de nettoyage d'une session"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT cleaned_filepath, cleaned_filename, results_json, timestamp
            FROM cleaning_results
            WHERE session_id = ?
            ORDER BY timestamp DESC
            LIMIT 1
        ''', (session_id,))

        row = cursor.fetchone()
        cursor.close()
        conn.close()

        if row:
            result = dict(row)
            if result.get('results_json'):
                result['results'] = json.loads(result.pop('results_json'))
            return result
        return None

    def log_action(self, session_id, action_type, details=None):
        """Enregistre une action dans les logs"""
        conn = self.get_connection()
        cursor = conn.cursor()

        details_json = json.dumps(details) if details else None

        cursor.execute('''
            INSERT INTO actions_log (session_id, action_type, details_json)
            VALUES (?, ?, ?)
        ''', (session_id, action_type, details_json))

        conn.commit()
        cursor.close()
        conn.close()

    def get_all_sessions(self, limit=50, user_id=None):
        """Récupère toutes les sessions (les plus récentes en premier)"""
        conn = self.get_connection()
        cursor = conn.cursor()

        if user_id:
            cursor.execute('''
                SELECT s.session_id, s.filename, s.file_extension, 
                       s.timestamp, s.analysis_json, s.status,
                       cr.results_json
                FROM sessions s
                LEFT JOIN cleaning_results cr ON s.session_id = cr.session_id
                WHERE s.user_id = ?
                ORDER BY s.timestamp DESC
                LIMIT ?
            ''', (user_id, limit))
        else:
            cursor.execute('''
                SELECT s.session_id, s.filename, s.file_extension, 
                       s.timestamp, s.analysis_json, s.status,
                       cr.results_json
                FROM sessions s
                LEFT JOIN cleaning_results cr ON s.session_id = cr.session_id
                ORDER BY s.timestamp DESC
                LIMIT ?
            ''', (limit,))

        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        sessions = []
        for row in rows:
            row_dict = dict(row)
            analysis = json.loads(row_dict.get('analysis_json', '{}') or '{}')

            sessions.append({
                'session_id': row_dict['session_id'],
                'filename': row_dict['filename'],
                'file_extension': row_dict['file_extension'],
                'timestamp': row_dict['timestamp'],
                'rows': analysis.get('rows', 0),
                'columns': analysis.get('columns', 0),
                'status': row_dict['status'],
                'has_results': bool(row_dict.get('results_json'))
            })

        return sessions

    def delete_session(self, session_id):
        """Supprime une session et ses données associées"""
        session = self.get_session(session_id)
        if not session:
            return False

        # Supprimer les fichiers
        if os.path.exists(session['filepath']):
            os.remove(session['filepath'])

        cleaning_result = self.get_cleaning_result(session_id)
        if cleaning_result and os.path.exists(cleaning_result['cleaned_filepath']):
            os.remove(cleaning_result['cleaned_filepath'])

        # Supprimer de la base de données (CASCADE supprimera aussi cleaning_results et actions_log)
        conn = self.get_connection()
        cursor = conn.cursor()

        # SQLite nécessite que PRAGMA foreign_keys soit activé pour CASCADE
        cursor.execute('PRAGMA foreign_keys = ON')
        cursor.execute('DELETE FROM sessions WHERE session_id = ?', (session_id,))

        conn.commit()
        cursor.close()
        conn.close()

        return True

    def get_statistics(self, user_id=None):
        """Récupère des statistiques globales"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # Nombre total de sessions
        if user_id:
            cursor.execute('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?', (user_id,))
        else:
            cursor.execute('SELECT COUNT(*) as count FROM sessions')
        total_sessions = cursor.fetchone()['count']

        # Sessions nettoyées
        if user_id:
            cursor.execute('SELECT COUNT(*) as count FROM sessions WHERE status = ? AND user_id = ?', ('cleaned', user_id))
        else:
            cursor.execute('SELECT COUNT(*) as count FROM sessions WHERE status = ?', ('cleaned',))
        cleaned_sessions = cursor.fetchone()['count']

        # Sessions aujourd'hui
        if user_id:
            cursor.execute('''
                SELECT COUNT(*) as count FROM sessions 
                WHERE DATE(timestamp) = DATE('now') AND user_id = ?
            ''', (user_id,))
        else:
            cursor.execute('''
                SELECT COUNT(*) as count FROM sessions 
                WHERE DATE(timestamp) = DATE('now')
            ''')
        today_sessions = cursor.fetchone()['count']

        # Actions les plus utilisées
        if user_id:
            cursor.execute('''
                SELECT al.action_type, COUNT(*) as count
                FROM actions_log al
                JOIN sessions s ON al.session_id = s.session_id
                WHERE s.user_id = ?
                GROUP BY al.action_type
                ORDER BY count DESC
                LIMIT 5
            ''', (user_id,))
        else:
            cursor.execute('''
                SELECT action_type, COUNT(*) as count
                FROM actions_log
                GROUP BY action_type
                ORDER BY count DESC
                LIMIT 5
            ''')
        top_actions = [dict(row) for row in cursor.fetchall()]

        cursor.close()
        conn.close()

        return {
            'total_sessions': total_sessions,
            'cleaned_sessions': cleaned_sessions,
            'today_sessions': today_sessions,
            'completion_rate': (cleaned_sessions / total_sessions * 100) if total_sessions > 0 else 0,
            'top_actions': top_actions
        }

    def create_user(self, name, email, password_hash):
        """Crée un nouvel utilisateur"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            INSERT INTO users (name, email, password_hash)
            VALUES (?, ?, ?)
        ''', (name, email, password_hash))

        user_id = cursor.lastrowid

        conn.commit()
        cursor.close()
        conn.close()

        return user_id

    def get_user_by_email(self, email):
        """Récupère un utilisateur par email"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT id, name, email, password_hash, created_at
            FROM users
            WHERE email = ?
        ''', (email,))

        user = cursor.fetchone()
        cursor.close()
        conn.close()

        return dict(user) if user else None

    def get_user_by_id(self, user_id):
        """Récupère un utilisateur par ID"""
        conn = self.get_connection()
        cursor = conn.cursor()

        cursor.execute('''
            SELECT id, name, email, created_at
            FROM users
            WHERE id = ?
        ''', (user_id,))

        user = cursor.fetchone()
        cursor.close()
        conn.close()

        return dict(user) if user else None