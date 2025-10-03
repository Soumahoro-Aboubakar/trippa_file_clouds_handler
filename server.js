// backend/server.js
import express, { json, urlencoded } from 'express';
import { connect } from 'mongoose';
import cors from 'cors';
import { config as _config } from 'dotenv';
import cluster from 'cluster';
import { cpus } from 'os';
import config from './config/index.js';
import https from "https";
_config();

const app = express();

// Middlewares
app.use(cors());
app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));


// Logger APRES que le body ait été parsé
app.use((req, res, next) => {
  console.log("📌 Méthode :", req.method);
  console.log("📌 URL :", req.originalUrl);
  console.log("📌 Headers :", req.headers);
  console.log("📌 Body :", req.body); // Ici ça marchera 🚀
  next();
});
// Routes
import filesRoutes from './routes/files.js';

app.use('/api/files', filesRoutes);
//app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Connexion MongoDB
connect(config.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connecté'))
.catch(err => console.error('❌ Erreur MongoDB:', err));


function autoPing() {
  setInterval(() => {
    https.get(process.env.SELF_URL, (res) => {
      console.log(`Pinged self: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error(`Ping error: ${err.message}`);
    });
  }, 60 * 5000); 
}


if (cluster.isPrimary && process.env.NODE_ENV === 'production') {
  const numCPUs = Math.min(cpus().length, 4); // Max 4 workers
  
  console.log(`🚀 Démarrage de ${numCPUs} workers`);
  
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} terminé`);
    cluster.fork();
  });
} else {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🌟 Serveur démarré sur le port ${PORT} (PID: ${process.pid})`);
    autoPing();
  });
}
export default app;