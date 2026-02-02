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
from auth import auth_bp

logging.basicConfig(level=logging.DEBUG)

app = Flask(__name__)
#CORS(app)
# Charger la configuration
configclass = get_config()
app.config.from_object(configclass)
CORS(app, origins=app.config['CORS_ORIGINS'])

app.register_blueprint(auth_bp, url_prefix="/api")




UPLOAD_FOLDER = 'uploads'
CLEANED_FOLDER = 'cleaned'
#ALLOWED_EXTENSIONS = {'csv', 'json', 'xlsx', 'xls', 'xml'}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(CLEANED_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['CLEANED_FOLDER'] = CLEANED_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

sessions_db = {}


# -------------------- UTILITAIRES --------------------
def convert_to_serializable(obj):
    """Convertit les types NumPy en types Python natifs pour JSON"""
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        # Convertir NaN et Inf en None
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
    elif pd.isna(obj):  # Gère NaN, NaT, None
        return None
    return obj


#def allowed_file(filename):
#    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

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
                        df = pd.read_csv(
                            filepath,
                            encoding=encoding,
                            sep=sep,
                            on_bad_lines='skip'  # <-- IGNORE les lignes mal formatées
                        )
                        if len(df.columns) > 1:
                            df.replace(r'^\s*$', np.nan, regex=True, inplace=True)
                            return df
                    except:
                        continue
            # fallback si tout échoue
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
        """
        Détecte les doublons exacts et structurels dans le DataFrame.

        Args:
            df (pd.DataFrame): Le DataFrame à analyser
            uniqueness_threshold (float): Seuil pour considérer une colonne comme ID probable

        Returns:
            dict: {"exact_duplicates", "structural_duplicates", "used_columns"}
        """
        # 1️⃣ Doublons exacts
        exact_count = int(df.duplicated().sum())

        # 2️⃣ Colonnes candidates pour doublons structurels (non ID)
        candidate_cols = []
        for col in df.columns:
            uniqueness_ratio = df[col].nunique(dropna=True) / len(df)
            if uniqueness_ratio < uniqueness_threshold:
                candidate_cols.append(col)

        # 3️⃣ Doublons structurels
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
        """
        Supprime les doublons exacts et structurels du DataFrame.

        Args:
            df (pd.DataFrame): Le DataFrame à nettoyer
            uniqueness_threshold (float): Seuil pour considérer une colonne comme ID probable

        Returns:
            tuple: (df nettoyé, dict des doublons supprimés)
        """
        initial_len = len(df)

        # 1️⃣ Doublons exacts
        exact_count = int(df.duplicated().sum())
        df = df.drop_duplicates()

        # 2️⃣ Colonnes candidates pour doublons structurels
        candidate_cols = []
        for col in df.columns:
            uniqueness_ratio = df[col].nunique(dropna=True) / len(df)
            if uniqueness_ratio < uniqueness_threshold:
                candidate_cols.append(col)

        # 3️⃣ Supprimer les doublons structurels
        if candidate_cols:
            structural_count = int(df.duplicated(subset=candidate_cols).sum())
            df = df.drop_duplicates(subset=candidate_cols)
        else:
            structural_count = 0

        # 4️⃣ Rapport des doublons supprimés
        duplicates_removed = {
            "exact_duplicates_removed": exact_count,
            "structural_duplicates_removed": structural_count,
            "used_columns": candidate_cols,
            "total_removed": exact_count + structural_count,
            "initial_rows": initial_len,
            "final_rows": len(df)
        }

        return df, duplicates_removed


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
    def remove_outliers(df, column_types):
        initial = len(df)
        for col in df.columns:
            if column_types.get(col) == 'numeric':
                Q1 = df[col].quantile(0.25)
                Q3 = df[col].quantile(0.75)
                IQR = Q3 - Q1
                lower = Q1 - 1.5 * IQR
                upper = Q3 + 1.5 * IQR
                df = df[(df[col] >= lower) & (df[col] <= upper)]
        return df, int(initial - len(df))

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
                # Convertir en datetime
                df[col] = pd.to_datetime(df[col], errors='coerce', dayfirst=True)
                # Formater uniquement les dates valides, garder NaT comme NaN
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
    def apply_cleaning(df, actions, column_types):
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
            df, removed = DataCleaner.remove_outliers(df, column_types)
            results['outliers_removed'] = removed
            results['actions_performed'].append('Suppression des valeurs aberrantes')

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
@app.route('/api/upload', methods=['POST'])
def upload_file():
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
            'timestamp': datetime.now().isoformat()
        }

        return jsonify({
            'session_id': session_id,
            'filename': filename,
            'analysis': analysis
        }), 200

    except Exception as e:
        logging.error(f"[UPLOAD ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/preview/<session_id>', methods=['GET'])
def preview_data(session_id):
    """Nouveau endpoint pour prévisualiser les données"""
    try:
        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]
        df = session['dataframe'].copy()

        # Remplacer NaN par None avant conversion
        df = df.replace({np.nan: None, np.inf: None, -np.inf: None})

        # Limite à 100 premières lignes pour la performance
        preview_df = df.head(100)

        # Convertir en liste en gérant les valeurs spéciales
        rows = []
        for _, row in preview_df.iterrows():
            row_data = []
            for val in row:
                if pd.isna(val) or val is None:
                    row_data.append(None)
                elif isinstance(val, (np.integer, np.int64)):
                    row_data.append(int(val))
                elif isinstance(val, (np.floating, np.float64)):
                    if np.isnan(val) or np.isinf(val):
                        row_data.append(None)
                    else:
                        row_data.append(float(val))
                else:
                    row_data.append(str(val))
            rows.append(row_data)

        data = {
            'columns': [str(col) for col in df.columns],
            'rows': rows,
            'total_rows': int(len(session['dataframe']))
        }

        return jsonify(data), 200

    except Exception as e:
        logging.error(f"[PREVIEW ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/session/<session_id>', methods=['GET'])
def get_session_details(session_id):
    """Récupère les détails complets d'une session pour restauration"""
    try:
        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]

        response_data = {
            'session_id': session_id,
            'filename': session['filename'],
            'file_extension': session['file_extension'],
            'timestamp': session['timestamp'],
            'analysis': session['analysis'],
            'status': session.get('status', 'uploaded')
        }

        # Ajouter les résultats de nettoyage si disponibles
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


