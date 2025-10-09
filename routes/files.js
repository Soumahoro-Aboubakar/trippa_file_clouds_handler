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
/*
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
    console.error("Erreur complete-upload:", error);
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
}); */
///_____________________________Deuxième partie du côde ______________________________

router.post("/init-upload", auth, async (req, res) => {
  try {
    const { filename, mimeType, originalSize, recipients } = req.body;
    const userId = req.userId;
    const provider = originalSize <= config.THRESHOLD_LARGE_FILE ? "B2" : "R2";

    // Validation
    if (!filename || !mimeType || !originalSize) {
      return res.status(400).json({ error: "Paramètres manquants" });
    }

    // Calcul du nombre de chunks
    const chunkSize = config.CHUNK_SIZE;
    const chunkCount = Math.ceil(originalSize / chunkSize);

    // Génération d'un ID unique
    const fileId = randomUUID();
    const providerKey = `uploads/${userId}/${fileId}/${filename}`;

    // Génération des URLs signées selon le provider
    let presignedUrls;
    let uploadMetadata = {};

    if (provider === "B2") {
      const rawUrls = await generatePresignedPutUrls(fileId, chunkCount);
      
      // Enrichir les URLs avec toutes les métadonnées nécessaires
      presignedUrls = rawUrls.map(urlData => ({
        chunkIndex: urlData.chunkIndex,
        url: urlData.url,
        authToken: urlData.authToken,
        partNumber: urlData.partNumber,
        fileName: filename,
        fileId: urlData.fileId,
        method: urlData.method || "POST"
      }));

      // Métadonnées globales pour l'upload
      if (chunkCount > 1 && presignedUrls.length > 0) {
        uploadMetadata.b2FileId = presignedUrls[0].fileId;
        uploadMetadata.uploadId = presignedUrls[0].fileId;
        uploadMetadata.fileName = filename;
        uploadMetadata.isLargeFile = true;
      } else if (chunkCount === 1) {
        uploadMetadata.fileName = filename;
        uploadMetadata.isLargeFile = false;
      }
    } else if (provider === "R2") {
      const rawUrls = await _generatePresignedPutUrls(fileId, chunkCount);
      
      // Enrichir les URLs pour R2
      presignedUrls = rawUrls.map(urlData => ({
        chunkIndex: urlData.chunkIndex,
        url: urlData.url,
        partNumber: urlData.partNumber,
        uploadId: urlData.uploadId,
        method: urlData.method || "PUT"
      }));

      if (chunkCount > 1 && presignedUrls.length > 0) {
        uploadMetadata.uploadId = presignedUrls[0].uploadId;
        uploadMetadata.isMultipart = true;
      }
    } else {
      return res.status(400).json({ error: "Provider invalide" });
    }

    // Création de l'entrée en DB
    const fileMetadata = new FileMetadataModel({
      fileId,
      name: filename,
      size: originalSize,
      mimeType,
      provider,
      providerKey,
      chunkSize,
      chunkCount,
      uploaderId: userId,
      recipients: recipients || [],
      status: "init",
      uploadedChunks: [],
      expiresAt: new Date(
        Date.now() + config.FILE_TTL_DAYS * 24 * 60 * 60 * 1000
      ),
    });

    await fileMetadata.save();

    res.json({
      uploadId: fileId,
      fileId,
      provider,
      providerKey,
      chunkSize,
      chunkCount,
      presignedUrls, // URLs enrichies avec authToken et autres métadonnées
      uploadMetadata, // Métadonnées globales
      expiresAt: fileMetadata.expiresAt,
    });
  } catch (error) {
    console.error("Erreur init-upload:", error);
    res.status(500).json({ error: "Erreur lors de l'initialisation" });
  }
});

