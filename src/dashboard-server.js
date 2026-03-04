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
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());

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
    let config = { downloadedCount: 0, currentJitter: 2000, maxConcurrency: 2 };
    if (fs.existsSync(CONFIG_FILE)) config = fs.readJsonSync(CONFIG_FILE);
    
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
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const start = (page - 1) * limit;

    const files = [];
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(f => {
            const full = path.join(dir, f);
            if (fs.statSync(full).isDirectory()) walk(full);
            else if (f.endsWith('.html')) {
                files.push({ path: path.relative(OUTPUT_DIR, full) });
            }
        });
    };
    walk(OUTPUT_DIR);
    
    const paginated = files.slice(start, start + limit);
    res.json({
        files: paginated,
        total: files.length,
        pages: Math.ceil(files.length / limit),
        currentPage: page
    });
});

app.post('/log', (req, res) => {
    io.emit('update', req.body);
    res.sendStatus(200);
});

io.on('connection', (socket) => {
    // Send recent logs from file on connection
    if (fs.existsSync(LOG_FILE)) {
        try {
            const fullLog = fs.readFileSync(LOG_FILE, 'utf8');
            const lines = fullLog.split(/\r?\n/).filter(l => l.trim()).slice(-50);
            lines.forEach(line => socket.emit('update', { msg: line }));
        } catch(e) {}
    }
    // Also send current stats
    let config = { downloadedCount: getPhysicalCount(), currentJitter: 2000, maxConcurrency: 2 };
    socket.emit('update', { config });
});

// ROBUST TAILING: Listen to the system log file
if (fs.existsSync(LOG_FILE)) {
    try {
        const tail = new Tail(LOG_FILE, { useWatchFile: true });
        tail.on("line", (data) => {
            io.emit('update', { msg: data });
        });
    } catch(e) {
        console.error("Tail Error:", e.message);
    }
}

httpServer.listen(3000, '127.0.0.1', () => {
    console.log('STABLE Dashboard live at http://127.0.0.1:3000');
});
