// backend/server.js
import express, { json, urlencoded } from 'express';
import { connect } from 'mongoose';
import cors from 'cors';
import { config as _config } from 'dotenv';
import cluster from 'cluster';
import { cpus } from 'os';
import config from './config/index.js';
import https from "https";
// Routes
import filesRoutes from './routes/files.js';
_config();

const app = express();

app.use((req, res, next) => {
  console.log("📌11 Méthode :", req.method);
  console.log("📌222 URL :", req.originalUrl);
  console.log("📌22 Headers :", req.headers);
  console.log("📌22 Body :", req.body);
  next();
});

// Middlewares
app.use(cors());
app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  console.log("📌33 Méthode :", req.method);
  console.log("📌33 URL :", req.originalUrl);
  console.log("📌33 Headers :", req.headers);
  console.log("📌33 Body :", req.body);
  next();
});



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

console.log(config , " voici toutes mes clé");
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