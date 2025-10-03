// backend/routes/files.js
import { Router } from "express";
import { randomUUID } from "crypto";
import {
  generatePresignedPutUrls,
  completeMultipartUpload,
  generatePresignedGetUrls,
} from "../services/b2Service.js";
import {
  generatePresignedPutUrls as _generatePresignedPutUrls,
  completeMultipartUpload as _completeMultipartUpload,
  generatePresignedGetUrls as _generatePresignedGetUrls,
} from "../services/r2Service.js";
import config from "../config/index.js";
import FileMetadataModel from "../models/fileMetadata.js";
import auth from "../middleware/auth.js";

const router = Router();

// POST /files/init-upload
router.post("/init-upload", auth, async (req, res) => {
  try {
    console.log("voici le contenu de body : ", req.body);
    const { name, size, mimeType, recipients } = req.body;
    const uploaderId = req.userId;

    // Validation
    if (!name || !size || !mimeType) {
      return res.status(400).json({ error: "Paramètres manquants" });
    }

    // Calculs
    const chunkSize = config.CHUNK_SIZE;
    const chunkCount = Math.ceil(size / chunkSize);
    const fileId = randomUUID();

    // Décision de provider basée sur la taille
    const provider = size <= config.THRESHOLD_LARGE_FILE ? "B2" : "R2";

    // Création des métadonnées
    const metadata = new FileMetadataModel({
      fileId,
      name,
      size,
      mimeType,
      provider,
      providerKey: fileId,
      chunkSize,
      chunkCount,
      uploaderId,
      recipients,

      uploadedChunks: [],
      status: "init",
    });

    await metadata.save();

    // Génération des URLs pré-signées
    let presignedUrls;
    if (provider === "B2") {
      presignedUrls = await generatePresignedPutUrls(fileId, chunkCount);
    } else {
      presignedUrls = await _generatePresignedPutUrls(fileId, chunkCount);
    }

    res.json({
      fileId,
      provider,
      chunkSize,
      chunkCount,
      presignedUrls,

      //  uploadId: presignedUrls[0]?.uploadId, // Pour multipart A revoir
    });
  } catch (error) {
    console.error("Erreur init-upload:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /files/:id/ack-chunk
router.post("/:id/ack-chunk", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { chunkIndex, checksum, size, etag } = req.body;

    const metadata = await FileMetadataModel.findOne({ fileId: id });
    if (!metadata) {
      return res.status(404).json({ error: "Fichier non trouvé" });
    }

    // Vérifier autorisation
    if (metadata.uploaderId !== req.userId) {
      return res.status(403).json({ error: "Non autorisé" });
    }

    // Ajouter le chunk uploadé
    const existingChunk = metadata.uploadedChunks.find(
      (c) => c.index === chunkIndex
    );
    if (!existingChunk) {
      metadata.uploadedChunks.push({
        index: chunkIndex,
        checksum,
        size,
        etag, // Pour S3/R2
        uploadedAt: new Date(),
      });

      metadata.status = "uploading";
      await metadata.save();
    }

    const progress =
      (metadata.uploadedChunks.length / metadata.chunkCount) * 100;

    res.json({
      success: true,
      progress: Math.round(progress),
      uploadedChunks: metadata.uploadedChunks.length,
      totalChunks: metadata.chunkCount,
    });
  } catch (error) {
    console.error("Erreur ack-chunk:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /files/:id/complete-upload
router.post("/:id/complete-upload", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { uploadId, parts } = req.body;
    console.log("Voici le log dans complere body : ", req.body);
    const metadata = await FileMetadataModel.findOne({ fileId: id });
    if (!metadata) {
      return res.status(404).json({ error: "Fichier non trouvé" });
    }

    // Vérifier que tous les chunks sont uploadés
    if (metadata.uploadedChunks.length !== metadata.chunkCount) {
      return res.status(400).json({
        error: "Upload incomplet",
        missing: metadata.chunkCount - metadata.uploadedChunks.length,
      });
    }

    // Finaliser l'upload selon le provider
    if (metadata.provider === "R2" && uploadId && parts) {
      await _completeMultipartUpload(metadata.providerKey, uploadId, parts);
    } else if (metadata.provider === "B2" && parts) {
      await completeMultipartUpload(uploadId, parts);
    } else {
      throw new Error("Impossible de finaliser l’envoi");
    }

    // Marquer comme prêt
    metadata.status = "ready";
    await metadata.save();

    res.json({
      success: true,
      fileId: id,
      status: "ready",
      downloadUrl: `/api/files/${id}/download-urls`,
    });
  } catch (error) {
  //  console.error("Erreur complete-upload:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /files/:id/download-urls
router.get("/:id/download-urls", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const metadata = await FileMetadataModel.findOne({ fileId: id });
    if (!metadata) {
      return res.status(404).json({ error: "Fichier non trouvé" });
    }

    // Vérifier autorisation (uploader ou recipient)
    const hasAccess =
      metadata.uploaderId === req.userId ||
      metadata.recipients.includes(req.userId);

    if (!hasAccess) {
      return res.status(403).json({ error: "Non autorisé" });
    }

    if (metadata.status !== "ready") {
      return res
        .status(400)
        .json({ error: "Fichier non prêt", status: metadata.status });
    }

    // Incrémenter le compteur de téléchargements (atomique)
    await FileMetadataModel.updateOne(
      { fileId: id },
      {
        $inc: { downloadCount: 1 },
        $set: { lastDownloadAt: new Date() },
      }
    );

    // Vérifier si migration nécessaire
    if (
      metadata.provider === "B2" &&
      metadata.downloadCount + 1 >= config.POPULARITY_MIGRATION_THRESHOLD &&
      !metadata.migrationScheduled
    ) {
      // Programmer migration en arrière-plan
      metadata.migrationScheduled = true;
      await metadata.save();

      /*  // Déclencher job de migration (simplifié ici)
      setTimeout(() => {
        require("../workers/migrationWorker").migrateB2toR2(id);
      }, 1000); */
    }

    // Générer URLs de téléchargement
    let presignedUrls;
    if (metadata.provider === "B2") {
      presignedUrls = await generatePresignedGetUrls(
        metadata.providerKey,
        metadata.chunkCount
      );
    } else {
      presignedUrls = await _generatePresignedGetUrls(
        metadata.providerKey,
        metadata.chunkCount
      );
    }

    res.json({
      fileId: id,
      name: metadata.name,
      size: metadata.size,
      mimeType: metadata.mimeType,
      chunkCount: metadata.chunkCount,
      chunkSize,
      presignedUrls,
    });
  } catch (e) {
    console.error("Erreur lors du téléchargement de url", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
