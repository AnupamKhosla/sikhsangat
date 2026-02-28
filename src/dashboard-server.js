import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, 'logs', 'scraper_config.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());

// FIX: Ensure .html files are viewed, not downloaded
app.use('/mirror', express.static(OUTPUT_DIR, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Content-Type', 'text/html');
        }
    }
}));

app.use('/snapshots', express.static(path.join(ROOT_DIR, 'logs', 'snapshots')));

app.get('/', (req, res) => {
    let config = { downloadedCount: 0, currentJitter: 4000, maxConcurrency: 1 };
    if (fs.existsSync(CONFIG_FILE)) config = fs.readJsonSync(CONFIG_FILE);
    let html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
    html = html.replace('__COUNT__', config.downloadedCount)
               .replace('__JITTER__', config.currentJitter)
               .replace('__THREADS__', config.maxConcurrency);
    res.send(html);
});

// Paginated QA API
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

httpServer.listen(3000, '127.0.0.1', () => {
    console.log('STABLE Dashboard live at http://127.0.0.1:3000');
});
