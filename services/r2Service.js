// backend/services/r2Service.js
import AWS from 'aws-sdk'; // ← Changement ici
import config from '../config/index.js';

class R2Service {
  constructor() {
    this.s3 = new AWS.S3({
      endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
      region: 'auto',
      signatureVersion: 'v4',
    });
  }

  async generatePresignedPutUrls(fileId, chunkCount) {
    const urls = [];
    
    if (chunkCount > 1) {
      const multipart = await this.s3.createMultipartUpload({
        Bucket: config.R2_BUCKET_NAME,
        Key: fileId,
        ContentType: 'application/octet-stream',
      }).promise();

      const uploadId = multipart.UploadId;
      
      for (let i = 0; i < chunkCount; i++) {
        const url = this.s3.getSignedUrl('uploadPart', {
          Bucket: config.R2_BUCKET_NAME,
          Key: fileId,
          PartNumber: i + 1,
          UploadId: uploadId,
          Expires: config.PRESIGNED_URL_EXPIRY,
        });
        
        urls.push({
          chunkIndex: i,
          url: url,
          uploadId: uploadId,
          partNumber: i + 1,
          method: 'PUT'
        });
      }
    } else {
      const url = this.s3.getSignedUrl('putObject', {
        Bucket: config.R2_BUCKET_NAME,
        Key: fileId,
        Expires: config.PRESIGNED_URL_EXPIRY,
      });
      
      urls.push({
        chunkIndex: 0,
        url: url,
        method: 'PUT'
      });
    }
    
    return urls;
  }

  async generatePresignedGetUrls(providerKey, chunkCount) {
    const urls = [];
    
    for (let i = 0; i < chunkCount; i++) {
      const chunkKey = chunkCount > 1 ? `${providerKey}_chunk_${i}` : providerKey;
      
      const url = this.s3.getSignedUrl('getObject', {
        Bucket: config.R2_BUCKET_NAME,
        Key: chunkKey,
        Expires: config.PRESIGNED_URL_EXPIRY,
      });
      
      urls.push({
        chunkIndex: i,
        url: url,
        method: 'GET'
      });
    }
    
    return urls;
  }

  async completeMultipartUpload(providerKey, uploadId, parts) {
    return await this.s3.completeMultipartUpload({
      Bucket: config.R2_BUCKET_NAME,
      Key: providerKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part, index) => ({
          ETag: part.etag,
          PartNumber: index + 1,
        })),
      },
    }).promise();
  }

  async streamDownload(providerKey, onChunk) {
    const stream = this.s3.getObject({
      Bucket: config.R2_BUCKET_NAME,
      Key: providerKey,
    }).createReadStream();
    
    return new Promise((resolve, reject) => {
      stream.on('data', onChunk);
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  }

  async copyFromUrl(sourceUrl, destKey, onProgress) {
    const https = require('https');
    const stream = require('stream');
    
    return new Promise((resolve, reject) => {
      https.get(sourceUrl, (response) => {
        const passThrough = new stream.PassThrough();
        
        response.pipe(passThrough);
        
        const upload = this.s3.upload({
          Bucket: config.R2_BUCKET_NAME,
          Key: destKey,
          Body: passThrough,
          ContentType: 'application/octet-stream',
        });
        
        upload.on('httpUploadProgress', (progress) => {
          if (onProgress) onProgress(progress);
        });
        
        upload.send((err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      }).on('error', reject);
    });
  }

  async deleteFile(providerKey) {
    return await this.s3.deleteObject({
      Bucket: config.R2_BUCKET_NAME,
      Key: providerKey,
    }).promise();
  }
}

export default new R2Service();