router.get("/upload/:uploadId/status", auth, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const userId = req.userId;

    const fileMetadata = await FileMetadataModel.findOne({
      fileId: uploadId,
      uploaderId: userId,
    });

    if (!fileMetadata) {
      return res.status(404).json({ error: "Upload introuvable" });
    }

    // Renvoyer la liste des chunks validés
    const uploadedChunks = fileMetadata.uploadedChunks.map((chunk) => ({
      index: chunk.index,
      checksum: chunk.checksum,
      size: chunk.size,
      etag: chunk.etag,
      uploadedAt: chunk.uploadedAt,
    }));

    res.json({
      uploadId: fileMetadata.fileId,
      status: fileMetadata.status,
      chunkCount: fileMetadata.chunkCount,
      uploadedChunkCount: uploadedChunks.length,
      uploadedChunks,
      isComplete: uploadedChunks.length === fileMetadata.chunkCount,
    });
  } catch (error) {
    console.error("Erreur status:", error);
    res.status(500).json({ error: "Erreur lors de la récupération du statut" });
  }
});

router.post("/upload/:uploadId/chunk/:chunkIndex", auth, async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.params;
    const { checksum, size, etag } = req.body;
    const userId = req.userId;

    if (!checksum || !size) {
      return res.status(400).json({ error: "Checksum et size requis" });
    }

    const fileMetadata = await FileMetadataModel.findOne({
      fileId: uploadId,
      uploaderId: userId,
    });

    if (!fileMetadata) {
      return res.status(404).json({ error: "Upload introuvable" });
    }

    const index = parseInt(chunkIndex);

    // Vérifier si le chunk existe déjà
    const existingChunk = fileMetadata.uploadedChunks.find(
      (c) => c.index === index
    );

    if (existingChunk) {
      // Idempotence: même checksum = ignorer
      if (existingChunk.checksum === checksum) {
        return res.json({
          message: "Chunk déjà reçu (idempotent)",
          alreadyExists: true,
          chunk: existingChunk,
        });
      } else {
        // Checksum différent = conflit
        return res.status(409).json({
          error: "Conflit de checksum",
          expected: existingChunk.checksum,
          received: checksum,
        });
      }
    }

    // Ajouter le chunk
    fileMetadata.uploadedChunks.push({
      index,
      checksum,
      size,
      etag: etag || "",
      uploadedAt: new Date(),
    });

    // Mettre à jour le statut
    if (fileMetadata.status === "init") {
      fileMetadata.status = "uploading";
    }

    await fileMetadata.save();

    res.json({
      message: "Chunk validé",
      chunk: { index, checksum, size, etag },
      uploadedChunkCount: fileMetadata.uploadedChunks.length,
      totalChunks: fileMetadata.chunkCount,
    });
  } catch (error) {
    console.error("Erreur validation chunk:", error);
    res.status(500).json({ error: "Erreur lors de la validation du chunk" });
  }
});

router.post("/complete-upload", auth, async (req, res) => {
  try {
    const { uploadId } = req.body;
    const userId = req.userId;
    if (!uploadId || !userId) {
      return res.status(400).json({ error: "uploadId manquant" });
    }
    const fileMetadata = await FileMetadataModel.findOne({
      fileId: uploadId,
      uploaderId: userId,
    });
    if (!fileMetadata) {
      return res.status(404).json({ error: "Upload introuvable" });
    }

    // Vérifier que tous les chunks sont présents
    if (fileMetadata.uploadedChunks.length !== fileMetadata.chunkCount) {
      return res.status(400).json({
        error: "Upload incomplet",
        received: fileMetadata.uploadedChunks.length,
        expected: fileMetadata.chunkCount,
      });
    }

    // Trier les chunks par index
    const sortedChunks = fileMetadata.uploadedChunks.sort(
      (a, b) => a.index - b.index
    );

    // Finaliser selon le provider
    let completeResult;
    const provider = fileMetadata.provider;

    if (provider === "B2" && fileMetadata.chunkCount > 1) {
      const b2FileId = req.body.b2FileId;
      if (!b2FileId) {
        return res.status(400).json({ error: "b2FileId manquant" });
      }

      // B2 attend des SHA1, pas des SHA256
      // En pratique, B2 calcule lui-même les SHA1 lors de l'upload
      // On envoie les SHA1 fournis par le client ou on les laisse vides
      const parts = sortedChunks.map((chunk) => ({
        sha1: chunk.etag || "none", // B2 tolère 'none' si auto-calculé
      }));

      completeResult = await completeMultipartUpload(b2FileId, parts);
    } else if (provider === "R2" && fileMetadata.chunkCount > 1) {
      const r2UploadId = req.body.uploadId;
      if (!r2UploadId) {
        return res.status(400).json({ error: "uploadId R2 manquant" });
      }

      const parts = sortedChunks.map((chunk) => ({
        etag: chunk.etag,
      }));

      completeResult = await _completeMultipartUpload(
        fileMetadata.providerKey,
        r2UploadId,
        parts
      );
    }

    // Marquer comme ready
    fileMetadata.status = "ready";
    await fileMetadata.save();

    res.json({
      message: "Upload finalisé",
      fileId: fileMetadata.fileId,
      providerKey: fileMetadata.providerKey,
      status: "ready",
      completeResult,
    });
  } catch (error) {
    console.error("Erreur complete-upload:", error);
    res.status(500).json({ error: "Erreur lors de la finalisation" });
  }
});

