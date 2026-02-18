# app.py - Backend Flask corrigé
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename
import pandas as pd
import numpy as np
import os
import json
from datetime import datetime
import uuid
import re
import xml.etree.ElementTree as ET
import logging
from config import get_config, get_message
from auth import auth_bp, token_required  # ✅ AJOUT: importer token_required

from zipfile import ZipFile
from io import BytesIO

from assistant import DataAssistant
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

logging.basicConfig(level=logging.DEBUG)

app = Flask(__name__)

SECRET_KEY = os.getenv("SECRET_KEY")
app.config['SECRET_KEY'] = SECRET_KEY
configclass = get_config()
app.config.from_object(configclass)
CORS(app,
     resources={r"/api/*": {"origins": "*"}},
     supports_credentials=True,
     allow_headers=["Content-Type", "Authorization"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]
     )

app.register_blueprint(auth_bp, url_prefix="/api")

if os.environ.get('RENDER'):
    UPLOAD_FOLDER = '/tmp/uploads'
    CLEANED_FOLDER = '/tmp/cleaned'
else:
    UPLOAD_FOLDER = 'uploads'
    CLEANED_FOLDER = 'cleaned'

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(CLEANED_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['CLEANED_FOLDER'] = CLEANED_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

sessions_db = {}


# -------------------- UTILITAIRES --------------------
def convert_to_serializable(obj):
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    elif isinstance(obj, dict):
        return {k: convert_to_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_serializable(item) for item in obj]
    elif pd.isna(obj):
        return None
    return obj


def allowed_file(filename):
    return (
            '.' in filename and
            filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']
    )


def load_file(filepath, file_extension):
    try:
        if file_extension == 'csv':
            encodings = ['utf-8', 'latin-1', 'iso-8859-1', 'cp1252']
            separators = [',', ';', '\t', '|']
            for encoding in encodings:
                for sep in separators:
                    try:
                        df = pd.read_csv(filepath, encoding=encoding, sep=sep, on_bad_lines='skip')
                        if len(df.columns) > 1:
                            df.replace(r'^\s*$', np.nan, regex=True, inplace=True)
                            return df
                    except:
                        continue
            df = pd.read_csv(filepath, encoding='utf-8', sep=',', on_bad_lines='skip')
            df.replace(r'^\s*$', np.nan, regex=True, inplace=True)
            return df
        elif file_extension in ['xlsx', 'xls']:
            df = pd.read_excel(filepath)
            df.replace(r'^\s*$', np.nan, regex=True, inplace=True)
            return df
        elif file_extension == 'json':
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
            df = pd.DataFrame(data)
            df.replace(r'^\s*$', np.nan, regex=True, inplace=True)
            return df
        elif file_extension == 'xml':
            tree = ET.parse(filepath)
            root = tree.getroot()
            data = []
            for child in root:
                row = {elem.tag: elem.text for elem in child}
                data.append(row)
            df = pd.DataFrame(data)
            df.replace(r'^\s*$', np.nan, regex=True, inplace=True)
            return df
        else:
            raise ValueError(f"Extension {file_extension} non supportée")
    except Exception as e:
        logging.error(f"[load_file ERROR] {str(e)}")
        raise Exception(f"Impossible de charger le fichier: {str(e)}")


def save_file(df, filepath, file_extension):
    try:
        if file_extension == 'csv':
            df.to_csv(filepath, index=False, encoding='utf-8')
        elif file_extension in ['xlsx', 'xls']:
            df.to_excel(filepath, index=False)
        elif file_extension == 'json':
            df.to_json(filepath, orient='records', indent=2)
        elif file_extension == 'xml':
            root = ET.Element('data')
            for _, row in df.iterrows():
                record = ET.SubElement(root, 'record')
                for col in df.columns:
                    record_elem = ET.SubElement(record, str(col))
                    val = row[col]
                    record_elem.text = '' if pd.isna(val) else str(val)
            tree = ET.ElementTree(root)
            tree.write(filepath, encoding='utf-8', xml_declaration=True)
    except Exception as e:
        logging.error(f"[save_file ERROR] {str(e)}")
        raise Exception(f"Erreur lors de la sauvegarde: {str(e)}")


# -------------------- ANALYSE DES DONNÉES --------------------
class DataAnalyzer:
    @staticmethod
    def detect_column_types(df):
        types = {}
        for col in df.columns:
            try:
                if pd.api.types.is_numeric_dtype(df[col]):
                    types[col] = 'numeric'
                elif pd.api.types.is_datetime64_any_dtype(df[col]):
                    types[col] = 'datetime'
                else:
                    sample = df[col].dropna().head(100)
                    parsed = None
                    for fmt in app.config['DATE_FORMATS']:
                        try:
                            parsed = pd.to_datetime(sample, format=fmt, errors='coerce')
                            if parsed.notna().sum() > 0:
                                types[col] = 'date_string'
                                break
                        except:
                            continue
                    if col not in types:
                        types[col] = 'text'
            except:
                types[col] = 'text'
        return types

    @staticmethod
    def analyze_missing_values(df):
        missing = {}
        for col in df.columns:
            count = df[col].isna().sum()
            if count > 0:
                missing[col] = {'count': int(count), 'percentage': round(float(count / len(df)) * 100, 2)}
        return missing

    @staticmethod
    def detect_duplicates(df, uniqueness_threshold=0.95):
        exact_count = int(df.duplicated().sum())
        candidate_cols = []
        for col in df.columns:
            uniqueness_ratio = df[col].nunique(dropna=True) / len(df)
            if uniqueness_ratio < uniqueness_threshold:
                candidate_cols.append(col)
        if candidate_cols:
            structural_count = int(df.duplicated(subset=candidate_cols).sum())
        else:
            structural_count = 0
        return {
            "exact_duplicates": exact_count,
            "structural_duplicates": structural_count,
            "used_columns": candidate_cols
        }

    @staticmethod
    def detect_outliers(df, column_types):
        outliers = {}
        for col in df.columns:
            if column_types.get(col) == 'numeric':
                Q1 = df[col].quantile(0.25)
                Q3 = df[col].quantile(0.75)
                IQR = Q3 - Q1
                lower = Q1 - 1.5 * IQR
                upper = Q3 + 1.5 * IQR
                count = ((df[col] < lower) | (df[col] > upper)).sum()
                if count > 0:
                    outliers[col] = int(count)
        return outliers

    @staticmethod
    def analyze_text_issues(df, column_types):
        issues = {}
        for col in df.columns:
            if column_types.get(col) in ['text', 'date_string']:
                col_issues = {}
                emoji_pattern = re.compile("["
                                           u"\U0001F600-\U0001F64F"
                                           u"\U0001F300-\U0001F5FF"
                                           u"\U0001F680-\U0001F6FF"
                                           u"\U0001F1E0-\U0001F1FF"
                                           "]+", flags=re.UNICODE)
                emojis = df[col].apply(lambda x: bool(emoji_pattern.search(str(x)))).sum()
                if emojis > 0: col_issues['emojis'] = int(emojis)
                extra_spaces = df[col].apply(lambda x: '  ' in str(x) or str(x) != str(x).strip()).sum()
                if extra_spaces > 0: col_issues['spaces'] = int(extra_spaces)
                special_chars = df[col].apply(lambda x: bool(re.search(r'[^a-zA-Z0-9\s\-_.,@]', str(x)))).sum()
                if special_chars > 0: col_issues['specialChars'] = int(special_chars)
                if df[col].nunique() < len(df) * 0.5:
                    values_lower = df[col].apply(lambda x: str(x).lower())
                    inconsistent = len(df[col].unique()) - len(values_lower.unique())
                    if inconsistent > 0: col_issues['inconsistentCase'] = int(inconsistent)
                if col_issues: issues[col] = col_issues
        return issues

    @staticmethod
    def detect_date_formats(df, column_types):
        date_issues = {}
        for col in df.columns:
            if column_types.get(col) == 'date_string':
                formats = set()
                sample = df[col].dropna().head(100)
                for val in sample:
                    val_str = str(val)
                    if re.match(r'\d{4}-\d{2}-\d{2}', val_str):
                        formats.add('YYYY-MM-DD')
                    elif re.match(r'\d{2}/\d{2}/\d{4}', val_str):
                        formats.add('DD/MM/YYYY')
                    elif re.match(r'\d{2}-\d{2}-\d{4}', val_str):
                        formats.add('DD-MM-YYYY')
                    elif re.match(r'\d{4}/\d{2}/\d{2}', val_str):
                        formats.add('YYYY/MM/DD')
                if len(formats) > 1: date_issues[col] = list(formats)
        return date_issues

    @staticmethod
    def full_analysis(df):
        column_types = DataAnalyzer.detect_column_types(df)
        analysis = {
            'rows': int(len(df)),
            'columns': int(len(df.columns)),
            'column_names': list(df.columns),
            'column_types': column_types,
            'missing_values': DataAnalyzer.analyze_missing_values(df),
            'duplicates': DataAnalyzer.detect_duplicates(df),
            'outliers': DataAnalyzer.detect_outliers(df, column_types),
            'text_issues': DataAnalyzer.analyze_text_issues(df, column_types),
            'date_formats': DataAnalyzer.detect_date_formats(df, column_types)
        }
        return convert_to_serializable(analysis)


# -------------------- NETTOYAGE DES DONNÉES --------------------
class DataCleaner:
    @staticmethod
    def remove_duplicates(df, uniqueness_threshold=0.95):
        initial_len = len(df)
        exact_count = int(df.duplicated().sum())
        df = df.drop_duplicates()
        candidate_cols = []
        for col in df.columns:
            uniqueness_ratio = df[col].nunique(dropna=True) / len(df)
            if uniqueness_ratio < uniqueness_threshold:
                candidate_cols.append(col)
        if candidate_cols:
            structural_count = int(df.duplicated(subset=candidate_cols).sum())
            df = df.drop_duplicates(subset=candidate_cols)
        else:
            structural_count = 0
        return df, {
            "exact_duplicates_removed": exact_count,
            "structural_duplicates_removed": structural_count,
            "used_columns": candidate_cols,
            "total_removed": exact_count + structural_count,
            "initial_rows": initial_len,
            "final_rows": len(df)
        }

    @staticmethod
    def handle_missing_values(df, column_types):
        corrected = 0
        for col in df.columns:
            count = df[col].isna().sum()
            if count > 0:
                if column_types.get(col) == 'numeric':
                    df[col].fillna(df[col].median(), inplace=True)
                    corrected += count
                elif column_types.get(col) == 'text':
                    mode_val = df[col].mode()
                    if len(mode_val) > 0:
                        df[col].fillna(mode_val[0], inplace=True)
                        corrected += count
        return df, int(corrected)

    @staticmethod
    def remove_outliers(df, column_types, method='median'):
        initial = len(df)
        outliers_info = {}
        for col in df.columns:
            if column_types.get(col) == 'numeric':
                Q1 = df[col].quantile(0.25)
                Q3 = df[col].quantile(0.75)
                IQR = Q3 - Q1
                lower = Q1 - 1.5 * IQR
                upper = Q3 + 1.5 * IQR
                mask = (df[col] < lower) | (df[col] > upper)
                count = mask.sum()
                if count > 0:
                    outliers_info[col] = int(count)
                    if method == 'remove':
                        df = df[~mask]
                    elif method == 'median':
                        df.loc[mask, col] = df[col].median()
                    elif method == 'cap':
                        df[col] = df[col].clip(lower=lower, upper=upper)
                    elif method == 'nan':
                        df.loc[mask, col] = np.nan
                    elif method == 'flag':
                        df[f'{col}_is_outlier'] = mask
        return df, {
            'outliers_detected': outliers_info,
            'rows_removed': int(initial - len(df)) if method == 'remove' else 0,
            'method_used': method,
            'total_outliers': sum(outliers_info.values()) if outliers_info else 0
        }

    @staticmethod
    def clean_text(df, column_types):
        corrections = 0
        emoji_pattern = re.compile("["
                                   u"\U0001F600-\U0001F64F"
                                   u"\U0001F300-\U0001F5FF"
                                   u"\U0001F680-\U0001F6FF"
                                   u"\U0001F1E0-\U0001F1FF"
                                   "]+", flags=re.UNICODE)
        for col in df.columns:
            if column_types.get(col) in ['text', 'date_string']:
                before = df[col].apply(lambda x: '' if pd.isna(x) else str(x))
                df[col] = df[col].apply(lambda x: '' if pd.isna(x) else str(x))
                df[col] = df[col].apply(lambda x: emoji_pattern.sub('', x))
                df[col] = df[col].apply(lambda x: x.strip())
                df[col] = df[col].apply(lambda x: re.sub(r'\s+', ' ', x))
                corrections += int((before != df[col]).sum())
        return df, int(corrections)

    @staticmethod
    def harmonize_dates(df, column_types):
        for col in df.columns:
            if column_types.get(col) == 'date_string':
                df[col] = pd.to_datetime(df[col], errors='coerce', dayfirst=True)
                df[col] = df[col].apply(lambda x: x.strftime('%Y-%m-%d') if pd.notna(x) else None)
        return df

    @staticmethod
    def normalize_case(df, column_types):
        corrections = 0
        for col in df.columns:
            if column_types.get(col) == 'text':
                before = df[col].apply(lambda x: '' if pd.isna(x) else str(x))
                df[col] = df[col].apply(lambda x: '' if pd.isna(x) else str(x).title())
                corrections += int((before != df[col]).sum())
        return df, int(corrections)

    @staticmethod
    def apply_cleaning(df, actions, column_types, outlier_method='median'):
        results = {'initial_rows': int(len(df)), 'actions_performed': []}
        if 'duplicates' in actions:
            df, removed = DataCleaner.remove_duplicates(df)
            results['duplicates_removed'] = removed
            results['actions_performed'].append('Suppression des doublons')
        if 'missing_values' in actions:
            df, corrected = DataCleaner.handle_missing_values(df, column_types)
            results['missing_corrected'] = corrected
            results['actions_performed'].append('Correction des valeurs manquantes')
        if 'outliers' in actions:
            df, outlier_results = DataCleaner.remove_outliers(df, column_types, method=outlier_method)
            results['outliers_removed'] = outlier_results['rows_removed']
            results['outliers_info'] = outlier_results
            results['actions_performed'].append(f'Traitement des outliers ({outlier_results["method_used"]})')
        if 'text_cleaning' in actions:
            df, corrections = DataCleaner.clean_text(df, column_types)
            results['text_normalized'] = corrections
            results['actions_performed'].append('Nettoyage des textes')
        if 'date_format' in actions:
            df = DataCleaner.harmonize_dates(df, column_types)
            results['actions_performed'].append('Harmonisation des dates')
        if 'case_normalization' in actions:
            df, corrections = DataCleaner.normalize_case(df, column_types)
            results['case_normalized'] = corrections
            results['actions_performed'].append('Normalisation de la casse')
        results['final_rows'] = int(len(df))
        results['columns'] = int(len(df.columns))
        return df, convert_to_serializable(results)


# -------------------- ROUTES API --------------------

# ✅ MODIFIÉ: @token_required + current_user_id + user_id dans la session
@app.route('/api/upload', methods=['POST'])
@token_required
def upload_file(current_user_id):
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'Aucun fichier fourni'}), 400
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'Nom de fichier vide'}), 400
        if not allowed_file(file.filename):
            return jsonify({'error': 'Format non supporté'}), 400

        session_id = str(uuid.uuid4())
        filename = secure_filename(file.filename)
        file_extension = filename.rsplit('.', 1)[1].lower()
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}_{filename}")
        file.save(filepath)

        df = load_file(filepath, file_extension)
        analysis = DataAnalyzer.full_analysis(df)

        sessions_db[session_id] = {
            'filename': filename,
            'file_extension': file_extension,
            'filepath': filepath,
            'dataframe': df,
            'analysis': analysis,
            'timestamp': datetime.now().isoformat(),
            'user_id': current_user_id  # ✅ AJOUT
        }

        return jsonify({'session_id': session_id, 'filename': filename, 'analysis': analysis}), 200

    except Exception as e:
        logging.error(f"[UPLOAD ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


# ✅ MODIFIÉ: @token_required + filtrage par user_id
@app.route('/api/sessions', methods=['GET'])
@token_required
def get_sessions(current_user_id):
    sessions_list = []
    for sid, session in sessions_db.items():
        if session.get('user_id') == current_user_id:  # ✅ FILTRAGE
            sessions_list.append({
                'session_id': sid,
                'filename': session['filename'],
                'timestamp': session['timestamp'],
                'rows': session['analysis']['rows'],
                'columns': session['analysis']['columns'],
                'status': session.get('status', 'uploaded')
            })
    # Trier par timestamp décroissant
    sessions_list.sort(key=lambda x: x['timestamp'], reverse=True)
    return jsonify({'sessions': sessions_list}), 200


# ✅ MODIFIÉ: @token_required + vérification appartenance
@app.route('/api/session/<session_id>', methods=['GET'])
@token_required
def get_session_details(current_user_id, session_id):
    try:
        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]

        if session.get('user_id') != current_user_id:  # ✅ VÉRIFICATION
            return jsonify({'error': 'Accès non autorisé'}), 403

        response_data = {
            'session_id': session_id,
            'filename': session['filename'],
            'file_extension': session['file_extension'],
            'timestamp': session['timestamp'],
            'analysis': session['analysis'],
            'status': session.get('status', 'uploaded')
        }
        if 'cleaning_results' in session and 'cleaned_filepath' in session:
            response_data['cleaning_results'] = {
                'results': session['cleaning_results'],
                'cleaned_filepath': session['cleaned_filepath'],
                'cleaned_filename': session['cleaned_filename']
            }
            response_data['status'] = 'cleaned'

        return jsonify(response_data), 200

    except Exception as e:
        logging.error(f"[GET SESSION ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


# ✅ MODIFIÉ: @token_required + vérification appartenance
@app.route('/api/clean', methods=['POST'])
@token_required
def clean_data(current_user_id):
    try:
        data = request.json
        session_id = data.get('session_id')
        actions = data.get('actions', [])
        outlier_method = data.get('outlier_method', 'median')

        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]

        if session.get('user_id') != current_user_id:  # ✅ VÉRIFICATION
            return jsonify({'error': 'Accès non autorisé'}), 403

        df = session['dataframe'].copy()
        column_types = session['analysis']['column_types']
        cleaned_df, results = DataCleaner.apply_cleaning(df, actions, column_types, outlier_method=outlier_method)

        cleaned_filename = f"cleaned_{session['filename']}"
        cleaned_filepath = os.path.join(app.config['CLEANED_FOLDER'], f"{session_id}_{cleaned_filename}")
        save_file(cleaned_df, cleaned_filepath, session['file_extension'])

        session['cleaned_filepath'] = cleaned_filepath
        session['cleaned_filename'] = cleaned_filename
        session['cleaned_dataframe'] = cleaned_df
        session['cleaning_results'] = results
        session['status'] = 'cleaned'

        return jsonify({'session_id': session_id, 'results': results, 'download_filename': cleaned_filename}), 200

    except Exception as e:
        logging.error(f"[CLEAN ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


# ✅ MODIFIÉ: @token_required + vérification appartenance
@app.route('/api/preview/<session_id>', methods=['GET'])
@token_required
def preview_data(current_user_id, session_id):
    try:
        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]

        if session.get('user_id') != current_user_id:  # ✅ VÉRIFICATION
            return jsonify({'error': 'Accès non autorisé'}), 403

        df = session['dataframe'].copy()
        df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
        preview_df = df.head(100)

        rows = []
        for _, row in preview_df.iterrows():
            row_data = []
            for val in row:
                if pd.isna(val) or val is None:
                    row_data.append(None)
                elif isinstance(val, (np.integer, np.int64)):
                    row_data.append(int(val))
                elif isinstance(val, (np.floating, np.float64)):
                    row_data.append(None if (np.isnan(val) or np.isinf(val)) else float(val))
                else:
                    row_data.append(str(val))
            rows.append(row_data)

        return jsonify({
            'columns': [str(col) for col in df.columns],
            'rows': rows,
            'total_rows': int(len(session['dataframe']))
        }), 200

    except Exception as e:
        logging.error(f"[PREVIEW ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


# ✅ MODIFIÉ: @token_required + vérification appartenance
@app.route('/api/preview-cleaned/<session_id>', methods=['GET'])
@token_required
def preview_cleaned_data(current_user_id, session_id):
    try:
        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]

        if session.get('user_id') != current_user_id:  # ✅ VÉRIFICATION
            return jsonify({'error': 'Accès non autorisé'}), 403

        if 'cleaned_dataframe' not in session:
            return jsonify({'error': 'Données nettoyées non disponibles'}), 404

        df = session['cleaned_dataframe'].copy()
        df = df.replace({np.nan: None, np.inf: None, -np.inf: None})
        preview_df = df.head(100)

        rows = []
        for _, row in preview_df.iterrows():
            row_data = []
            for val in row:
                if pd.isna(val) or val is None:
                    row_data.append(None)
                elif isinstance(val, (np.integer, np.int64)):
                    row_data.append(int(val))
                elif isinstance(val, (np.floating, np.float64)):
                    row_data.append(None if (np.isnan(val) or np.isinf(val)) else float(val))
                else:
                    row_data.append(str(val))
            rows.append(row_data)

        return jsonify({
            'columns': [str(col) for col in df.columns],
            'rows': rows,
            'total_rows': int(len(session['cleaned_dataframe']))
        }), 200

    except Exception as e:
        logging.error(f"[PREVIEW CLEANED ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


# ✅ MODIFIÉ: @token_required + vérification appartenance
@app.route('/api/download/<session_id>', methods=['GET'])
@token_required
def download_file(current_user_id, session_id):
    try:
        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]

        if session.get('user_id') != current_user_id:  # ✅ VÉRIFICATION
            return jsonify({'error': 'Accès non autorisé'}), 403

        if 'cleaned_filepath' not in session:
            return jsonify({'error': 'Fichier nettoyé non disponible'}), 404

        return send_file(session['cleaned_filepath'], as_attachment=True, download_name=session['cleaned_filename'])

    except Exception as e:
        logging.error(f"[DOWNLOAD ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


# ✅ MODIFIÉ: @token_required + vérification appartenance
@app.route('/api/download-multiple', methods=['POST'])
@token_required
def download_multiple(current_user_id):
    try:
        data = request.json
        session_ids = data.get('session_ids', [])

        if not session_ids:
            return jsonify({'error': 'Aucune session sélectionnée'}), 400
        if len(session_ids) > 10:
            return jsonify({'error': 'Maximum 10 fichiers à la fois'}), 400

        zip_buffer = BytesIO()
        with ZipFile(zip_buffer, 'w') as zip_file:
            for session_id in session_ids:
                if session_id not in sessions_db:
                    continue
                session = sessions_db[session_id]
                if session.get('user_id') != current_user_id:  # ✅ VÉRIFICATION
                    continue
                if 'cleaned_filepath' not in session:
                    continue
                if not os.path.exists(session['cleaned_filepath']):
                    continue
                zip_file.write(session['cleaned_filepath'], arcname=session['cleaned_filename'])

        zip_buffer.seek(0)
        return send_file(
            zip_buffer,
            mimetype='application/zip',
            as_attachment=True,
            download_name=f'data_cleaned_{datetime.now().strftime("%Y%m%d_%H%M%S")}.zip'
        )

    except Exception as e:
        logging.error(f"[DOWNLOAD MULTIPLE ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


# ✅ MODIFIÉ: @token_required + vérification appartenance
@app.route('/api/chat/recommend', methods=['POST'])
@token_required
def get_recommendations(current_user_id):
    try:
        data = request.json
        session_id = data.get('session_id')

        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]

        if session.get('user_id') != current_user_id:  # ✅ VÉRIFICATION
            return jsonify({'error': 'Accès non autorisé'}), 403

        assistant = DataAssistant(session['dataframe'], session['analysis'])
        recommendations = assistant.generate_recommendations()

        return jsonify({'recommendations': recommendations, 'count': len(recommendations)}), 200

    except Exception as e:
        logging.error(f"[RECOMMEND ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


# ✅ MODIFIÉ: @token_required + vérification appartenance
@app.route('/api/chat/ask', methods=['POST'])
@token_required
def ask_question(current_user_id):
    try:
        data = request.json
        session_id = data.get('session_id')
        question = data.get('question', '')

        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404
        if not question:
            return jsonify({'error': 'Question vide'}), 400

        session = sessions_db[session_id]

        if session.get('user_id') != current_user_id:  # ✅ VÉRIFICATION
            return jsonify({'error': 'Accès non autorisé'}), 403

        assistant = DataAssistant(session['dataframe'], session['analysis'])
        answer = assistant.answer_question(question)

        return jsonify(answer), 200

    except Exception as e:
        logging.error(f"[ASK ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


# ✅ MODIFIÉ: @token_required + vérification appartenance
@app.route('/api/chat/generate-report', methods=['POST'])
@token_required
def generate_report(current_user_id):
    try:
        data = request.json
        session_id = data.get('session_id')

        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]

        if session.get('user_id') != current_user_id:  # ✅ VÉRIFICATION
            return jsonify({'error': 'Accès non autorisé'}), 403

        assistant = DataAssistant(session['dataframe'], session['analysis'])
        recommendations = assistant.generate_recommendations()

        doc = Document()
        title = doc.add_heading('Rapport d\'Analyse de Qualité des Données', 0)
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER

        doc.add_heading('📊 Informations Générales', level=1)
        doc.add_paragraph(f"Fichier : {session['filename']}")
        doc.add_paragraph(f"Date d'analyse : {datetime.now().strftime('%d/%m/%Y %H:%M')}")
        doc.add_paragraph(f"Nombre de lignes : {session['analysis']['rows']:,}")
        doc.add_paragraph(f"Nombre de colonnes : {session['analysis']['columns']}")

        dup = session['analysis'].get('duplicates', {})
        missing = session['analysis'].get('missing_values', {})
        total_dup = dup.get('exact_duplicates', 0) + dup.get('structural_duplicates', 0)
        total_missing = sum(v.get('count', 0) for v in missing.values())
        quality_score = assistant._calculate_quality_score(total_dup, total_missing)

        doc.add_heading('🎯 Score de Qualité', level=1)
        score_para = doc.add_paragraph(f"Score : {quality_score}/100")
        score_para.runs[0].font.size = Pt(16)
        score_para.runs[0].font.bold = True
        if quality_score >= 80:
            score_para.runs[0].font.color.rgb = RGBColor(34, 139, 34)
            doc.add_paragraph("✅ Excellente qualité")
        elif quality_score >= 60:
            score_para.runs[0].font.color.rgb = RGBColor(255, 165, 0)
            doc.add_paragraph("⚡ Qualité correcte")
        else:
            score_para.runs[0].font.color.rgb = RGBColor(220, 20, 60)
            doc.add_paragraph("⚠️ Nettoyage recommandé")

        doc.add_heading('💡 Recommandations', level=1)
        for i, rec in enumerate(recommendations, 1):
            doc.add_heading(f"{i}. {rec['title']}", level=2)
            doc.add_paragraph(f"Priorité : {rec['priority'].upper()}")
            doc.add_paragraph(f"Impact : {rec['impact']}")
            doc.add_paragraph(f"Justification : {rec['justification']}")
            doc.add_paragraph(f"Recommandé : {'✅ Oui' if rec['recommended'] else '⚠️ Optionnel'}")
            doc.add_paragraph("")

        report_filename = f"rapport_{session_id}.docx"
        report_path = os.path.join(app.config['CLEANED_FOLDER'], report_filename)
        doc.save(report_path)

        return jsonify({
            'message': 'Rapport généré avec succès',
            'download_url': f"/api/download-report/{session_id}",
            'filename': report_filename
        }), 200

    except Exception as e:
        logging.error(f"[GENERATE REPORT ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


# ✅ MODIFIÉ: @token_required + vérification appartenance
@app.route('/api/download-report/<session_id>', methods=['GET'])
@token_required
def download_report(current_user_id, session_id):
    try:
        if session_id in sessions_db:
            session = sessions_db[session_id]
            if session.get('user_id') != current_user_id:  # ✅ VÉRIFICATION
                return jsonify({'error': 'Accès non autorisé'}), 403

        report_filename = f"rapport_{session_id}.docx"
        report_path = os.path.join(app.config['CLEANED_FOLDER'], report_filename)

        if not os.path.exists(report_path):
            return jsonify({'error': 'Rapport non trouvé'}), 404

        return send_file(
            report_path,
            as_attachment=True,
            download_name=f"rapport_analyse_{datetime.now().strftime('%Y%m%d')}.docx"
        )

    except Exception as e:
        logging.error(f"[DOWNLOAD REPORT ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()}), 200



if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)