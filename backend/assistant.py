
"""
Module d'Assistant Intelligent pour l'analyse et les recommandations
"""
import pandas as pd
from typing import Dict, List, Any


class DataAssistant:
    """Assistant qui analyse les données et génère des recommandations"""

    def __init__(self, df: pd.DataFrame, analysis: Dict):
        self.df = df
        self.analysis = analysis

    def generate_recommendations(self) -> List[Dict]:
        """Génère des recommandations intelligentes avec justifications"""
        recommendations = []

        # 1. Doublons
        dup = self.analysis.get('duplicates', {})
        total_dup = dup.get('exact_duplicates', 0) + dup.get('structural_duplicates', 0)
        if total_dup > 0:
            severity = (total_dup / len(self.df)) * 100
            recommendations.append({
                'action': 'duplicates',
                'priority': 'haute' if severity > 5 else 'moyenne',
                'title': '🔍 Suppression des doublons',
                'justification': self._justify_duplicates(dup, severity),
                'impact': f"{total_dup} lignes à supprimer ({severity:.1f}%)",
                'recommended': True
            })

        # 2. Valeurs manquantes
        missing = self.analysis.get('missing_values', {})
        total_missing = sum(v.get('count', 0) for v in missing.values())
        if total_missing > 0:
            recommendations.append({
                'action': 'missing_values',
                'priority': 'haute',
                'title': '❓ Correction des valeurs manquantes',
                'justification': self._justify_missing(missing, total_missing),
                'impact': f"{total_missing} cellules à corriger",
                'recommended': True
            })

        # 3. Outliers
        outliers = self.analysis.get('outliers', {})
        total_outliers = sum(v for v in outliers.values() if isinstance(v, int))
        if total_outliers > 0:
            recommendations.append({
                'action': 'outliers',
                'priority': 'moyenne',
                'title': '📊 Traitement des valeurs aberrantes',
                'justification': self._justify_outliers(outliers, total_outliers),
                'impact': f"{total_outliers} valeurs aberrantes détectées",
                'recommended': total_outliers > 10,
                'method_suggestion': 'median'
            })

        # 4. Texte
        text_issues = self.analysis.get('text_issues', {})
        if text_issues:
            total_text = self._count_text_issues(text_issues)
            recommendations.append({
                'action': 'text_cleaning',
                'priority': 'basse',
                'title': '📝 Normalisation des textes',
                'justification': self._justify_text(text_issues),
                'impact': f"{total_text} corrections nécessaires",
                'recommended': total_text > 10
            })

        # 5. Dates
        dates = self.analysis.get('date_formats', {})
        if dates:
            recommendations.append({
                'action': 'date_format',
                'priority': 'moyenne',
                'title': '📅 Harmonisation des dates',
                'justification': f"{len(dates)} colonnes avec formats incohérents",
                'impact': 'Formats standardisés ISO 8601',
                'recommended': True
            })

        return sorted(recommendations,
                      key=lambda x: {'haute': 3, 'moyenne': 2, 'basse': 1}[x['priority']],
                      reverse=True)

    def _justify_duplicates(self, dup: Dict, severity: float) -> str:
        exact = dup.get('exact_duplicates', 0)
        struct = dup.get('structural_duplicates', 0)

        text = f"**Analyse détaillée :**\n"
        text += f"• {exact} doublons exacts (lignes identiques)\n"
        text += f"• {struct} doublons structurels (contenu similaire)\n"
        text += f"• Impact : {severity:.1f}% de vos données\n\n"

        if severity > 10:
            text += "⚠️ **Impact CRITIQUE** : Ces doublons faussent vos analyses\n"
        text += "💡 **Pourquoi nettoyer** : Garantit l'unicité et réduit la taille du fichier"
        return text

    def _justify_missing(self, missing: Dict, total: int) -> str:
        text = f"**Analyse détaillée :**\n"
        text += f"• {total} valeurs manquantes\n"
        text += f"• {len(missing)} colonnes affectées\n\n"

        top_cols = sorted(missing.items(), key=lambda x: x[1]['count'], reverse=True)[:3]
        text += "**Top 3 colonnes :**\n"
        for col, info in top_cols:
            text += f"  • {col}: {info['count']} valeurs ({info['percentage']}%)\n"

        text += "\n💡 **Méthode** : Remplissage par médiane (numériques) ou mode (textes)"
        return text

    def _justify_outliers(self, outliers: Dict, total: int) -> str:
        text = f"**Analyse détaillée :**\n"
        text += f"• {total} valeurs aberrantes détectées\n"
        text += f"• {len(outliers)} colonnes numériques affectées\n\n"

        text += "💡 **Recommandation** : Méthode 'médiane' (conserve toutes les lignes)\n"
        text += "⚠️ **Alternative** : 'remove' supprime les lignes (perte de données)"
        return text

    def _justify_text(self, issues: Dict) -> str:
        emojis = sum(v.get('emojis', 0) for v in issues.values())
        special = sum(v.get('specialChars', 0) for v in issues.values())

        text = "**Problèmes détectés :**\n"
        if emojis > 0:
            text += f"• {emojis} emojis\n"
        if special > 0:
            text += f"• {special} caractères spéciaux\n"

        text += "\n💡 **Impact** : Évite les problèmes d'encodage et normalise le format"
        return text

    def _count_text_issues(self, issues: Dict) -> int:
        total = 0
        for v in issues.values():
            total += v.get('emojis', 0) + v.get('specialChars', 0) + v.get('spaces', 0)
        return total

    def answer_question(self, question: str) -> Dict:
        """Répond aux questions de l'utilisateur"""
        q = question.lower()

        # Questions sur la taille
        if any(word in q for word in ['combien', 'nombre', 'lignes', 'colonnes']):
            return self._answer_size()

        # Questions sur la qualité
        elif any(word in q for word in ['qualité', 'problème', 'nettoyer']):
            return self._answer_quality()

        # Questions sur les doublons
        elif 'doublon' in q:
            return self._answer_duplicates()

        # Question générale
        return self._answer_general()

    def _answer_size(self) -> Dict:
        rows = self.analysis['rows']
        cols = self.analysis['columns']

        response = f"📊 **Vos données :**\n\n"
        response += f"• {rows:,} lignes\n"
        response += f"• {cols} colonnes\n"
        response += f"• {rows * cols:,} cellules au total\n\n"

        if rows < 10000:
            response += "✅ Dataset de taille raisonnable, traitement rapide"
        else:
            response += "⚡ Large dataset, traitement peut prendre quelques secondes"

        return {'answer': response, 'type': 'text'}

    def _answer_quality(self) -> Dict:
        dup = self.analysis.get('duplicates', {})
        missing = self.analysis.get('missing_values', {})

        total_dup = dup.get('exact_duplicates', 0) + dup.get('structural_duplicates', 0)
        total_missing = sum(v.get('count', 0) for v in missing.values())

        score = self._calculate_quality_score(total_dup, total_missing)

        response = f"🎯 **Score de qualité : {score}/100**\n\n"
        response += "**Problèmes détectés :**\n"
        if total_dup > 0:
            response += f"• ❌ {total_dup} doublons\n"
        if total_missing > 0:
            response += f"• ⚠️ {total_missing} valeurs manquantes\n"

        if score >= 80:
            response += "\n✅ Excellente qualité !"
        elif score >= 60:
            response += "\n⚡ Qualité correcte, améliorations possibles"
        else:
            response += "\n⚠️ Nettoyage fortement recommandé"

        return {'answer': response, 'type': 'text', 'score': score}

    def _answer_duplicates(self) -> Dict:
        dup = self.analysis.get('duplicates', {})
        exact = dup.get('exact_duplicates', 0)
        struct = dup.get('structural_duplicates', 0)

        response = f"🔍 **Analyse des doublons :**\n\n"
        response += f"• Doublons exacts : {exact}\n"
        response += f"• Doublons structurels : {struct}\n"
        response += f"• **Total : {exact + struct}**\n\n"

        if exact + struct > 0:
            pct = (exact + struct) / self.analysis['rows'] * 100
            response += f"📊 Représente {pct:.1f}% de vos données\n\n"
            response += "💡 Recommandation : Supprimez-les pour améliorer la qualité"
        else:
            response += "✅ Aucun doublon ! Vos données sont uniques"

        return {'answer': response, 'type': 'text'}

    def _answer_general(self) -> Dict:
        response = f"📊 **Résumé :**\n\n"
        response += f"• {self.analysis['rows']:,} lignes\n"
        response += f"• {self.analysis['columns']} colonnes\n\n"
        response += "💡 Posez-moi des questions spécifiques :\n"
        response += "  • 'Combien de lignes ?'\n"
        response += "  • 'Quelle est la qualité ?'\n"
        response += "  • 'Y a-t-il des doublons ?'"

        return {'answer': response, 'type': 'text'}

    def _calculate_quality_score(self, dup: int, missing: int) -> int:
        total_cells = self.analysis['rows'] * self.analysis['columns']

        dup_penalty = min((dup / self.analysis['rows']) * 30, 30)
        missing_penalty = min((missing / total_cells) * 40, 40)

        return max(0, int(100 - dup_penalty - missing_penalty))