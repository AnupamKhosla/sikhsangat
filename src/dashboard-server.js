import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, 'logs', 'scraper_config.json');
const QA_FILE = path.join(ROOT_DIR, 'logs', 'verification_state.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs'); // Changed for GitHub Pages

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use('/mirror', express.static(OUTPUT_DIR));
app.use('/snapshots', express.static(path.join(ROOT_DIR, 'logs', 'snapshots')));

app.get('/', (req, res) => {
    let config = { currentJitter: 4000, maxConcurrency: 5, downloadedCount: 0 };
    if (fs.existsSync(CONFIG_FILE)) config = fs.readJsonSync(CONFIG_FILE);
    
    let html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
    
    // SSR: Inject the real data
    html = html.replace('__COUNT__', config.downloadedCount);
    html = html.replace('__JITTER__', config.currentJitter);
    html = html.replace('__THREADS__', config.maxConcurrency);
    
    res.send(html);
});

app.get('/api/init', (req, res) => {
    let config = { currentJitter: 4000, maxConcurrency: 5, downloadedCount: 0 };
    if (fs.existsSync(CONFIG_FILE)) config = fs.readJsonSync(CONFIG_FILE);
    res.json({ config });
});

app.get('/qa/list', (req, res) => {
    const files = [];
    const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(f => {
            const full = path.join(dir, f);
            if (fs.statSync(full).isDirectory()) walk(full);
            else if (f === 'index.html') {
                const rel = path.relative(OUTPUT_DIR, full);
                if (rel !== 'index.html') files.push({ path: rel });
            }
        });
    };
    walk(OUTPUT_DIR);
    res.json(files);
});

app.post('/log', (req, res) => {
    io.emit('update', req.body);
    res.sendStatus(200);
});

httpServer.listen(3000, '127.0.0.1', () => {
    console.log('STABLE Dashboard live at http://127.0.0.1:3000');
});
