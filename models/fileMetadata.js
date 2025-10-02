import mongoose from 'mongoose';
import config from '../config/index.js'; 

const { FILE_TTL_DAYS } = config;

// --- Schéma des chunks ---
const chunkSchema = new mongoose.Schema({
  index: { type: Number, required: true },
  checksum: { type: String, required: true },
  size: { type: Number, required: true },
   etag: { type: String },         
  uploadedAt: { type: Date, default: Date.now }
});


// --- Schéma principal ---
const fileMetadataSchema = new mongoose.Schema({
  fileId: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  size: { type: Number, required: true },
  mimeType: { type: String, required: true },

  // Stockage
  provider: { type: String, enum: ['B2', 'R2'], required: true },
  providerKey: { type: String, required: true },

  // Chunking
  chunkSize: { type: Number, required: true },
  chunkCount: { type: Number, required: true },
  uploadedChunks: [chunkSchema],


  // Statut
  status: { 
    type: String, 
    enum: ['init', 'uploading', 'ready', 'migrating', 'error'],
    default: 'init' 
  },

  // Métadonnées d'usage
  uploaderId: { type: String, required: true }, // 🔹 peut être ObjectId
  recipients: [{ type: String }],               // 🔹 idem
  downloadCount: { type: Number, default: 0 },
  lastDownloadAt: { type: Date },

  // Migration
  migrationScheduled: { type: Boolean, default: false },
  originalProvider: { type: String },

  // TTL
  expiresAt: { 
    type: Date, 
    default: () => new Date(Date.now() + (FILE_TTL_DAYS * 24 * 60 * 60 * 1000))
  }
}, { timestamps: true }); // <-- gère createdAt & updatedAt automatiquement

// Index pour TTL automatique
fileMetadataSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index pour les requêtes fréquentes
fileMetadataSchema.index({ uploaderId: 1 });
fileMetadataSchema.index({ provider: 1 });
fileMetadataSchema.index({ downloadCount: 1 });
fileMetadataSchema.index({ status: 1 });

// --- Modèle ---
const FileMetadataModel = mongoose.model('FileMetadata', fileMetadataSchema);

export default FileMetadataModel;
