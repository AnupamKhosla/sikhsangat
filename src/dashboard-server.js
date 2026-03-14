import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { Tail } from 'tail';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, 'logs', 'scraper_config.json');
const LOG_FILE = path.join(ROOT_DIR, 'logs', 'system.log');
const SESSION_FILE = path.join(ROOT_DIR, 'logs', 'runtime_state.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());
fs.ensureFileSync(LOG_FILE);

function readConfig() {
    let config = { downloadedCount: 0, currentJitter: 2000, maxConcurrency: 2 };
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            config = { ...config, ...fs.readJsonSync(CONFIG_FILE) };
        } catch {}
    }
    return config;
}

function readSessionState() {
    if (!fs.existsSync(SESSION_FILE)) {
        return null;
    }

    try {
        return fs.readJsonSync(SESSION_FILE);
    } catch {
        return null;
    }
}

function readRecentSessionLines(limit = 50) {
    const session = readSessionState();
    if (!session?.active || !session.sessionId || !fs.existsSync(LOG_FILE)) {
        return [];
    }

    try {
        const fullLog = fs.readFileSync(LOG_FILE, 'utf8');
        const marker = `SESSION START ${session.sessionId}`;
        const markerIndex = fullLog.lastIndexOf(marker);
        const sessionLog = markerIndex >= 0 ? fullLog.slice(markerIndex) : fullLog;
        return sessionLog.split(/\r?\n/).filter((line) => line.trim()).slice(-limit);
    } catch {
        return [];
    }
}

app.use('/mirror', express.static(OUTPUT_DIR, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html');
        }
    }
}));

app.use('/snapshots', express.static(path.join(ROOT_DIR, 'logs', 'snapshots')));

function getPhysicalCount() {
    const walk = (dir) => {
        let count = 0;
        if (!fs.existsSync(dir)) return 0;
        fs.readdirSync(dir).forEach(f => {
            const full = path.join(dir, f);
            if (fs.statSync(full).isDirectory()) count += walk(full);
            else if (f.endsWith('.html')) count++;
        });
        return count;
    };
    return walk(OUTPUT_DIR);
}

app.get('/', (req, res) => {
    const config = readConfig();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    
    const actualCount = getPhysicalCount();
    if (config.downloadedCount !== actualCount) {
        config.downloadedCount = actualCount;
        fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });
    }

    let html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
    html = html.replace('__COUNT__', config.downloadedCount || 0)
               .replace('__JITTER__', config.currentJitter || 2000)
               .replace('__THREADS__', config.maxConcurrency || 2);
    res.send(html);
});

app.get('/qa/list', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = 50;

    const files = [];
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(f => {
            const full = path.join(dir, f);
            if (fs.statSync(full).isDirectory()) walk(full);
            else if (f.endsWith('.html')) {
                files.push({
                    path: path.relative(OUTPUT_DIR, full),
                    modifiedAt: fs.statSync(full).mtimeMs,
                });
            }
        });
    };
    walk(OUTPUT_DIR);
    files.sort((left, right) => right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path));

    const totalPages = Math.max(Math.ceil(files.length / limit), 1);
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    
    const paginated = files.slice(start, start + limit);
    res.json({
        files: paginated,
        total: files.length,
        pages: totalPages,
        currentPage: safePage
    });
});

app.post('/log', (req, res) => {
    io.emit('update', req.body);
    res.sendStatus(200);
});

io.on('connection', (socket) => {
    readRecentSessionLines().forEach((line) => socket.emit('update', { msg: line }));

    const config = readConfig();
    config.downloadedCount = getPhysicalCount();
    socket.emit('update', { config, session: readSessionState() });
});

// ROBUST TAILING: Listen to the system log file
let tail;
try {
    tail = new Tail(LOG_FILE, { useWatchFile: true });
    tail.on("line", (data) => {
        io.emit('update', { msg: data });
    });
    tail.on("error", (error) => {
        console.error("Tail Error:", error.message);
    });
} catch(e) {
    console.error("Tail Error:", e.message);
}

httpServer.on('close', () => {
    if (tail) {
        tail.unwatch();
    }
});

const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT) || 3000;
httpServer.listen(DASHBOARD_PORT, '127.0.0.1', () => {
    console.log(`STABLE Dashboard live at http://127.0.0.1:${DASHBOARD_PORT}`);
});
