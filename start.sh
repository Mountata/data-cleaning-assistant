#!/bin/bash

# start.sh - Script de démarrage complet pour l'Assistant de Nettoyage de Données
# Usage: ./start.sh [development|production|test]

# Couleurs pour les messages
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonction pour afficher des messages colorés
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Bannière
print_banner() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║                                                          ║"
    echo "║     🧹 Assistant de Nettoyage de Données               ║"
    echo "║                                                          ║"
    echo "║     Analyse intelligente et nettoyage conversationnel   ║"
    echo "║                                                          ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}\n"
}

# Vérifier Python
check_python() {
    print_info "Vérification de Python..."

    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 n'est pas installé"
        print_info "Installez Python 3.8+ depuis https://www.python.org/"
        exit 1
    fi

    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
    print_success "Python $PYTHON_VERSION détecté"
}

# Créer l'environnement virtuel
setup_venv() {
    print_info "Configuration de l'environnement virtuel..."

    if [ ! -d ".venv" ]; then
        print_info "Création de l'environnement virtuel..."
        python3 -m venv .venv
        print_success "Environnement virtuel créé"
    else
        print_success "Environnement virtuel déjà existant"
    fi

    # Activer l'environnement virtuel
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
        source .venv/Scripts/activate
    else
        source .venv/bin/activate
    fi

    print_success "Environnement virtuel activé"
}

# Installer les dépendances
install_dependencies() {
    print_info "Installation des dépendances Python..."

    if [ -f "backend/requirements.txt" ]; then
        pip install -q --upgrade pip
        pip install -q -r backend/requirements.txt
        print_success "Dépendances installées"
    else
        print_error "Fichier requirements.txt non trouvé dans backend/"
        exit 1
    fi
}

# Créer les dossiers nécessaires
create_directories() {
    print_info "Création des dossiers..."

    mkdir -p backend/uploads
    mkdir -p backend/cleaned
    mkdir -p backend/logs

    print_success "Dossiers créés"
}

# Vérifier la configuration
check_config() {
    print_info "Vérification de la configuration..."

    if [ -f "backend/config.py" ]; then
        print_success "Fichier config.py trouvé"
    else
        print_warning "Fichier config.py non trouvé, utilisation des valeurs par défaut"
    fi

    # Vérifier les variables d'environnement
    if [ -z "$FLASK_ENV" ]; then
        export FLASK_ENV=${1:-development}
        print_info "FLASK_ENV défini sur: $FLASK_ENV"
    fi
}

# Initialiser la base de données
init_database() {
    print_info "Initialisation de la base de données..."

    python3 -c "from backend.database import SessionDatabase; db = SessionDatabase(); print('DB initialized')" 2>/dev/null

    if [ $? -eq 0 ]; then
        print_success "Base de données initialisée"
    else
        print_warning "Base de données non initialisée (optionnel)"
    fi
}

# Tester l'API
test_api() {
    print_info "Test de l'API..."

    sleep 2  # Attendre que le serveur démarre

    HEALTH_CHECK=$(curl -s http://localhost:5000/health 2>/dev/null)

    if [ $? -eq 0 ]; then
        print_success "API opérationnelle ✨"
        echo "$HEALTH_CHECK" | python3 -m json.tool 2>/dev/null || echo "$HEALTH_CHECK"
    else
        print_warning "Impossible de vérifier l'API (démarrage en cours...)"
    fi
}

# Nettoyer les vieux fichiers
cleanup_old_files() {
    print_info "Nettoyage des fichiers anciens..."

    find backend/uploads -type f -mtime +7 -delete 2>/dev/null
    find backend/cleaned -type f -mtime +7 -delete 2>/dev/null

    print_success "Nettoyage effectué"
}

# Démarrer le serveur
start_server() {
    local mode=${1:-development}

    print_info "Démarrage du serveur en mode: $mode"

    if [ "$mode" == "production" ]; then
        # Production avec Gunicorn
        print_info "Démarrage avec Gunicorn..."

        if ! command -v gunicorn &> /dev/null; then
            print_warning "Gunicorn non installé, installation..."
            pip install gunicorn
        fi

        gunicorn --bind 0.0.0.0:5000 \
                 --workers 4 \
                 --timeout 300 \
                 --access-logfile backend/logs/access.log \
                 --error-logfile backend/logs/error.log \
                 backend.app:app
    else
        # Développement avec Flask
        print_success "Serveur démarré sur http://localhost:5000"
        print_info "Appuyez sur Ctrl+C pour arrêter"
        echo ""

        python3 backend/app.py
    fi
}

# Afficher les informations
show_info() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  🎉 Application prête !                                 ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}📡 API :${NC}          http://localhost:5000"
    echo -e "${BLUE}📊 Health Check :${NC} http://localhost:5000/health"
    echo -e "${BLUE}📖 API Docs :${NC}     http://localhost:5000/api/sessions"
    echo ""
    echo -e "${YELLOW}🔧 Commandes utiles :${NC}"
    echo "  - Créer fichier test :  python3 backend/test_api.py"
    echo "  - Tester l'API :        curl http://localhost:5000/health"
    echo "  - Logs :                tail -f backend/logs/*.log"
    echo "  - Arrêter :             Ctrl+C"
    echo ""
}

# Fonction principale
main() {
    clear
    print_banner

    MODE=${1:-development}

    check_python
    setup_venv
    install_dependencies
    create_directories
    check_config "$MODE"
    init_database

    if [ "$MODE" == "production" ]; then
        cleanup_old_files
    fi

    show_info

    (test_api) &

    start_server "$MODE"
}

# Gestion des signaux
cleanup() {
    echo ""
    print_info "Arrêt du serveur..."
    print_success "Au revoir ! 👋"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Point d'entrée
main "$@"
