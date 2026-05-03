# WikiMonit

Robot de monitoring système et réseau pour Wikipédia.

## Fonctionnalités

- **Monitoring Système** : CPU, RAM, Disque.
- **Monitoring Réseau** : Débit RX/TX.
- **Downdetector** : Surveillance de sites web externes.
- **Alertes Wiki** : Envoi des alertes sur des pages Wikipédia configurables.

## Configuration

Le robot lit sa configuration et ses cibles directement sur Wikipédia :

1. **Cibles d'alertes** : `Utilisateur:VotreNom/MonitoringTargets` (une page par ligne).
2. **Configuration** : `Utilisateur:VotreNom/MonitoringConfig` (format `KEY=VALUE`).
3. **Sites à surveiller (Downdetector)** : `Utilisateur:VotreNom/MonitoringURLs` (une URL par ligne commençant par `http`).

## Installation

```bash
npm install
# Créez un fichier .env avec vos identifiants WIKI_BOTUSER et WIKI_BOTPASS
node index.js
```
