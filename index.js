// === Load environment variables ===
require('dotenv').config();

// === Module imports ===
const { Mwn } = require('mwn');
const si = require('systeminformation');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LOG_FILE = path.join(__dirname, 'bot.log');

// === Utilitaires ===
function logToFile(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(formattedMessage.trim()); // Garde aussi l'affichage console
    try {
        fs.appendFileSync(LOG_FILE, formattedMessage);
    } catch (err) {
        console.error('Erreur écriture log:', err);
    }
}

function syncGit() {
    try {
        logToFile('Vérification des mises à jour Git...');
        const output = execSync('git pull', { encoding: 'utf-8' });
        if (output.includes('Already up to date.')) {
            logToFile('Le code est déjà à jour.');
        } else {
            logToFile(`Mise à jour effectuée : ${output.trim()}`);
            logToFile('Redémarrage recommandé si des fichiers critiques ont changé.', 'WARN');
        }
    } catch (e) {
        logToFile(`Erreur lors du sync Git : ${e.message}`, 'ERROR');
    }
}
let config = {
    intervalSec: parseInt(process.env.INTERVAL_SEC) || 30,
    cpuAlertPct: parseInt(process.env.CPU_ALERT_PCT) || 80,
    memFreeAlertPct: parseInt(process.env.MEM_FREE_ALERT_PCT) || 20,
    diskFreeAlertPct: parseInt(process.env.DISK_FREE_ALERT_PCT) || 15,
    netAlertRxMbps: parseInt(process.env.NET_ALERT_RX_MBPS) || 50,
    netAlertTxMbps: parseInt(process.env.NET_ALERT_TX_MBPS) || 20
};

// === Page des cibles & config sur Wiki ===
const TARGET_LIST_PAGE = `Utilisateur:${process.env.WIKI_BOTUSER.split("@")[0].replace(" ","_")}/MonitoringTargets`;
const CONFIG_PAGE = `Utilisateur:${process.env.WIKI_BOTUSER.split("@")[0].replace(" ","_")}/MonitoringConfig`;
const URL_LIST_PAGE = `Utilisateur:${process.env.WIKI_BOTUSER.split("@")[0].replace(" ","_")}/MonitoringURLs`;
logToFile(TARGET_LIST_PAGE)
// === Nom racine alerte (format Bistro) ===
const BISTRO_ROOT = 'Wikipédia:Le Bistro';

// === Connexion Bot ===
const bot = new Mwn({
    apiUrl: 'https://fr.wikipedia.org/w/api.php',
    username: process.env.WIKI_BOTUSER,
    password: process.env.WIKI_BOTPASS,
    userAgent: `WikiMonitBot (https://fr.wikipedia.org/wiki/Utilisateur:${process.env.WIKI_BOTUSER.split('@')[0]})`,
    defaultParams: { },
    silent: false
});

// === Items précédents envoyés (anti-spam)
let activeWarnings = new Set();
const botAccountName = process.env.WIKI_BOTUSER.split('@')[0];
let allowedUsers = new Set([botAccountName,"Spartan.arbinger"]);

// === Utilitaires ===
function todayBistroPage() {
    const date = new Date();
    const day = date.getUTCDate();
    const month = date.toLocaleString('fr-FR', { month: 'long', timeZone: 'UTC' });
    const year = date.getUTCFullYear();
logToFile(date)
    return `${BISTRO_ROOT}/${day} ${month} ${year}`;
}

async function readConfigFromWiki() {
    try {
        const res = await bot.read(CONFIG_PAGE);
        if (!res) return;
        const lines = res.revisions?.[0]?.content.split('\n');
        let newConfig = { ...config };

        for (const l of lines) {
            const m = l.match(/^(\w+)=([\d]+)/);
            if (m) {
                newConfig[m[1]] = parseInt(m[2]);
            }
        }
        config = newConfig;
    } catch(e) {
        logToFile(`Erreur lecture config: ${e.message}`, 'ERROR');
    }
}

async function ensureTargetsAllowed() {
    try {
        const content = await bot.read(CONFIG_PAGE, { rvprop: 'content|user' });
        const latest = content.revisions?.[0]?.user;
        if (latest && !allowedUsers.has(latest)) {
            await bot.save(CONFIG_PAGE, formatConfig(config), '[MonitoringBot] Restauration config autorisée');
            logToFile(`Config restaurée suite à modification non autorisée par ${latest}`, 'WARN');
        }
    } catch (e){
        logToFile(`Erreur vérification droits: ${e.message}`, 'ERROR');
    }
}

function formatConfig(obj) {
    return Object.entries(obj)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n\n\n');
}

async function getTargetPages() {
    const txt = await bot.read(TARGET_LIST_PAGE) || '';
    if (!txt || !txt.revisions) return [];
    return txt.revisions[0].content
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
}

async function getMonitorUrls() {
    try {
        const txt = await bot.read(URL_LIST_PAGE);
        if (!txt || !txt.revisions) return [];
        return txt.revisions[0].content
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('http'));
    } catch (e) {
        logToFile(`Erreur lecture URLs à monitorer: ${e.message}`, 'ERROR');
        return [];
    }
}