@app.route('/api/clean', methods=['POST'])
def clean_data():
    try:
        data = request.json
        session_id = data.get('session_id')
        actions = data.get('actions', [])

        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]
        df = session['dataframe'].copy()
        column_types = session['analysis']['column_types']

        cleaned_df, results = DataCleaner.apply_cleaning(df, actions, column_types)

        cleaned_filename = f"cleaned_{session['filename']}"
        cleaned_filepath = os.path.join(app.config['CLEANED_FOLDER'], f"{session_id}_{cleaned_filename}")
        save_file(cleaned_df, cleaned_filepath, session['file_extension'])

        session['cleaned_filepath'] = cleaned_filepath
        session['cleaned_filename'] = cleaned_filename
        session['cleaned_dataframe'] = cleaned_df
        session['cleaning_results'] = results
        session['status'] = 'cleaned'  # ← AJOUT DU STATUT

        return jsonify({
            'session_id': session_id,
            'results': results,
            'download_filename': cleaned_filename
        }), 200

    except Exception as e:
        logging.error(f"[CLEAN ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/preview-cleaned/<session_id>', methods=['GET'])
def preview_cleaned_data(session_id):
    """Prévisualiser les données nettoyées"""
    try:
        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]

        if 'cleaned_dataframe' not in session:
            return jsonify({'error': 'Données nettoyées non disponibles'}), 404

        df = session['cleaned_dataframe'].copy()

        # Remplacer NaN par None avant conversion
        df = df.replace({np.nan: None, np.inf: None, -np.inf: None})

        # Limite à 100 premières lignes
        preview_df = df.head(100)

        # Convertir en liste en gérant les valeurs spéciales
        rows = []
        for _, row in preview_df.iterrows():
            row_data = []
            for val in row:
                if pd.isna(val) or val is None:
                    row_data.append(None)
                elif isinstance(val, (np.integer, np.int64)):
                    row_data.append(int(val))
                elif isinstance(val, (np.floating, np.float64)):
                    if np.isnan(val) or np.isinf(val):
                        row_data.append(None)
                    else:
                        row_data.append(float(val))
                else:
                    row_data.append(str(val))
            rows.append(row_data)

        data = {
            'columns': [str(col) for col in df.columns],
            'rows': rows,
            'total_rows': int(len(session['cleaned_dataframe']))
        }

        return jsonify(data), 200

    except Exception as e:
        logging.error(f"[PREVIEW CLEANED ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/download/<session_id>', methods=['GET'])
def download_file(session_id):
    try:
        if session_id not in sessions_db:
            return jsonify({'error': 'Session non trouvée'}), 404

        session = sessions_db[session_id]

        if 'cleaned_filepath' not in session:
            return jsonify({'error': 'Fichier nettoyé non disponible'}), 404

        return send_file(
            session['cleaned_filepath'],
            as_attachment=True,
            download_name=session['cleaned_filename']
        )

    except Exception as e:
        logging.error(f"[DOWNLOAD ERROR] {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    sessions_list = []
    for sid, session in sessions_db.items():
        sessions_list.append({
            'session_id': sid,
            'filename': session['filename'],
            'timestamp': session['timestamp'],
            'rows': session['analysis']['rows'],
            'columns': session['analysis']['columns']
        })
    return jsonify({'sessions': sessions_list}), 200


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    }), 200


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)