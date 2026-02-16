# backend/assistant.py
"""Module d'Assistant Intelligent"""
import pandas as pd
from typing import Dict, List


class DataAssistant:
    """Assistant qui analyse les données et génère des recommandations"""

    def __init__(self, df: pd.DataFrame, analysis: Dict):
        self.df = df
        self.analysis = analysis

    def generate_recommendations(self) -> List[Dict]:
        """Génère des recommandations intelligentes"""
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
                'impact': f"{total_dup} lignes ({severity:.1f}%)",
                'recommended': True
            })

        # 2. Valeurs manquantes
        missing = self.analysis.get('missing_values', {})
        total_missing = sum(v.get('count', 0) for v in missing.values())
        if total_missing > 0:
            recommendations.append({
                'action': 'missing_values',
                'priority': 'haute',
                'title': '❓ Valeurs manquantes',
                'justification': self._justify_missing(missing, total_missing),
                'impact': f"{total_missing} cellules",
                'recommended': True
            })

        # 3. Outliers
        outliers = self.analysis.get('outliers', {})
        total_outliers = sum(v for v in outliers.values() if isinstance(v, int))
        if total_outliers > 0:
            recommendations.append({
                'action': 'outliers',
                'priority': 'moyenne',
                'title': '📊 Valeurs aberrantes',
                'justification': self._justify_outliers(outliers, total_outliers),
                'impact': f"{total_outliers} valeurs",
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
                'title': '📝 Nettoyage texte',
                'justification': self._justify_text(text_issues),
                'impact': f"{total_text} corrections",
                'recommended': total_text > 10
            })

        # 5. Dates
        dates = self.analysis.get('date_formats', {})
        if dates:
            recommendations.append({
                'action': 'date_format',
                'priority': 'moyenne',
                'title': '📅 Harmonisation dates',
                'justification': f"{len(dates)} colonnes avec formats incohérents",
                'impact': f"{len(dates)} colonnes",
                'recommended': True
            })

        return sorted(recommendations,
                     key=lambda x: {'haute': 3, 'moyenne': 2, 'basse': 1}[x['priority']],
                     reverse=True)

    def _justify_duplicates(self, dup: Dict, severity: float) -> str:
        exact = dup.get('exact_duplicates', 0)
        struct = dup.get('structural_duplicates', 0)
        return f"**Détails :** {exact} doublons exacts + {struct} structurels.\n\n**Impact :** {severity:.1f}% de vos données.\n\n💡 **Pourquoi ?** Garantit l'unicité."

    def _justify_missing(self, missing: Dict, total: int) -> str:
        top = sorted(missing.items(), key=lambda x: x[1]['count'], reverse=True)[:3]
        text = f"**Détails :** {total} cellules vides.\n\n**Top colonnes :**\n"
        for col, info in top:
            text += f"• {col}: {info['count']} ({info['percentage']}%)\n"
        text += "\n💡 **Méthode :** Médiane/Mode"
        return text

    def _justify_outliers(self, outliers: Dict, total: int) -> str:
        return f"**Détails :** {total} valeurs extrêmes.\n\n💡 **Recommandation :** Méthode 'médiane'."

    def _justify_text(self, issues: Dict) -> str:
        emojis = sum(v.get('emojis', 0) for v in issues.values())
        special = sum(v.get('specialChars', 0) for v in issues.values())
        return f"**Problèmes :** {emojis} emojis, {special} caractères spéciaux.\n\n💡 Évite les problèmes d'encodage."

    def _count_text_issues(self, issues: Dict) -> int:
        return sum(
            v.get('emojis', 0) + v.get('specialChars', 0) + v.get('spaces', 0)
            for v in issues.values()
        )

    def answer_question(self, question: str) -> Dict:
        """Répond aux questions"""
        q = question.lower()

        if any(w in q for w in ['combien', 'nombre', 'lignes', 'colonnes']):
            return self._answer_size()
        elif any(w in q for w in ['qualité', 'score']):
            return self._answer_quality()
        elif 'doublon' in q:
            return self._answer_duplicates()
        else:
            return self._answer_general()

    def _answer_size(self) -> Dict:
        rows, cols = self.analysis['rows'], self.analysis['columns']
        response = f"📊 **Vos données :**\n\n• {rows:,} lignes\n• {cols} colonnes\n• {rows*cols:,} cellules\n\n"
        response += "✅ Traitement rapide" if rows < 10000 else "⚡ Quelques secondes"
        return {'answer': response, 'type': 'text'}

    def _answer_quality(self) -> Dict:
        dup = self.analysis.get('duplicates', {})
        missing = self.analysis.get('missing_values', {})
        total_dup = dup.get('exact_duplicates', 0) + dup.get('structural_duplicates', 0)
        total_missing = sum(v.get('count', 0) for v in missing.values())

        score = self._calculate_quality_score(total_dup, total_missing)
        response = f"🎯 **Score : {score}/100**\n\n"

        if total_dup > 0:
            response += f"• ❌ {total_dup} doublons\n"
        if total_missing > 0:
            response += f"• ⚠️ {total_missing} valeurs manquantes\n"

        response += "\n" + ("✅ Excellente qualité" if score >= 80 else "⚡ Nettoyage recommandé")
        return {'answer': response, 'type': 'text', 'score': score}

    def _answer_duplicates(self) -> Dict:
        dup = self.analysis.get('duplicates', {})
        exact = dup.get('exact_duplicates', 0)
        struct = dup.get('structural_duplicates', 0)

        response = f"🔍 **Doublons :**\n\n• Exacts : {exact}\n• Structurels : {struct}\n• **Total : {exact + struct}**\n\n"
        response += ("💡 Supprimez-les" if exact + struct > 0 else "✅ Aucun doublon")
        return {'answer': response, 'type': 'text'}

    def _answer_general(self) -> Dict:
        response = f"📊 **Résumé :**\n\n• {self.analysis['rows']:,} lignes\n• {self.analysis['columns']} colonnes\n\n"
        response += "💡 Exemples :\n  • 'Quelle est la qualité ?'\n  • 'Y a-t-il des doublons ?'"
        return {'answer': response, 'type': 'text'}

    def _calculate_quality_score(self, dup: int, missing: int) -> int:
        total_cells = self.analysis['rows'] * self.analysis['columns']
        dup_penalty = min((dup / self.analysis['rows']) * 30, 30)
        missing_penalty = min((missing / total_cells) * 40, 40)
        return max(0, int(100 - dup_penalty - missing_penalty))