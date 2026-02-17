# auth.py - Authentification complète + Mot de passe oublié (Gmail)

from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
import jwt
import datetime
import secrets
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from functools import wraps
import os

auth_bp = Blueprint('auth', __name__)
SECRET_KEY = os.getenv('SECRET_KEY', 'votre-cle-secrete-changez-moi')

# ── Variables Gmail (définies dans Render → Environment)
GMAIL_USER     = os.getenv('GMAIL_USER')           # renelegrandmountata@gmail.com
GMAIL_PASSWORD = os.getenv('GMAIL_APP_PASSWORD')   # gpjescsrzkamdukd
FRONTEND_URL   = os.getenv('FRONTEND_URL', 'http://localhost:3000')

from database import SessionDatabase
db = SessionDatabase()


# ══════════════════════════════════════════════
# DÉCORATEUR JWT
# ══════════════════════════════════════════════

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


# ══════════════════════════════════════════════
# ENVOI EMAIL GMAIL
# ══════════════════════════════════════════════

def send_reset_email(to_email: str, reset_token: str, user_name: str) -> bool:
    """Envoie l'email de réinitialisation via Gmail SMTP SSL."""
    if not GMAIL_USER or not GMAIL_PASSWORD:
        print("[EMAIL] GMAIL_USER ou GMAIL_APP_PASSWORD manquants dans les variables d'env")
        return False

    reset_link = f"{FRONTEND_URL}/reset-password?token={reset_token}"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body{{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0}}
        .wrap{{max-width:520px;margin:40px auto;background:#fff;border-radius:12px;
               overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1)}}
        .head{{background:#111827;padding:32px;text-align:center}}
        .head h1{{color:#fff;margin:0;font-size:22px;letter-spacing:-.5px}}
        .body{{padding:32px}}
        .body p{{color:#374151;line-height:1.7;margin:0 0 12px}}
        .btn{{display:block;width:fit-content;margin:28px auto;padding:14px 36px;
              background:#111827;color:#fff !important;text-decoration:none;
              border-radius:8px;font-weight:bold;font-size:15px}}
        .info{{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;
               padding:14px 16px;margin-top:20px;font-size:13px;color:#0369a1}}
        .warn{{background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;
               padding:12px 16px;margin-top:12px;font-size:13px;color:#92400e}}
        .foot{{text-align:center;padding:20px;color:#9ca3af;font-size:12px;background:#f9fafb}}
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="head">
          <h1>&#128274; Data Cleaner</h1>
        </div>
        <div class="body">
          <p>Bonjour <strong>{user_name}</strong>,</p>
          <p>
            Vous avez demande la reinitialisation de votre mot de passe.
            Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe :
          </p>
          <a href="{reset_link}" class="btn">Reinitialiser mon mot de passe</a>
          <div class="info">
            &#128279; Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
            <span style="color:#3b82f6;word-break:break-all;">{reset_link}</span>
          </div>
          <div class="warn">
            &#9200; Ce lien expire dans <strong>1 heure</strong>.<br>
            Si vous n'avez pas fait cette demande, ignorez cet email.
          </div>
        </div>
        <div class="foot">
          &copy; 2026 Data Cleaner &nbsp;&middot;&nbsp; Tous droits reserves
        </div>
      </div>
    </body>
    </html>
    """

    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = 'Reinitialisation de votre mot de passe - Data Cleaner'
        msg['From']    = f"Data Cleaner <{GMAIL_USER}>"
        msg['To']      = to_email
        msg.attach(MIMEText(html_body, 'html', 'utf-8'))

        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(GMAIL_USER, GMAIL_PASSWORD)
            server.sendmail(GMAIL_USER, to_email, msg.as_string())

        print(f"[EMAIL] Email envoye avec succes a {to_email}")
        return True

    except smtplib.SMTPAuthenticationError:
        print("[EMAIL] Erreur auth Gmail — verifiez GMAIL_USER et GMAIL_APP_PASSWORD")
        return False
    except Exception as e:
        print(f"[EMAIL] Erreur envoi : {e}")
        return False


# ══════════════════════════════════════════════
# ROUTES EXISTANTES
# ══════════════════════════════════════════════

@auth_bp.route('/register', methods=['POST'])
def register():
    try:
        data     = request.json
        name     = data.get('name', '').strip()
        email    = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not name or not email or not password:
            return jsonify({'error': 'Tous les champs sont requis'}), 400
        if len(password) < 6:
            return jsonify({'error': 'Le mot de passe doit contenir au moins 6 caracteres'}), 400
        if '@' not in email:
            return jsonify({'error': 'Email invalide'}), 400
        if db.get_user_by_email(email):
            return jsonify({'error': 'Cet email est deja utilise'}), 400

        password_hash = generate_password_hash(password, method='pbkdf2:sha256')
        user_id       = db.create_user(name, email, password_hash)

        token = jwt.encode({
            'user_id': user_id,
            'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)
        }, SECRET_KEY, algorithm='HS256')

        return jsonify({'token': token, 'user': {'id': user_id, 'name': name, 'email': email}}), 201

    except Exception as e:
        print(f"Erreur inscription: {e}")
        return jsonify({'error': "Erreur lors de l'inscription"}), 500


@auth_bp.route('/login', methods=['POST'])
def login():
    try:
        data     = request.json
        email    = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not email or not password:
            return jsonify({'error': 'Email et mot de passe requis'}), 400

        user = db.get_user_by_email(email)
        if not user or not check_password_hash(user['password_hash'], password):
            return jsonify({'error': 'Email ou mot de passe incorrect'}), 401

        token = jwt.encode({
            'user_id': user['id'],
            'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)
        }, SECRET_KEY, algorithm='HS256')

        return jsonify({
            'token': token,
            'user': {'id': user['id'], 'name': user['name'], 'email': user['email']}
        }), 200

    except Exception as e:
        print(f"Erreur connexion: {e}")
        return jsonify({'error': 'Erreur lors de la connexion'}), 500


@auth_bp.route('/verify', methods=['GET'])
@token_required
def verify_token(current_user_id):
    try:
        user = db.get_user_by_id(current_user_id)
        if not user:
            return jsonify({'error': 'Utilisateur non trouve'}), 404
        return jsonify({
            'user': {'id': user['id'], 'name': user['name'], 'email': user['email']}
        }), 200
    except Exception as e:
        return jsonify({'error': 'Erreur de verification'}), 500


@auth_bp.route('/logout', methods=['POST'])
@token_required
def logout(current_user_id):
    return jsonify({'message': 'Deconnexion reussie'}), 200


@auth_bp.route('/refresh', methods=['POST'])
@token_required
def refresh_token(current_user_id):
    try:
        user = db.get_user_by_id(current_user_id)
        if not user:
            return jsonify({'error': 'Utilisateur non trouve'}), 404
        new_token = jwt.encode({
            'user_id': user['id'],
            'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)
        }, SECRET_KEY, algorithm='HS256')
        return jsonify({
            'token': new_token,
            'user': {'id': user['id'], 'name': user['name'], 'email': user['email']}
        }), 200
    except Exception as e:
        return jsonify({'error': 'Erreur de rafraichissement'}), 500


@auth_bp.route('/profile', methods=['PUT'])
@token_required
def update_profile(current_user_id):
    try:
        data = request.json
        name = data.get('name', '').strip()
        if not name:
            return jsonify({'error': 'Le nom est requis'}), 400
        user = db.get_user_by_id(current_user_id)
        return jsonify({
            'user': {'id': user['id'], 'name': user['name'], 'email': user['email']}
        }), 200
    except Exception as e:
        return jsonify({'error': 'Erreur de mise a jour'}), 500


# ══════════════════════════════════════════════
# NOUVELLES ROUTES — MOT DE PASSE OUBLIÉ
# ══════════════════════════════════════════════

@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    """
    L'utilisateur soumet son email.
    On génère un token sécurisé et on envoie le lien par email.
    On répond toujours "succès" pour ne pas révéler si l'email existe.
    """
    try:
        data  = request.json
        email = data.get('email', '').strip().lower()

        if not email:
            return jsonify({'error': 'Email requis'}), 400

        user = db.get_user_by_email(email)

        if user:
            reset_token = secrets.token_urlsafe(32)   # token 64 chars sécurisé
            expires_at  = datetime.datetime.utcnow() + datetime.timedelta(hours=1)
            db.save_reset_token(user['id'], reset_token, expires_at)
            send_reset_email(email, reset_token, user['name'])

        # Même réponse que l'email existe ou non (sécurité)
        return jsonify({
            'message': 'Si cet email est associe a un compte, vous recevrez un lien de reinitialisation.'
        }), 200

    except Exception as e:
        print(f"Erreur forgot-password: {e}")
        return jsonify({'error': 'Une erreur est survenue'}), 500


@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    """
    L'utilisateur soumet le token + nouveau mot de passe.
    On vérifie le token, met à jour le mdp, supprime le token.
    """
    try:
        data         = request.json
        token        = data.get('token', '').strip()
        new_password = data.get('password', '')

        if not token or not new_password:
            return jsonify({'error': 'Token et nouveau mot de passe requis'}), 400
        if len(new_password) < 6:
            return jsonify({'error': 'Le mot de passe doit contenir au moins 6 caracteres'}), 400

        reset_data = db.get_reset_token(token)
        if not reset_data:
            return jsonify({'error': 'Lien invalide ou deja utilise'}), 400

        # Vérification expiration
        expires_at = datetime.datetime.fromisoformat(reset_data['expires_at'])
        if datetime.datetime.utcnow() > expires_at:
            db.delete_reset_token(token)
            return jsonify({'error': 'Lien expire, veuillez refaire une demande'}), 400

        # Mise à jour + suppression token (usage unique)
        new_hash = generate_password_hash(new_password, method='pbkdf2:sha256')
        db.update_user_password(reset_data['user_id'], new_hash)
        db.delete_reset_token(token)

        return jsonify({'message': 'Mot de passe mis a jour avec succes !'}), 200

    except Exception as e:
        print(f"Erreur reset-password: {e}")
        return jsonify({'error': 'Une erreur est survenue'}), 500