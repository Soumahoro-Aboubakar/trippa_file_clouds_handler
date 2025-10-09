// backend/config/index.js
const config = {
  // Seuils de taille
  THRESHOLD_LARGE_FILE: parseInt(process.env.THRESHOLD_LARGE_FILE) || 100 * 1024 * 1024, // 100MB
  CHUNK_SIZE: parseInt(process.env.CHUNK_SIZE) || 4 * 1024 * 1024, // 4MB
  
  // Sécurité
  PRESIGNED_URL_EXPIRY: parseInt(process.env.PRESIGNED_URL_EXPIRY) || 604800, // 7 jours
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key',
  
  // Migration et nettoyage
  POPULARITY_MIGRATION_THRESHOLD: parseInt(process.env.POPULARITY_MIGRATION_THRESHOLD) || 10,
  FILE_TTL_DAYS: parseInt(process.env.FILE_TTL_DAYS) || 3,
  
  // Limites providers
  MAX_PART_SIZE_BACKBLAZE: 5 * 1024 * 1024 * 1024, // 5GB
  
  // Base de données
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/multiproviderstorage',
  
  // Backblaze B2
  B2_BUCKET_NAME: process.env.B2_BUCKET_NAME,
  B2_KEY_ID: process.env.B2_KEY_ID,
  B2_APPLICATION_KEY: process.env.B2_APPLICATION_KEY,
  B2_BUCKET_ID: process.env.B2_BUCKET_ID,
  
  // Cloudflare R2
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  
  // Worker settings pour machines faibles/puissantes
  MAX_CONCURRENT_UPLOADS: parseInt(process.env.MAX_CONCURRENT_UPLOADS) || 3,
  WORKER_POOL_SIZE: parseInt(process.env.WORKER_POOL_SIZE) || 2,
};

export default config;