/**
 * File Storage Service
 * Handles uploads and downloads for client portal
 * Supports local filesystem and cloud storage (S3, Firebase, etc.)
 * 
 * Configuration via environment variables:
 * - FILE_STORAGE_TYPE: 'local' | 's3' | 'firebase' (default: 'local')
 * - FILE_UPLOAD_PATH: local path for uploads (default: './uploads')
 * - AWS_S3_BUCKET, AWS_S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (for S3)
 * - FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL (for Firebase)
 */

const fs = require('fs');
const path = require('path');
const pool = require('../models/db');

const storageType = process.env.FILE_STORAGE_TYPE || 'local';
const uploadPath = process.env.FILE_UPLOAD_PATH || './uploads';

// Ensure upload directory exists for local storage
if (storageType === 'local' && !fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

/**
 * Upload file to storage backend
 * @param {string} fileBuffer - File buffer content
 * @param {string} fileName - Original filename
 * @param {string} mimeType - File MIME type
 * @returns {Object} { storagePath, url, size }
 */
async function uploadFile(fileBuffer, fileName, mimeType) {
  try {
    if (storageType === 'local') {
      return uploadLocal(fileBuffer, fileName, mimeType);
    } else if (storageType === 's3') {
      return uploadS3(fileBuffer, fileName, mimeType);
    } else if (storageType === 'firebase') {
      return uploadFirebase(fileBuffer, fileName, mimeType);
    }
  } catch (err) {
    console.error(`Error uploading file (${storageType}):`, err);
    throw err;
  }
}

/**
 * Local filesystem upload
 */
function uploadLocal(fileBuffer, fileName, mimeType) {
  const fileId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const ext = path.extname(fileName);
  const storageName = `${fileId}${ext}`;
  const storagePath = path.join(uploadPath, storageName);

  fs.writeFileSync(storagePath, fileBuffer);

  return {
    storagePath,
    url: `/api/files/download/${fileId}`,
    size: fileBuffer.length,
    mimeType,
    fileName,
  };
}

/**
 * AWS S3 upload (requires AWS SDK)
 */
async function uploadS3(fileBuffer, fileName, mimeType) {
  try {
    const AWS = require('aws-sdk');
    const s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_S3_REGION || 'us-east-1',
    });

    const fileId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const ext = path.extname(fileName);
    const key = `client-portal/${fileId}${ext}`;

    const params = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
      ACL: 'private',
    };

    const result = await s3.upload(params).promise();

    return {
      storagePath: key,
      url: `/api/files/download/${fileId}`,
      size: fileBuffer.length,
      mimeType,
      fileName,
    };
  } catch (err) {
    console.error('S3 upload error:', err);
    throw new Error('Failed to upload to S3');
  }
}

/**
 * Firebase Storage upload (requires Firebase Admin SDK)
 */
async function uploadFirebase(fileBuffer, fileName, mimeType) {
  try {
    const admin = require('firebase-admin');
    const bucket = admin.storage().bucket();

    const fileId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const ext = path.extname(fileName);
    const filePath = `client-portal/${fileId}${ext}`;

    const file = bucket.file(filePath);

    await file.save(fileBuffer, {
      metadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=3600',
      },
    });

    // Generate signed URL valid for 1 hour
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 3600 * 1000,
    });

    return {
      storagePath: filePath,
      url: signedUrl,
      size: fileBuffer.length,
      mimeType,
      fileName,
    };
  } catch (err) {
    console.error('Firebase upload error:', err);
    throw new Error('Failed to upload to Firebase');
  }
}

/**
 * Generate signed URL for file download (for S3/Firebase)
 */
async function getSignedUrl(storagePath) {
  try {
    if (storageType === 'local') {
      return `/api/files/download/${path.basename(storagePath, path.extname(storagePath))}`;
    } else if (storageType === 's3') {
      const AWS = require('aws-sdk');
      const s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_S3_REGION || 'us-east-1',
      });

      return s3.getSignedUrl('getObject', {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: storagePath,
        Expires: 3600,
      });
    } else if (storageType === 'firebase') {
      const admin = require('firebase-admin');
      const bucket = admin.storage().bucket();
      const file = bucket.file(storagePath);

      const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 3600 * 1000,
      });

      return signedUrl;
    }
  } catch (err) {
    console.error('Error generating signed URL:', err);
    throw err;
  }
}

/**
 * Download file from local storage
 */
function downloadLocal(fileId) {
  // Search for file by ID prefix (handles various extensions)
  const files = fs.readdirSync(uploadPath);
  const file = files.find(f => f.startsWith(fileId));

  if (!file) {
    return null;
  }

  const filePath = path.join(uploadPath, file);
  return {
    buffer: fs.readFileSync(filePath),
    fileName: file,
  };
}

/**
 * Get file from storage backend
 */
async function downloadFile(fileId) {
  try {
    if (storageType === 'local') {
      return downloadLocal(fileId);
    }
    // For S3 and Firebase, clients access via signed URLs directly
    throw new Error('File download not supported for this storage type');
  } catch (err) {
    console.error(`Error downloading file (${storageType}):`, err);
    throw err;
  }
}

/**
 * Delete file from storage
 */
async function deleteFile(storagePath) {
  try {
    if (storageType === 'local') {
      const filePath = path.join(uploadPath, path.basename(storagePath));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } else if (storageType === 's3') {
      const AWS = require('aws-sdk');
      const s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_S3_REGION || 'us-east-1',
      });

      await s3.deleteObject({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: storagePath,
      }).promise();
    } else if (storageType === 'firebase') {
      const admin = require('firebase-admin');
      await admin.storage().bucket().file(storagePath).delete();
    }
  } catch (err) {
    console.error('Error deleting file:', err);
    throw err;
  }
}

module.exports = {
  uploadFile,
  downloadFile,
  deleteFile,
  getSignedUrl,
};
