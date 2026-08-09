# CBReader

Lecteur de bandes dessinées numériques (comics), en application web ou en application de bureau Windows installable — sans serveur, tout se passe localement dans le navigateur ou dans l'app.

## Télécharger

Les installateurs Windows (`.exe` et `.msi`) sont sur la page **[Releases](https://github.com/Xoletis/cbreader/releases)** : téléchargez la dernière version et double-cliquez sur l'installateur. Aucun prérequis, pas besoin de Node.js ni de Rust pour simplement utiliser l'app.

## Formats supportés

| Format | Extension |
|---|---|
| Comic Book Zip | `.cbz`, `.zip` |
| Comic Book RAR | `.cbr`, `.rar` |

Le format est détecté à partir du contenu réel du fichier, pas seulement de son extension.

## Fonctionnalités

**Lecteur**
- Navigation clavier, molette, ou glisser-déposer à la souris (façon CDisplayEx)
- Zoom largeur / hauteur / manuel (25% à 400%), molette + Ctrl pour zoomer là où se trouve le curseur
- Molette + Alt pour déplacer la page horizontalement
- Mode double page (livre ouvert)
- Panneau de vignettes pour visualiser et sélectionner une page
- Plein écran
- Reprise automatique à la page, au zoom et au mode où vous vous étiez arrêté

**Bibliothèque**
- Connecte un dossier entier et affiche tous ses comics sous forme de grille de couvertures
- Navigation dans les sous-dossiers, avec un panneau d'arborescence type Explorateur Windows
- Recherche dans toute la bibliothèque
- Renommer, déplacer, supprimer, colorer les dossiers, sélection multiple, glisser-déposer
- Barre de progression sur chaque couverture pour les comics déjà commencés

**Application de bureau (Windows)**
- Ouverture directe depuis l'Explorateur (double-clic ou "Ouvrir avec")
- Mise à jour automatique

## Raccourcis clavier (dans le lecteur)

| Touche | Action |
|---|---|
| `→`, `Espace`, `Page suivante` | Page suivante |
| `←`, `Page précédente` | Page précédente |
| `Origine` / `Fin` | Première / dernière page |
| `+` / `-` | Zoom avant / arrière |
| `D` | Mode double page |
| `F` | Plein écran |

## Développement

```bash
npm install
npm run dev       # serveur de développement
npm run build     # build de production dans dist/
```

Pour l'app de bureau (nécessite en plus la chaîne d'outils Rust — `winget install --id Rustlang.Rustup -e`) :

```bash
npm run app:dev     # app native avec rechargement à chaud
npm run app:build   # génère les installateurs .msi/.exe dans src-tauri/target/release/bundle/
```
