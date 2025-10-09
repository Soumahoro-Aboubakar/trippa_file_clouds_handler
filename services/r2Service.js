import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import config from "../config/index.js";
import https from "https";
import stream from "stream";

// Initialisation du client R2 (AWS SDK v3)
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  },
});

class R2Service {
  /**
   * Générer des URLs signées pour uploader des fichiers (PUT ou multipart)
   */
  async generatePresignedPutUrls(fileId, chunkCount) {
    const urls = [];

    if (chunkCount > 1) {
      // Démarrer un upload multipart
      const multipart = await s3.send(new CreateMultipartUploadCommand({
        Bucket: config.R2_BUCKET_NAME,
        Key: fileId,
        ContentType: "application/octet-stream",
      }));

      const uploadId = multipart.UploadId;

      for (let i = 0; i < chunkCount; i++) {
        const command = new UploadPartCommand({
          Bucket: config.R2_BUCKET_NAME,
          Key: fileId,
          PartNumber: i + 1,
          UploadId: uploadId,
        });

        const url = await getSignedUrl(s3, command, {
          expiresIn: config.PRESIGNED_URL_EXPIRY,
        });

        urls.push({
          chunkIndex: i,
          url,
          uploadId,
          partNumber: i + 1,
          method: "POST",
        });
      }
    } else {
      const command = new PutObjectCommand({
        Bucket: config.R2_BUCKET_NAME,
        Key: fileId,
      });

      const url = await getSignedUrl(s3, command, {
        expiresIn: config.PRESIGNED_URL_EXPIRY,
      });

      urls.push({
        chunkIndex: 0,
        url,
        method: "POST",
      });
    }

    return urls;
  }

  /**
   * Générer des URLs signées pour télécharger un fichier
   */
  async generatePresignedGetUrls(fileId, chunkCount) {
    const urls = [];

    for (let i = 0; i < chunkCount; i++) {
     // const chunkKey = chunkCount > 1 ? `${providerKey}_chunk_${i}` : providerKey;

      const command = new GetObjectCommand({
        Bucket: config.R2_BUCKET_NAME,
        Key: fileId,
      });

      const url = await getSignedUrl(s3, command, {
        expiresIn: config.PRESIGNED_URL_EXPIRY,
      });

      urls.push({
        chunkIndex: i,
        url,
        method: "GET",
      });
    }

    return urls;
  }

  /**
   * Finaliser un upload multipart
   */
  async completeMultipartUpload(fileId, uploadId, parts) {
    return await s3.send(new CompleteMultipartUploadCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: fileId,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part, index) => ({
          ETag: part.etag,
          PartNumber: index + 1,
        })),
      },
    }));
  }

  /**
   * Télécharger un fichier en streaming
   */
  async streamDownload(providerKey, onChunk) {
    const command = new GetObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: providerKey,
    });

    const response = await s3.send(command);
    const bodyStream = response.Body;

    return new Promise((resolve, reject) => {
      bodyStream.on("data", onChunk);
      bodyStream.on("end", resolve);
      bodyStream.on("error", reject);
    });
  }

  /**
   * Copier un fichier depuis une URL externe vers R2
   */
  async copyFromUrl(sourceUrl, destKey, onProgress) {
    return new Promise((resolve, reject) => {
      https.get(sourceUrl, (response) => {
        const passThrough = new stream.PassThrough();

        response.pipe(passThrough);

        const command = new PutObjectCommand({
          Bucket: config.R2_BUCKET_NAME,
          Key: destKey,
          Body: passThrough,
          ContentType: "application/octet-stream",
        });

        s3.send(command)
          .then(resolve)
          .catch(reject);

        // ⚠️ SDK v3 n'a pas de `.on("httpUploadProgress")` par défaut
        // il faut utiliser @aws-sdk/lib-storage si tu veux suivre la progression
      }).on("error", reject);
    });
  }

  /**
   * Supprimer un fichier
   */
  async deleteFile(providerKey) {
    return await s3.send(new DeleteObjectCommand({
      Bucket: config.R2_BUCKET_NAME,
      Key: providerKey,
    }));
  }
}

// Exports
export const generatePresignedPutUrls = (fileId, chunkCount) =>
  new R2Service().generatePresignedPutUrls(fileId, chunkCount);

export const generatePresignedGetUrls = (providerKey, chunkCount) =>
  new R2Service().generatePresignedGetUrls(providerKey, chunkCount);

export const completeMultipartUpload = (providerKey, uploadId, parts) =>
  new R2Service().completeMultipartUpload(providerKey, uploadId, parts);

export default new R2Service();
