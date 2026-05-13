const nodemon = require('nodemon');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// Vérification des node_modules avant de lancer nodemon
const nodeModulesPath = path.join(__dirname, 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.log('[Runner] node_modules manquants. Installation en cours...');
  try {
    execSync('npm install', { stdio: 'inherit' });
    console.log('[Runner] Installation terminée avec succès.');
  } catch (err) {
    console.error('[Runner] Échec de l\'installation des dépendances:', err.message);
    process.exit(1);
  }
}

nodemon({
  script: path.join(__dirname, 'bot.js'),
  ext: 'js json sh',
  watch: ['bot.js', '.env', 'package.json'],
  ignore: ['bot.log', 'node_modules', '.git'],
  delay: 2500
});

nodemon.on('start', function () {
  console.log('[Runner] Le bot a démarré');
}).on('quit', function () {
  console.log('[Runner] Le bot a quitté');
  process.exit();
}).on('restart', function (files) {
  console.log('[Runner] Le bot redémarre suite à des changements dans :', files);
  
  // Vérification de sécurité : si node_modules a disparu pendant le pull/restart
  if (!fs.existsSync(nodeModulesPath)) {
    console.log('[Runner] node_modules disparus détectés lors du restart. Réinstallation...');
    try {
      execSync('npm install', { stdio: 'inherit' });
    } catch (err) {
      console.error('[Runner] Échec réinstallation critique:', err.message);
    }
  }
});
