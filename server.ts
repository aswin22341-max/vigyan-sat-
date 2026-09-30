import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// Serve static assets from Vite build output directory
const distPath = path.resolve(__dirname, 'dist');
app.use(express.static(distPath));

// Health check endpoint for Cloud Run container monitoring
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'VIGYANSAT', time: new Date().toISOString() });
});

// Single Page Application (SPA) routing fallback
app.get('*', (_req, res) => {
  res.sendFile(path.resolve(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VIGYANSAT Flight Ground Station listening on port ${PORT}`);
});