router.delete("/abort-upload/:uploadId", auth, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const userId = req.userId;

    const fileMetadata = await FileMetadataModel.findOne({
      fileId: uploadId,
      uploaderId: userId,
    });

    if (!fileMetadata) {
      return res.status(404).json({ error: "Upload introuvable" });
    }

    // Marquer comme aborted (MongoDB TTL s'occupera du nettoyage)
    fileMetadata.status = "error";
    fileMetadata.expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Expire dans 1h
    await fileMetadata.save();

    // TODO: Appeler l'API du provider pour supprimer les parts uploadées
    // B2: b2_cancel_large_file ou b2_delete_file_version
    // R2: AbortMultipartUpload

    res.json({
      message: "Upload annulé",
      uploadId: fileMetadata.fileId,
    });
  } catch (error) {
    console.error("Erreur abort-upload:", error);
    res.status(500).json({ error: "Erreur lors de l'annulation" });
  }
});

/**
 * POST /api/files/refresh-url/:uploadId/:chunkIndex
 * Régénère une URL signée expirée
 */
router.post("/refresh-url/:uploadId/:chunkIndex", auth, async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.params;
    const userId = req.userId;

    const fileMetadata = await FileMetadataModel.findOne({
      fileId: uploadId,
      uploaderId: userId,
    });

    if (!fileMetadata) {
      return res.status(404).json({ error: "Upload introuvable" });
    }

    const index = parseInt(chunkIndex);
    if (isNaN(index) || index < 0 || index >= fileMetadata.chunkCount) {
      return res.status(400).json({ error: "Chunk index invalide" });
    }

    // Régénérer une seule URL avec toutes les métadonnées
    let newUrlData;
    if (fileMetadata.provider === "B2") {
      const urls = await generatePresignedPutUrls(
        fileMetadata.fileId,
        fileMetadata.chunkCount
      );
      const rawUrl = urls.find((u) => u.chunkIndex === index);
      
      if (rawUrl) {
        newUrlData = {
          chunkIndex: index,
          url: rawUrl.url,
          authToken: rawUrl.authToken,
          partNumber: rawUrl.partNumber,
          fileName: fileMetadata.name,
          fileId: rawUrl.fileId,
          method: rawUrl.method || "POST"
        };
      }
    } else if (fileMetadata.provider === "R2") {
      const urls = await _generatePresignedPutUrls(
        fileMetadata.fileId,
        fileMetadata.chunkCount
      );
      const rawUrl = urls.find((u) => u.chunkIndex === index);
      
      if (rawUrl) {
        newUrlData = {
          chunkIndex: index,
          url: rawUrl.url,
          partNumber: rawUrl.partNumber,
          uploadId: rawUrl.uploadId,
          method: rawUrl.method || "PUT"
        };
      }
    }

    if (!newUrlData) {
      return res.status(500).json({ error: "Impossible de régénérer l'URL" });
    }

    res.json(newUrlData);
  } catch (error) {
    console.error("Erreur refresh-url:", error);
    res.status(500).json({ error: "Erreur lors de la régénération de l'URL" });
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

  
    }

    // Générer URLs de téléchargement
    let presignedUrls;
    if (metadata.provider === "B2") {
      presignedUrls = await generatePresignedGetUrls(
        metadata.fileId,
        metadata.chunkCount
      );
    } else {
      presignedUrls = await _generatePresignedGetUrls(
        metadata.fileId,
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
