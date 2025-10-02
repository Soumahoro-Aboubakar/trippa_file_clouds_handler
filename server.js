// backend/server.js
import express, { json, urlencoded } from 'express';
import { connect } from 'mongoose';
import cors from 'cors';
import { config as _config } from 'dotenv';
import { isMaster, fork, on } from 'cluster';
import { cpus } from 'os';
import { MONGODB_URI } from './config/index.js';

_config();

const app = express();

// Middlewares
app.use(cors());
app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));

// Routes
import filesRoutes from './routes/files';
import adminRoutes from './routes/admin';

app.use('/api/files', filesRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Connexion MongoDB
connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connecté'))
.catch(err => console.error('❌ Erreur MongoDB:', err));

// Optimisation pour machines multi-cœurs
if (isMaster && process.env.NODE_ENV === 'production') {
  const numCPUs = Math.min(cpus().length, 4); // Max 4 workers
  
  console.log(`🚀 Démarrage de ${numCPUs} workers`);
  
  for (let i = 0; i < numCPUs; i++) {
    fork();
  }
  
  on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} terminé`);
    fork();
  });
} else {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🌟 Serveur démarré sur le port ${PORT} (PID: ${process.pid})`);
  });
}

export default app;