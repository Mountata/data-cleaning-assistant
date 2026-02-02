# auth.py - Routes d'authentification

from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
import datetime
from functools import wraps
import os

auth_bp = Blueprint('auth', __name__)
SECRET_KEY = os.getenv('SECRET_KEY', 'votre-cle-secrete-changez-moi')

# Import de la base de données SQLite
from database import SessionDatabase

db = SessionDatabase()


# Décorateur pour protéger les routes
def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')

        if not token:
            return jsonify({'error': 'Token manquant'}), 401

        try:
            if token.startswith('Bearer '):
                token = token.split(' ')[1]

            data = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            current_user_id = data['user_id']
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expiré'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Token invalide'}), 401

        return f(current_user_id, *args, **kwargs)

    return decorated


# Route d'inscription
@auth_bp.route('/register', methods=['POST'])
def register():
    try:
        data = request.json
        name = data.get('name', '').strip()
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')

        # Validation des données
        if not name or not email or not password:
            return jsonify({'error': 'Tous les champs sont requis'}), 400

        if len(password) < 6:
            return jsonify({'error': 'Le mot de passe doit contenir au moins 6 caractères'}), 400

        if '@' not in email:
            return jsonify({'error': 'Email invalide'}), 400

        # Vérifier si l'email existe déjà
        if db.get_user_by_email(email):
            return jsonify({'error': 'Cet email est déjà utilisé'}), 400

        # Hasher le mot de passe
        password_hash = generate_password_hash(password, method='pbkdf2:sha256')

        # Créer l'utilisateur
        user_id = db.create_user(name, email, password_hash)

        # Générer le token JWT
        token = jwt.encode({
            'user_id': user_id,
            'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)
        }, SECRET_KEY, algorithm='HS256')

        return jsonify({
            'token': token,
            'user': {
                'id': user_id,
                'name': name,
                'email': email
            }
        }), 201

    except Exception as e:
        print(f"Erreur lors de l'inscription: {e}")
        return jsonify({'error': 'Erreur lors de l\'inscription'}), 500


# Route de connexion
@auth_bp.route('/login', methods=['POST'])
def login():
    try:
        data = request.json
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'error': 'Email et mot de passe requis'}), 400

        # Récupérer l'utilisateur
        user = db.get_user_by_email(email)

        if not user or not check_password_hash(user['password_hash'], password):
            return jsonify({'error': 'Email ou mot de passe incorrect'}), 401

        # Générer le token JWT
        token = jwt.encode({
            'user_id': user['id'],
            'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)
        }, SECRET_KEY, algorithm='HS256')

        return jsonify({
            'token': token,
            'user': {
                'id': user['id'],
                'name': user['name'],
                'email': user['email']
            }
        }), 200

    except Exception as e:
        print(f"Erreur lors de la connexion: {e}")
        return jsonify({'error': 'Erreur lors de la connexion'}), 500


# Route de vérification du token
@auth_bp.route('/verify', methods=['GET'])
@token_required
def verify_token(current_user_id):
    try:
        user = db.get_user_by_id(current_user_id)
        if not user:
            return jsonify({'error': 'Utilisateur non trouvé'}), 404

        return jsonify({
            'user': {
                'id': user['id'],
                'name': user['name'],
                'email': user['email']
            }
        }), 200
    except Exception as e:
        print(f"Erreur lors de la vérification: {e}")
        return jsonify({'error': 'Erreur de vérification'}), 500


# Route de déconnexion (optionnelle - côté client principalement)
@auth_bp.route('/logout', methods=['POST'])
@token_required
def logout(current_user_id):
    # Avec JWT, la déconnexion se fait principalement côté client
    # en supprimant le token stocké
    return jsonify({'message': 'Déconnexion réussie'}), 200


# Route pour rafraîchir le token
@auth_bp.route('/refresh', methods=['POST'])
@token_required
def refresh_token(current_user_id):
    try:
        user = db.get_user_by_id(current_user_id)
        if not user:
            return jsonify({'error': 'Utilisateur non trouvé'}), 404

        # Générer un nouveau token
        new_token = jwt.encode({
            'user_id': user['id'],
            'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)
        }, SECRET_KEY, algorithm='HS256')

        return jsonify({
            'token': new_token,
            'user': {
                'id': user['id'],
                'name': user['name'],
                'email': user['email']
            }
        }), 200
    except Exception as e:
        print(f"Erreur lors du rafraîchissement: {e}")
        return jsonify({'error': 'Erreur de rafraîchissement'}), 500


# Route pour mettre à jour le profil
@auth_bp.route('/profile', methods=['PUT'])
@token_required
def update_profile(current_user_id):
    try:
        data = request.json
        name = data.get('name', '').strip()

        if not name:
            return jsonify({'error': 'Le nom est requis'}), 400

        # Mise à jour du nom (tu devras ajouter cette méthode dans database.py)
        # Pour l'instant on retourne juste les infos actuelles
        user = db.get_user_by_id(current_user_id)

        return jsonify({
            'user': {
                'id': user['id'],
                'name': user['name'],
                'email': user['email']
            }
        }), 200
    except Exception as e:
        print(f"Erreur lors de la mise à jour: {e}")
        return jsonify({'error': 'Erreur de mise à jour'}), 500