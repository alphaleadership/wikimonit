const nodemon = require('nodemon');
const path = require('path');

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
});
