# backend/assistant.py
"""Module d'Assistant Intelligent - Version Pro"""
import pandas as pd
import re
from typing import Dict, List, Optional, Tuple


# ──────────────────────────────────────────────
# INTENTIONS & SYNONYMES
# ──────────────────────────────────────────────

INTENT_PATTERNS = {
    'missing': {
        'keywords': [
            'manquant', 'manquante', 'manquantes', 'vide', 'vides',
            'null', 'nul', 'nulle', 'nulles', 'nan', 'absent', 'absente',
            'absentes', 'incomplete', 'incomplet', 'incomplets', 'incompléte',
            'remplir', 'rempli', 'cellule vide', 'donnée manquante', 'non renseigné'
        ],
        'questions': [
            'y a-t-il des valeurs manquantes',
            'combien de valeurs manquantes',
            'quelles colonnes ont des valeurs manquantes',
            'est-ce que toutes les cellules sont remplies'
        ],
        'weight': 2
    },
    'duplicates': {
        'keywords': [
            'doublon', 'doublons', 'dupliqu', 'copie', 'copies', 'identique',
            'identiques', 'répété', 'répétés', 'redondant', 'redondants',
            'même ligne', 'lignes dupliquées', 'entrée en double'
        ],
        'questions': [
            'y a-t-il des doublons',
            'combien de doublons',
            'des lignes identiques'
        ],
        'weight': 2
    },
    'quality': {
        'keywords': [
            'qualité', 'quality', 'score', 'évaluer', 'evaluer', 'note',
            'fiabilité', 'fiable', 'propre', 'bon état', 'état général',
            'problème', 'problèmes', 'sain', 'saine', 'santé', 'audit',
            'bilan', 'résumé global', 'synthèse', 'diagnostic', 'overview'
        ],
        'questions': [
            'quelle est la qualité',
            'évalue mes données',
            'fais un bilan',
            'donne-moi un score',
            'mes données sont-elles propres'
        ],
        'weight': 2
    },
    'size': {
        'keywords': [
            'combien', 'nombre', 'taille', 'dimension', 'lignes', 'colonnes',
            'colonne', 'ligne', 'rows', 'columns', 'volume', 'grande', 'petit',
            'dataset', 'jeu de données', 'taille du fichier'
        ],
        'questions': [
            'combien de lignes',
            'combien de colonnes',
            'quelle est la taille'
        ],
        'weight': 1
    },
    'outliers': {
        'keywords': [
            'aberrant', 'aberrante', 'aberrants', 'outlier', 'outliers',
            'extrême', 'extreme', 'anormal', 'anormaux', 'extrémité',
            'valeur extrême', 'hors norme', 'atypique', 'atypiques', 'iqr',
            'valeur suspecte', 'incohérent numériquement'
        ],
        'questions': [
            'y a-t-il des valeurs aberrantes',
            'des outliers',
            'valeurs extrêmes'
        ],
        'weight': 2
    },
    'text': {
        'keywords': [
            'texte', 'text', 'emoji', 'emojis', 'caractère', 'caracteres',
            'espace', 'espaces', 'spécial', 'speciaux', 'casse', 'majuscule',
            'minuscule', 'format texte', 'encodage', 'chaine', 'string',
            'ponctuation', 'accents', 'symbole'
        ],
        'questions': [
            'y a-t-il des problèmes de texte',
            'des emojis dans mes données',
            'des caractères spéciaux'
        ],
        'weight': 2
    },
    'dates': {
        'keywords': [
            'date', 'dates', 'format de date', 'format date', 'calendrier',
            'datetime', 'temporal', 'chronologique', 'timestamp', 'année',
            'mois', 'jour', 'incohérence de date'
        ],
        'questions': [
            'y a-t-il des problèmes de dates',
            'les formats de dates sont-ils cohérents'
        ],
        'weight': 2
    },
    'columns': {
        'keywords': [
            'colonne', 'colonnes', 'champ', 'champs', 'variable', 'variables',
            'attribut', 'attributs', 'field', 'fields', 'liste des colonnes',
            'quelles colonnes', 'noms des colonnes', 'type de données'
        ],
        'questions': [
            'quelles sont les colonnes',
            'liste-moi les colonnes',
            'quels types de données'
        ],
        'weight': 1
    },
    'recommendations': {
        'keywords': [
            'recommand', 'conseil', 'conseils', 'suggestion', 'que faire',
            'que dois-je faire', 'comment nettoyer', 'par où commencer',
            'aide-moi', 'guide-moi', 'quoi faire', 'priorité', 'action',
            'améliorer', 'optimiser', 'corriger', 'traitement'
        ],
        'questions': [
            'que me recommandes-tu',
            'par quoi commencer',
            'comment améliorer mes données'
        ],
        'weight': 3
    },
    'help': {
        'keywords': [
            'aide', 'help', 'comment', 'tu peux', 'tu sais', 'capable',
            'fonctionnalité', 'fonction', 'que fais-tu', 'que peux-tu',
            'explique', 'mode d\'emploi', 'utiliser'
        ],
        'questions': [
            'comment tu fonctionne',
            'que peux-tu faire',
            'comment utiliser'
        ],
        'weight': 1
    }
}

