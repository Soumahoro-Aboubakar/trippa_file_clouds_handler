// backend/services/b2Service.js
import B2 from "backblaze-b2";
import config from "../config/index.js";

class B2Service {
  constructor() {
    this.b2 = new B2({
      applicationKeyId: config.B2_KEY_ID,
      applicationKey: config.B2_APPLICATION_KEY,
    });
    this.authorized = false;
  }

  async authorize() {
    if (!this.authorized) {
      await this.b2.authorize();
      this.authorized = true;
    }
  }

async generatePresignedPutUrls(fileId, chunkCount) {
  await this.authorize();
  const urls = [];

    for (let i = 0; i < chunkCount; i++) {
      const uploadUrl = await this.b2.getUploadUrl({
        bucketId: config.B2_BUCKET_ID,
      });
      console.log(uploadUrl, " voici le log uploadUrl");
      urls.push({
        chunkIndex: i, 
        url: uploadUrl.data.uploadUrl,
        authToken: uploadUrl.data.authorizationToken,
        method: "POST",
      });
  }
  
  return urls;
}

  async generatePresignedGetUrls(providerKey, chunkCount) {
    /*  await this.authorize();
    
    const urls = [];
    
    for (let i = 0; i < chunkCount; i++) {
      // Générer URL de téléchargement avec autorisation
      const downloadAuth = await this.b2.getDownloadAuthorization({
        bucketId: config.B2_BUCKET_ID,
        fileNamePrefix: providerKey,
        validDurationInSeconds: config.PRESIGNED_URL_EXPIRY,
      });
      
      urls.push({
        chunkIndex: i,
        url: `${this.b2.downloadUrl}/file/${config.B2_BUCKET_NAME}/${providerKey}_chunk_${i}`,
        authToken: downloadAuth.data.authorizationToken,
        method: 'GET'
      });
    }
    
    return urls; */
    await this.authorize();

    const downloadAuth = await this.b2.getDownloadAuthorization({
      bucketId: config.B2_BUCKET_ID,
      fileNamePrefix: `${providerKey}_chunk_`,
      validDurationInSeconds: config.PRESIGNED_URL_EXPIRY,
    });

    const urls = [];
    for (let i = 0; i < chunkCount; i++) {
      urls.push({
        chunkIndex: i,
        url: `${this.b2.downloadUrl}/file/${config.B2_BUCKET_NAME}/${providerKey}_chunk_${i}`,
        authToken: downloadAuth.data.authorizationToken, // le même pour tous
        method: "GET",
      });
    }

    return urls;
  }

  async completeMultipartUpload(fileId, parts) {
    await this.authorize();

    return await this.b2.finishLargeFile({
      fileId: fileId,
      partSha1Array: parts.map((p) => p.sha1),
    });
  }

  async streamDownload(providerKey, onChunk) {
    await this.authorize();

    const stream = await this.b2.downloadFileByName({
      bucketName: config.B2_BUCKET_NAME, //A revoir
      fileName: providerKey,
    });

    return new Promise((resolve, reject) => {
      stream.on("data", onChunk);
      stream.on("end", resolve);
      stream.on("error", reject);
    });
  }

  async deleteFile(fileId) {
    await this.authorize();
    /* 
    // Récupérer les info du fichier
    const fileInfo = await this.b2.getFileInfo({
      fileId
    }); */

    return await this.b2.deleteFileVersion({
      fileId,
      fileName: providerKey,
    });
  }
}


export const generatePresignedPutUrls = (fileId, chunkCount) => new B2Service().generatePresignedPutUrls(fileId, chunkCount);
export const generatePresignedGetUrls = (providerKey, chunkCount) => new B2Service().generatePresignedGetUrls(providerKey, chunkCount);
export const completeMultipartUpload = (fileId, parts) => new B2Service().completeMultipartUpload(fileId, parts);

export default new B2Service();