async function initializeWikiPages() {
    const pages = [
        {
            title: TARGET_LIST_PAGE,
            content: `Utilisateur:${process.env.WIKI_BOTUSER.split("@")[0].replace(" ","_")}/MonitoringLog`,
            summary: '[MonitoringBot] Initialisation de la liste des cibles'
        },
        {
            title: CONFIG_PAGE,
            content: formatConfig(config),
            summary: '[MonitoringBot] Initialisation de la configuration'
        },
        {
            title: URL_LIST_PAGE,
            content: 'https://www.google.com\nhttps://fr.wikipedia.org',
            summary: '[MonitoringBot] Initialisation de la liste des URLs (Downdetector)'
        }
    ];

    for (const page of pages) {
        try {
            const exists = await bot.read(page.title);
            if (!exists || !exists.revisions) {
                await bot.save(page.title, page.content, page.summary);
                logToFile(`Page créée : ${page.title}`);
            }
        } catch (e) {
            logToFile(`Erreur lors de l'initialisation de ${page.title}: ${e.message}`, 'ERROR');
        }
    }
}

async function sendAlertToWiki(msg) {
    const targetPages = await getTargetPages();
    const text = `\n== Alerte système == \n${new Date().toISOString()} — ${msg} \n~~~~ `;

    for (const page of targetPages) {
        try {
            await bot.edit(
                page,
                oldText => oldText.content + '\n'+text,
                '[MonitoringBot] Alerte système'
            );
            logToFile(`Alerte envoyée sur : ${page}`);
        } catch (e) {
            logToFile(`Erreur alerte sur ${page}: ${e.message}`, 'ERROR');
        }
    }
}



// === Monitoring principal ===
async function checkSystem() {
    const [
        cpu,
        mem,
        disk,
        net
    ] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats()
    ]);
//	logToFile(cpu)
    const currentAlerts = [];

    // CPU
    if (cpu.currentload > config.cpuAlertPct) {
        currentAlerts.push({
            id: 'CPU',
            msg: `CPU critique: ${cpu.currentload.toFixed(1)}%`
        });
    }

    // RAM
    const memFreePct = (mem.available / mem.total) * 100;
    if (memFreePct < config.memFreeAlertPct) {
        currentAlerts.push({
            id: 'MEM',
            msg: `Mémoire basse: ${memFreePct.toFixed(1)}% libre`
        });
    }

    // Disque
 // Disques (multi-volumes)
disk.forEach(d => {
    const diskFreePct = 100 - d.use;
    const id = `DISK:${d.mount}`;
    
    if (diskFreePct < config.diskFreeAlertPct) {
        currentAlerts.push({
            id,
            msg: `Disque ${d.mount} presque plein: ${diskFreePct.toFixed(1)}% libre (${(d.available/1024/1024/1024).toFixed(1)} Go libres)`
        });
    }
});


    // Réseau
    const rx = net[0].rx_sec / (1024*1024);
    const tx = net[0].tx_sec / (1024*1024);
    if (rx > config.netAlertRxMbps || tx > config.netAlertTxMbps) {
        currentAlerts.push({
            id: 'NET',
            msg: `Trafic réseau élevé: RX=${rx.toFixed(1)} MB/s TX=${tx.toFixed(1)} MB/s`
        });
    }

    // URLs (Downdetector)
    const urls = await getMonitorUrls();
    await Promise.all(urls.map(async (url) => {
        try {
            await axios.get(url, { timeout: 10000 });
        } catch (e) {
            currentAlerts.push({
                id: `URL:${url}`,
                msg: `Site inaccessible: ${url} (${e.message})`
            });
        }
    }));

    // 🔥 Envoi et gestion état
    for (const alert of currentAlerts) {
        if (!activeWarnings.has(alert.id)) {
            await sendAlertToWiki(alert.msg);
            activeWarnings.add(alert.id);
        }
    }

    // 🟢 Retour à la normale
    for (const id of [...activeWarnings]) {
        if (!currentAlerts.find(a => a.id === id)) {
            activeWarnings.delete(id);
            await sendAlertToWiki(`Retour à la normale: ${id}`);
        }
    }
}

// === Loop ===
async function loop() {
    syncGit();
    try {
        await bot.getTokensAndSiteInfo();
        const currentUser = bot.userinfo?.name;
        
        // On vérifie si on est toujours connecté avec le bon compte
        // botAccountName est "Pmartin", currentUser devrait être "Pmartin"
        if (!currentUser || currentUser.toLowerCase() !== botAccountName.toLowerCase()) {
            logToFile(`Session incorrecte (Actuel: ${currentUser || 'anonyme'}, Attendu: ${botAccountName}). Re-connexion...`, 'WARN');
            await bot.login();
        }
    } catch (e) {
        if (e.message.includes('Already logged in')) {
            // Déjà connecté, on peut continuer
        } else {
            logToFile(`Erreur session: ${e.message}`, 'ERROR');
            await bot.login().catch(err => {
                if (!err.message.includes('Already logged in')) {
                    logToFile(`Échec re-connexion: ${err.message}`, 'ERROR');
                }
            });
        }
    }

    await readConfigFromWiki();
    await ensureTargetsAllowed();
    await checkSystem();
}

(async () => {
    try {
        await bot.login();
        await initializeWikiPages();
        await sendAlertToWiki("Le système de monitoring a redémarré");
        logToFile("MonitoringBot connecté à Wikipédia 🎯");
        loop();
        setInterval(loop, config.intervalSec * 1000);
    } catch (e) {
        logToFile(`Erreur fatale au démarrage: ${e.message}`, 'ERROR');
    }
})();
