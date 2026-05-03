// === Load environment variables ===
require('dotenv').config();

// === Module imports ===
const { Mwn } = require('mwn');
const si = require('systeminformation');

// === Configuration dynamique ===
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
console.log(TARGET_LIST_PAGE)
// === Nom racine alerte (format Bistro) ===
const BISTRO_ROOT = 'Wikipédia:Le Bistro';

// === Connexion Bot ===
const bot = new Mwn({
    apiUrl: 'https://fr.wikipedia.org/w/api.php',
    username: process.env.WIKI_BOTUSER,
    password: process.env.WIKI_BOTPASS,
    defaultParams: { },
    silent: true
});

// === Items précédents envoyés (anti-spam)
let activeWarnings = new Set();
let allowedUsers = new Set([process.env.WIKI_BOTUSER]);

// === Utilitaires ===
function todayBistroPage() {
    const date = new Date();
    const day = date.getUTCDate();
    const month = date.toLocaleString('fr-FR', { month: 'long', timeZone: 'UTC' });
    const year = date.getUTCFullYear();
console.log(date)
    return `${BISTRO_ROOT}/${day} ${month} ${year}`;
}

async function readConfigFromWiki() {
    try {
        const res = await bot.read(CONFIG_PAGE);
        if (!res) return;
	console.log(res)
        const lines = res.revisions?.[0]?.content.split('\n');
	console.log(lines)
        let newConfig = { ...config };

        for (const l of lines) {
            const m = l.match(/^(\w+)=([\d]+)/);
            if (m) {
                newConfig[m[1]] = parseInt(m[2]);
            }
        }
console.log(config)
        config = newConfig;
    } catch(e) {console.log(e)}
}

async function ensureTargetsAllowed() {
//    console.log(bot)
try {
        const content = await bot.read(CONFIG_PAGE);
        const latest = content.revisions?.[0]?.user;
        if (!allowedUsers.has(latest)) {
            await bot.save(CONFIG_PAGE, formatConfig(config), '[MonitoringBot] Restauration config autorisée');
        }
    } catch (e){console.log(e)}
}

function formatConfig(obj) {
    return Object.entries(obj)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n\n\n');
}

async function getTargetPages() {
    const txt = await bot.read(TARGET_LIST_PAGE) || '';
    console.log(txt)
    return txt.revisions[0].content
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);
}

async function sendAlertToWiki(msg) {
    const targetPages = await getTargetPages();
console.log(targetPages)
    const text = `\n== Alerte système == \n${new Date().toISOString()} — ${msg} \n~~~~ `;

    for (const page of targetPages) {
        try {
            await bot.edit(
                page,
                oldText => oldText.content + '\n'+text,
                '[MonitoringBot] Alerte système'
            );
            console.log(`Alerte envoyée sur : ${page}`);
        } catch (e) {
            console.error(`⚠️ Erreur alerte sur ${page}`, e);
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
//	console.log(cpu)
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
    await readConfigFromWiki();
    await ensureTargetsAllowed();
    await checkSystem();
}

(async () => {
    await bot.login();
	await sendAlertToWiki(" le système de monitoring a redémarrée")
    console.log("MonitoringBot connecté à Wikipédia 🎯");
	loop()
    setInterval(loop, config.intervalSec * 1000);
})();