SUGGESTIONS_BY_INTENT = {
    'missing': [
        "Quelles colonnes ont le plus de valeurs manquantes ?",
        "Quel pourcentage de mes données est incomplet ?",
        "Comment corriger les valeurs manquantes ?"
    ],
    'duplicates': [
        "Combien de doublons exacts vs structurels ?",
        "Quelles colonnes créent des doublons ?",
        "Est-ce critique de supprimer les doublons ?"
    ],
    'quality': [
        "Détaille-moi chaque problème trouvé",
        "Quelles actions me recommandes-tu en priorité ?",
        "Y a-t-il des valeurs aberrantes ?"
    ],
    'outliers': [
        "Quelles colonnes ont des valeurs aberrantes ?",
        "Comment traiter ces valeurs aberrantes ?",
        "Combien de valeurs aberrantes au total ?"
    ],
    'recommendations': [
        "Quelles sont les actions à haute priorité ?",
        "Par quoi dois-je commencer ?",
        "Quel est le score de qualité global ?"
    ]
}


# ──────────────────────────────────────────────
# CORE ASSISTANT
# ──────────────────────────────────────────────

class DataAssistant:
    """Assistant intelligent de qualité de données - Version Pro"""

    def __init__(self, df: pd.DataFrame, analysis: Dict):
        self.df = df
        self.analysis = analysis
        self._cache: Dict = {}

    # ── PROPRIÉTÉS CALCULÉES ──────────────────

    @property
    def total_duplicates(self) -> int:
        dup = self.analysis.get('duplicates', {})
        return dup.get('exact_duplicates', 0) + dup.get('structural_duplicates', 0)

    @property
    def total_missing(self) -> int:
        return sum(v.get('count', 0) for v in self.analysis.get('missing_values', {}).values())

    @property
    def total_outliers(self) -> int:
        return sum(v for v in self.analysis.get('outliers', {}).values() if isinstance(v, int))

    @property
    def quality_score(self) -> int:
        return self._calculate_quality_score(self.total_duplicates, self.total_missing)

    @property
    def rows(self) -> int:
        return self.analysis.get('rows', len(self.df))

    @property
    def cols(self) -> int:
        return self.analysis.get('columns', len(self.df.columns))

    # ── ANALYSE SÉMANTIQUE ────────────────────

    def _normalize(self, text: str) -> str:
        """Normalise le texte pour la comparaison"""
        text = text.lower().strip()
        # Supprime la ponctuation excessive mais garde les apostrophes
        text = re.sub(r'[?!.,;:]+', ' ', text)
        text = re.sub(r'\s+', ' ', text)
        return text

    def _detect_intents(self, question: str) -> List[Tuple[str, int]]:
        """Détecte toutes les intentions dans la question avec leur score"""
        q = self._normalize(question)
        scores: Dict[str, int] = {}

        for intent, config in INTENT_PATTERNS.items():
            score = 0
            weight = config.get('weight', 1)

            # Recherche des mots-clés
            for kw in config['keywords']:
                if kw in q:
                    score += weight

            # Bonus si question exacte reconnue
            for pattern in config.get('questions', []):
                if pattern in q:
                    score += weight * 3

            if score > 0:
                scores[intent] = score

        # Tri par score décroissant
        return sorted(scores.items(), key=lambda x: x[1], reverse=True)

    def _is_question_unclear(self, question: str, intents: List[Tuple[str, int]]) -> bool:
        """Détermine si la question est trop vague ou mal formulée"""
        q = question.strip()
        # Trop courte
        if len(q) < 5:
            return True
        # Aucune intention reconnue
        if not intents:
            return True
        # Score total trop faible
        total_score = sum(s for _, s in intents)
        if total_score < 1:
            return True
        return False

    def _detect_negation(self, question: str) -> bool:
        """Détecte si la question est négative (ex: 'pas de doublons ?')"""
        neg_words = ["pas de", "aucun", "aucune", "sans", "n'y a-t-il pas", "zéro", "rien"]
        q = question.lower()
        return any(n in q for n in neg_words)

    # ── RÉPONSE PRINCIPALE ────────────────────

    def answer_question(self, question: str) -> Dict:
        """Point d'entrée principal : analyse la question et retourne une réponse intelligente"""
        intents = self._detect_intents(question)
        is_unclear = self._is_question_unclear(question, intents)

        if is_unclear:
            return self._answer_unclear(question)

        # Multi-intentions : répondre à toutes
        if len(intents) > 1 and intents[0][1] >= 2:
            primary = intents[0][0]
            secondary = [i for i, _ in intents[1:3]]  # max 2 supplémentaires
            return self._answer_multi(question, primary, secondary)

        # Intention unique
        primary = intents[0][0]
        return self._dispatch(primary, question)

    def _dispatch(self, intent: str, question: str) -> Dict:
        """Route vers la bonne méthode selon l'intention"""
        dispatch_map = {
            'missing': self._answer_missing,
            'duplicates': self._answer_duplicates,
            'quality': self._answer_quality,
            'size': self._answer_size,
            'outliers': self._answer_outliers,
            'text': self._answer_text,
            'dates': self._answer_dates,
            'columns': self._answer_columns,
            'recommendations': self._answer_recommendations,
            'help': self._answer_help,
        }
        fn = dispatch_map.get(intent, self._answer_general)
        return fn()

    def _answer_multi(self, question: str, primary: str, secondaries: List[str]) -> Dict:
        """Répond à une question qui touche plusieurs sujets"""
        parts = []
        primary_result = self._dispatch(primary, question)
        parts.append(primary_result['answer'])

        for intent in secondaries:
            result = self._dispatch(intent, question)
            # Ajoute un séparateur visuel
            parts.append(f"\n{'─' * 30}\n{result['answer']}")

        suggestions = SUGGESTIONS_BY_INTENT.get(primary, [])

        return {
            'answer': '\n\n'.join(parts),
            'type': 'text',
            'multi': True,
            'suggestions': suggestions[:3]
        }

    # ── RÉPONSES SPÉCIALISÉES ─────────────────

    def _answer_missing(self) -> Dict:
        missing = self.analysis.get('missing_values', {})
        total = self.total_missing

        if total == 0:
            return {
                'answer': "✅ **Aucune valeur manquante** dans votre dataset !\n\nToutes vos cellules sont renseignées. C'est excellent pour la qualité de vos données.",
                'type': 'text',
                'suggestions': ["Y a-t-il des doublons ?", "Quelle est la qualité globale ?", "Y a-t-il des valeurs aberrantes ?"]
            }

        top = sorted(missing.items(), key=lambda x: x[1]['count'], reverse=True)
        total_cells = self.rows * self.cols
        pct_global = round((total / total_cells) * 100, 2)

        response = f"⚠️ **{total} valeurs manquantes** détectées ({pct_global}% du dataset)\n\n"
        response += f"📋 **Détail par colonne ({len(missing)} affectée{'s' if len(missing) > 1 else ''}) :**\n"

        for col, info in top:
            bar = self._make_bar(info['percentage'], 10)
            severity = "🔴" if info['percentage'] > 30 else "🟡" if info['percentage'] > 10 else "🟢"
            response += f"\n{severity} **{col}**\n"
            response += f"   {bar} {info['count']} cellules ({info['percentage']}%)\n"

        response += f"\n💡 **Méthode recommandée :**\n"
        response += f"• Colonnes numériques → remplacement par la **médiane**\n"
        response += f"• Colonnes texte → remplacement par le **mode** (valeur la plus fréquente)\n"

        if pct_global > 20:
            response += f"\n⚠️ **Attention :** {pct_global}% de données manquantes, pensez à vérifier la source."

        return {
            'answer': response,
            'type': 'text',
            'score_impact': f"-{min(40, round(pct_global * 2))} pts sur le score qualité",
            'suggestions': [
                "Comment corriger ces valeurs manquantes ?",
                "Quelle est la qualité globale de mes données ?",
                "Y a-t-il aussi des doublons ?"
            ]
        }

    def _answer_duplicates(self) -> Dict:
        dup = self.analysis.get('duplicates', {})
        exact = dup.get('exact_duplicates', 0)
        struct = dup.get('structural_duplicates', 0)
        total = exact + struct
        used_cols = dup.get('used_columns', [])

        if total == 0:
            return {
                'answer': "✅ **Aucun doublon** détecté dans vos données !\n\nChaque entrée est unique. Votre dataset est propre sur ce point.",
                'type': 'text',
                'suggestions': ["Y a-t-il des valeurs manquantes ?", "Quelle est la qualité globale ?"]
            }

        pct = round((total / self.rows) * 100, 1)
        severity = "🔴 Critique" if pct > 10 else "🟡 Modéré" if pct > 3 else "🟢 Faible"

        response = f"🔍 **{total} doublon{'s' if total > 1 else ''} détecté{'s' if total > 1 else ''}** ({pct}% du dataset)\n\n"
        response += f"📊 **Détail :**\n"
        response += f"• Doublons exacts (ligne identique) : **{exact}**\n"
        response += f"• Doublons structurels (combinaison de champs) : **{struct}**\n"

        if used_cols:
            response += f"\n🔑 **Colonnes clés analysées :**\n"
            for col in used_cols[:8]:
                response += f"  · {col}\n"

        response += f"\n⚡ **Niveau de risque :** {severity}\n"
        response += f"\n💡 La suppression des doublons garantit l'unicité de vos enregistrements et améliore la fiabilité des analyses."

        return {
            'answer': response,
            'type': 'text',
            'suggestions': [
                "Quelle est la qualité globale de mes données ?",
                "Y a-t-il aussi des valeurs manquantes ?",
                "Que me recommandes-tu de faire en priorité ?"
            ]
        }

    def _answer_quality(self) -> Dict:
        score = self.quality_score
        total_cells = self.rows * self.cols

        if score >= 90:
            verdict = "🏆 **Excellente qualité**"
            color = "🟢"
            message = "Vos données sont en très bon état. Un nettoyage léger peut encore les améliorer."
        elif score >= 75:
            verdict = "✅ **Bonne qualité**"
            color = "🟡"
            message = "Quelques corrections sont recommandées avant d'utiliser ces données en production."
        elif score >= 50:
            verdict = "⚠️ **Qualité moyenne**"
            color = "🟠"
            message = "Un nettoyage est fortement conseillé avant toute analyse."
        else:
            verdict = "🚨 **Qualité insuffisante**"
            color = "🔴"
            message = "Nettoyage urgent requis. Ces données peuvent fausser vos analyses."

        response = f"🎯 **Score de qualité : {score}/100** {color}\n\n"
        response += f"{verdict}\n{message}\n\n"
        response += f"📊 **Vue d'ensemble du dataset :**\n"
        response += f"• Dimensions : {self.rows:,} lignes × {self.cols} colonnes ({total_cells:,} cellules)\n"

        # Problèmes détectés
        issues_found = []
        if self.total_duplicates > 0:
            pct = round(self.total_duplicates / self.rows * 100, 1)
            issues_found.append(f"❌ {self.total_duplicates} doublon{'s' if self.total_duplicates > 1 else ''} ({pct}%)")
        if self.total_missing > 0:
            pct = round(self.total_missing / total_cells * 100, 1)
            issues_found.append(f"⚠️ {self.total_missing} valeur{'s' if self.total_missing > 1 else ''} manquante{'s' if self.total_missing > 1 else ''} ({pct}%)")
        if self.total_outliers > 0:
            issues_found.append(f"📊 {self.total_outliers} valeur{'s' if self.total_outliers > 1 else ''} aberrante{'s' if self.total_outliers > 1 else ''}")

        text_issues = self.analysis.get('text_issues', {})
        if text_issues:
            total_text = sum(
                v.get('emojis', 0) + v.get('specialChars', 0) + v.get('spaces', 0)
                for v in text_issues.values()
            )
            if total_text > 0:
                issues_found.append(f"📝 {total_text} problème{'s' if total_text > 1 else ''} de texte")

        date_issues = self.analysis.get('date_formats', {})
        if date_issues:
            issues_found.append(f"📅 {len(date_issues)} colonne{'s' if len(date_issues) > 1 else ''} avec formats de date incohérents")

        if issues_found:
            response += f"\n🔎 **Problèmes identifiés :**\n"
            for issue in issues_found:
                response += f"  • {issue}\n"
        else:
            response += "\n✅ Aucun problème majeur détecté."

        response += f"\n\n💡 Tapez **'recommande-moi des actions'** pour obtenir un plan de nettoyage personnalisé."

        return {
            'answer': response,
            'type': 'text',
            'score': score,
            'suggestions': [
                "Que me recommandes-tu de faire ?",
                "Détaille-moi les valeurs manquantes",
                "Y a-t-il des valeurs aberrantes ?"
            ]
        }

    def _answer_size(self) -> Dict:
        total_cells = self.rows * self.cols
        col_types = self.analysis.get('column_types', {})

        numeric_cols = [c for c, t in col_types.items() if t == 'numeric']
        text_cols = [c for c, t in col_types.items() if t == 'text']
        date_cols = [c for c, t in col_types.items() if 'date' in t]

        if self.rows < 1_000:
            volume = "🟢 Petit dataset (traitement instantané)"
        elif self.rows < 100_000:
            volume = "🟡 Dataset moyen (traitement rapide)"
        elif self.rows < 1_000_000:
            volume = "🟠 Grand dataset (quelques secondes)"
        else:
            volume = "🔴 Très grand dataset (traitement long)"

        response = f"📐 **Dimensions de votre dataset :**\n\n"
        response += f"• **{self.rows:,} lignes** × **{self.cols} colonnes**\n"
        response += f"• Total : **{total_cells:,} cellules**\n"
        response += f"• Volume : {volume}\n"

        if col_types:
            response += f"\n📋 **Répartition des types de colonnes :**\n"
            if numeric_cols:
                response += f"  · Numériques ({len(numeric_cols)}) : {', '.join(numeric_cols[:5])}"
                if len(numeric_cols) > 5:
                    response += f" ... +{len(numeric_cols) - 5}"
                response += "\n"
            if text_cols:
                response += f"  · Texte ({len(text_cols)}) : {', '.join(text_cols[:5])}"
                if len(text_cols) > 5:
                    response += f" ... +{len(text_cols) - 5}"
                response += "\n"
            if date_cols:
                response += f"  · Dates ({len(date_cols)}) : {', '.join(date_cols)}\n"

        return {
            'answer': response,
            'type': 'text',
            'suggestions': [
                "Quelles sont les colonnes disponibles ?",
                "Y a-t-il des valeurs manquantes ?",
                "Quelle est la qualité globale ?"
            ]
        }

    def _answer_outliers(self) -> Dict:
        outliers = self.analysis.get('outliers', {})
        total = self.total_outliers

        if total == 0:
            return {
                'answer': "✅ **Aucune valeur aberrante** détectée dans les colonnes numériques !\n\nToutes vos valeurs numériques sont dans des plages statistiquement normales.",
                'type': 'text',
                'suggestions': ["Y a-t-il des valeurs manquantes ?", "Quelle est la qualité globale ?"]
            }

        response = f"📊 **{total} valeur{'s' if total > 1 else ''} aberrante{'s' if total > 1 else ''} détectée{'s' if total > 1 else ''}**\n\n"
        response += f"🔬 **Méthode :** Règle IQR (Q1 - 1.5×IQR  /  Q3 + 1.5×IQR)\n\n"
        response += f"📋 **Détail par colonne :**\n"

        for col, count in sorted(outliers.items(), key=lambda x: x[1], reverse=True):
            pct = round(count / self.rows * 100, 1)
            severity = "🔴" if pct > 10 else "🟡" if pct > 3 else "🟢"
            response += f"\n{severity} **{col}** : {count} valeur{'s' if count > 1 else ''} ({pct}%)\n"

        response += f"\n💡 **Méthodes de traitement disponibles :**\n"
        response += f"  · **Médiane** ✅ (recommandé) — remplace par la valeur centrale\n"
        response += f"  · **Plafonnement** — limite aux bornes IQR\n"
        response += f"  · **Indicateur** — ajoute une colonne '_is_outlier'\n"
        response += f"  · **Suppression** ⚠️ — risque de perte de données\n"

        return {
            'answer': response,
            'type': 'text',
            'suggestions': [
                "Quelle méthode pour traiter les outliers ?",
                "Y a-t-il aussi des valeurs manquantes ?",
                "Quelle est la qualité globale ?"
            ]
        }

    def _answer_text(self) -> Dict:
        issues = self.analysis.get('text_issues', {})

        if not issues:
            return {
                'answer': "✅ **Aucun problème de texte** détecté dans vos données !\n\nVos colonnes texte sont propres : pas d'emojis, caractères spéciaux ou espaces superflus.",
                'type': 'text',
                'suggestions': ["Y a-t-il des doublons ?", "Quelle est la qualité globale ?"]
            }

        total_emojis = sum(v.get('emojis', 0) for v in issues.values())
        total_special = sum(v.get('specialChars', 0) for v in issues.values())
        total_spaces = sum(v.get('spaces', 0) for v in issues.values())
        total_case = sum(v.get('inconsistentCase', 0) for v in issues.values())
        total_all = total_emojis + total_special + total_spaces + total_case

        response = f"📝 **{total_all} problème{'s' if total_all > 1 else ''} de texte** détecté{'s' if total_all > 1 else ''}\n\n"
        response += f"📋 **Résumé des types :**\n"
        if total_emojis: response += f"  · 😀 Emojis : {total_emojis}\n"
        if total_special: response += f"  · 🔣 Caractères spéciaux : {total_special}\n"
        if total_spaces: response += f"  · ⎵ Espaces superflus : {total_spaces}\n"
        if total_case: response += f"  · 🔤 Casse incohérente : {total_case}\n"

        response += f"\n📂 **Par colonne :**\n"
        for col, v in issues.items():
            col_total = v.get('emojis', 0) + v.get('specialChars', 0) + v.get('spaces', 0) + v.get('inconsistentCase', 0)
            response += f"\n  **{col}** ({col_total} problèmes)\n"
            if v.get('emojis', 0): response += f"    · {v['emojis']} emojis\n"
            if v.get('specialChars', 0): response += f"    · {v['specialChars']} caractères spéciaux\n"
            if v.get('spaces', 0): response += f"    · {v['spaces']} espaces inutiles\n"
            if v.get('inconsistentCase', 0): response += f"    · {v['inconsistentCase']} casses mixtes\n"

        response += f"\n💡 Le nettoyage texte et la normalisation de casse régleront ces problèmes automatiquement."

        return {
            'answer': response,
            'type': 'text',
            'suggestions': [
                "Quelle est la qualité globale ?",
                "Que me recommandes-tu en priorité ?",
                "Y a-t-il des valeurs manquantes ?"
            ]
        }

    def _answer_dates(self) -> Dict:
        dates = self.analysis.get('date_formats', {})

        if not dates:
            return {
                'answer': "✅ **Aucun problème de format de date** détecté !\n\nVos colonnes de dates utilisent un format cohérent.",
                'type': 'text',
                'suggestions': ["Y a-t-il des valeurs manquantes ?", "Quelle est la qualité globale ?"]
            }

        response = f"📅 **{len(dates)} colonne{'s' if len(dates) > 1 else ''} avec des formats de date incohérents**\n\n"
        for col, formats in dates.items():
            response += f"  **{col}** :\n"
            for fmt in formats:
                response += f"    · `{fmt}`\n"

        response += f"\n⚠️ Des formats différents dans une même colonne peuvent fausser les tris et calculs temporels.\n"
        response += f"\n💡 L'harmonisation convertira tout au format standard **YYYY-MM-DD** (ISO 8601)."

        return {
            'answer': response,
            'type': 'text',
            'suggestions': [
                "Quelle est la qualité globale ?",
                "Que me recommandes-tu en priorité ?"
            ]
        }

    def _answer_columns(self) -> Dict:
        col_types = self.analysis.get('column_types', {})
        missing = self.analysis.get('missing_values', {})
        outliers = self.analysis.get('outliers', {})
        text_issues = self.analysis.get('text_issues', {})

        response = f"📋 **{self.cols} colonnes disponibles :**\n\n"

        type_icons = {
            'numeric': '🔢',
            'text': '📄',
            'datetime': '📅',
            'date_string': '🗓️'
        }

        for col, ctype in col_types.items():
            icon = type_icons.get(ctype, '❓')
            flags = []
            if col in missing:
                flags.append(f"⚠️ {missing[col]['count']} manquants")
            if col in outliers:
                flags.append(f"📊 {outliers[col]} outliers")
            if col in text_issues:
                n = sum(text_issues[col].values())
                flags.append(f"📝 {n} prob. texte")

            flag_str = f"  →  {', '.join(flags)}" if flags else ""
            response += f"  {icon} **{col}** `({ctype})`{flag_str}\n"

        return {
            'answer': response,
            'type': 'text',
            'suggestions': [
                "Y a-t-il des valeurs manquantes ?",
                "Quelle est la qualité globale ?",
                "Y a-t-il des valeurs aberrantes ?"
            ]
        }

    def _answer_recommendations(self) -> Dict:
        recs = self.generate_recommendations()

        if not recs:
            return {
                'answer': "🎉 **Aucune action recommandée !**\n\nVos données semblent propres. Vous pouvez les utiliser en l'état.",
                'type': 'text'
            }

        response = f"💡 **Plan de nettoyage recommandé** (score actuel : {self.quality_score}/100)\n\n"

        priority_icons = {'haute': '🔴', 'moyenne': '🟡', 'basse': '🟢'}
        for i, rec in enumerate(recs, 1):
            icon = priority_icons.get(rec['priority'], '⚪')
            response += f"{icon} **{i}. {rec['title']}**\n"
            response += f"   Impact : {rec['impact']}\n"
            response += f"   Priorité : {rec['priority'].upper()}\n\n"

        response += f"📈 **Gain estimé après nettoyage :** +{min(30, len(recs) * 8)} pts sur le score qualité"

        return {
            'answer': response,
            'type': 'text',
            'suggestions': [
                "Détaille-moi les valeurs manquantes",
                "Y a-t-il des valeurs aberrantes ?",
                "Quelle est la qualité globale ?"
            ]
        }

    def _answer_help(self) -> Dict:
        response = "🤖 **Je suis votre assistant de qualité de données !**\n\n"
        response += "Voici ce que je sais analyser :\n\n"
        response += "📊 **Qualité globale**\n  → *'Quelle est la qualité de mes données ?'*\n\n"
        response += "⚠️ **Valeurs manquantes**\n  → *'Y a-t-il des valeurs manquantes ?'*\n\n"
        response += "🔍 **Doublons**\n  → *'Combien de doublons ?'*\n\n"
        response += "📈 **Valeurs aberrantes**\n  → *'Y a-t-il des outliers ?'*\n\n"
        response += "📝 **Problèmes de texte**\n  → *'Des emojis ou caractères spéciaux ?'*\n\n"
        response += "📅 **Formats de dates**\n  → *'Les dates sont-elles cohérentes ?'*\n\n"
        response += "📋 **Colonnes**\n  → *'Liste-moi les colonnes'*\n\n"
        response += "💡 **Recommandations**\n  → *'Que me recommandes-tu ?'*\n\n"
        response += "Je peux aussi répondre à des questions combinées !\n"
        response += "*Ex : 'Y a-t-il des doublons et des valeurs manquantes ?'*"

        return {
            'answer': response,
            'type': 'text',
            'suggestions': [
                "Quelle est la qualité globale ?",
                "Y a-t-il des valeurs manquantes ?",
                "Que me recommandes-tu ?"
            ]
        }

    def _answer_unclear(self, question: str) -> Dict:
        """Répond intelligemment aux questions mal formulées"""
        q = question.strip()

        # Trop courte
        if len(q) < 5:
            response = "🤔 **Question trop courte** — Pouvez-vous préciser ?\n\n"
        else:
            response = f"🤔 **Je n'ai pas bien compris** votre question : *\"{q}\"*\n\n"

        response += "Voici ce que je sais faire :\n\n"
        response += "• *'Quelle est la qualité de mes données ?'*\n"
        response += "• *'Y a-t-il des valeurs manquantes ?'*\n"
        response += "• *'Combien de doublons ?'*\n"
        response += "• *'Y a-t-il des valeurs aberrantes ?'*\n"
        response += "• *'Liste-moi les colonnes'*\n"
        response += "• *'Que me recommandes-tu ?'*\n\n"
        response += "💡 Tapez **'aide'** pour voir toutes mes capacités."

        return {
            'answer': response,
            'type': 'text',
            'unclear': True,
            'suggestions': [
                "Quelle est la qualité globale ?",
                "Y a-t-il des valeurs manquantes ?",
                "Que me recommandes-tu de faire ?"
            ]
        }

    def _answer_general(self) -> Dict:
        """Réponse générale avec aperçu complet"""
        score = self.quality_score
        issues = []
        if self.total_duplicates > 0:
            issues.append(f"{self.total_duplicates} doublons")
        if self.total_missing > 0:
            issues.append(f"{self.total_missing} valeurs manquantes")
        if self.total_outliers > 0:
            issues.append(f"{self.total_outliers} outliers")

        response = f"📊 **Aperçu de votre dataset**\n\n"
        response += f"• {self.rows:,} lignes × {self.cols} colonnes\n"
        response += f"• Score qualité : **{score}/100**\n"

        if issues:
            response += f"• Problèmes : {', '.join(issues)}\n"
        else:
            response += f"• ✅ Aucun problème majeur détecté\n"

        response += f"\n💡 Exemples de questions :\n"
        response += f"  · *'Y a-t-il des valeurs manquantes ?'*\n"
        response += f"  · *'Que me recommandes-tu ?'*\n"
        response += f"  · *'Quelle est la qualité globale ?'*"

        return {
            'answer': response,
            'type': 'text',
            'suggestions': [
                "Quelle est la qualité globale ?",
                "Que me recommandes-tu ?",
                "Y a-t-il des valeurs manquantes ?"
            ]
        }

    # ── UTILITAIRES ───────────────────────────

    def _make_bar(self, percentage: float, width: int = 10) -> str:
        """Crée une barre de progression textuelle"""
        filled = int((percentage / 100) * width)
        empty = width - filled
        return f"[{'█' * filled}{'░' * empty}]"

    # ── RECOMMANDATIONS ───────────────────────

    def generate_recommendations(self) -> List[Dict]:
        """Génère des recommandations intelligentes triées par priorité"""
        recommendations = []

        # 1. Doublons
        if self.total_duplicates > 0:
            dup = self.analysis.get('duplicates', {})
            severity = (self.total_duplicates / self.rows) * 100
            recommendations.append({
                'action': 'duplicates',
                'priority': 'haute' if severity > 5 else 'moyenne',
                'title': '🔍 Suppression des doublons',
                'justification': self._justify_duplicates(dup, severity),
                'impact': f"{self.total_duplicates} lignes ({severity:.1f}%)",
                'recommended': True
            })

        # 2. Valeurs manquantes
        if self.total_missing > 0:
            recommendations.append({
                'action': 'missing_values',
                'priority': 'haute',
                'title': '❓ Valeurs manquantes',
                'justification': self._justify_missing(
                    self.analysis.get('missing_values', {}), self.total_missing
                ),
                'impact': f"{self.total_missing} cellules",
                'recommended': True
            })

        # 3. Outliers
        if self.total_outliers > 0:
            recommendations.append({
                'action': 'outliers',
                'priority': 'moyenne',
                'title': '📊 Valeurs aberrantes',
                'justification': self._justify_outliers(
                    self.analysis.get('outliers', {}), self.total_outliers
                ),
                'impact': f"{self.total_outliers} valeurs",
                'recommended': self.total_outliers > 10,
                'method_suggestion': 'median'
            })

        # 4. Texte
        text_issues = self.analysis.get('text_issues', {})
        if text_issues:
            total_text = self._count_text_issues(text_issues)
            recommendations.append({
                'action': 'text_cleaning',
                'priority': 'basse',
                'title': '📝 Nettoyage texte',
                'justification': self._justify_text(text_issues),
                'impact': f"{total_text} corrections",
                'recommended': total_text > 10
            })

        # 5. Dates
        date_issues = self.analysis.get('date_formats', {})
        if date_issues:
            recommendations.append({
                'action': 'date_format',
                'priority': 'moyenne',
                'title': '📅 Harmonisation dates',
                'justification': f"{len(date_issues)} colonne(s) avec formats incohérents",
                'impact': f"{len(date_issues)} colonne(s)",
                'recommended': True
            })

        # 6. Casse
        case_count = sum(
            v.get('inconsistentCase', 0)
            for v in text_issues.values()
        ) if text_issues else 0
        if case_count > 0:
            recommendations.append({
                'action': 'case_normalization',
                'priority': 'basse',
                'title': '🔤 Normalisation de la casse',
                'justification': f"{case_count} cellule(s) avec casses incohérentes",
                'impact': f"{case_count} corrections",
                'recommended': case_count > 5
            })

        return sorted(
            recommendations,
            key=lambda x: {'haute': 3, 'moyenne': 2, 'basse': 1}[x['priority']],
            reverse=True
        )

    # ── JUSTIFICATIONS ────────────────────────

    def _justify_duplicates(self, dup: Dict, severity: float) -> str:
        exact = dup.get('exact_duplicates', 0)
        struct = dup.get('structural_duplicates', 0)
        return (
            f"**Détails :** {exact} doublons exacts + {struct} structurels.\n\n"
            f"**Impact :** {severity:.1f}% de vos données.\n\n"
            f"💡 **Pourquoi ?** Garantit l'unicité et évite les biais dans les analyses."
        )

    def _justify_missing(self, missing: Dict, total: int) -> str:
        top = sorted(missing.items(), key=lambda x: x[1]['count'], reverse=True)[:3]
        text = f"**Détails :** {total} cellules vides.\n\n**Top colonnes :**\n"
        for col, info in top:
            text += f"• {col}: {info['count']} ({info['percentage']}%)\n"
        text += "\n💡 **Méthode :** Médiane pour le numérique, Mode pour le texte."
        return text

    def _justify_outliers(self, outliers: Dict, total: int) -> str:
        cols = list(outliers.keys())[:3]
        return (
            f"**Détails :** {total} valeurs extrêmes dans {', '.join(cols)}{'...' if len(outliers) > 3 else ''}.\n\n"
            f"💡 **Recommandation :** Méthode 'médiane' pour préserver toutes les lignes."
        )

    def _justify_text(self, issues: Dict) -> str:
        emojis = sum(v.get('emojis', 0) for v in issues.values())
        special = sum(v.get('specialChars', 0) for v in issues.values())
        spaces = sum(v.get('spaces', 0) for v in issues.values())
        return (
            f"**Problèmes :** {emojis} emojis, {special} caractères spéciaux, {spaces} espaces.\n\n"
            f"💡 Évite les problèmes d'encodage et améliore la cohérence des données."
        )

    def _count_text_issues(self, issues: Dict) -> int:
        return sum(
            v.get('emojis', 0) + v.get('specialChars', 0) + v.get('spaces', 0)
            for v in issues.values()
        )

    def _calculate_quality_score(self, dup: int, missing: int) -> int:
        total_cells = self.rows * self.cols
        if total_cells == 0:
            return 100
        dup_penalty = min((dup / max(self.rows, 1)) * 30, 30)
        missing_penalty = min((missing / total_cells) * 40, 40)
        return max(0, int(100 - dup_penalty - missing_penalty))