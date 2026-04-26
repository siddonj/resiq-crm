const { v4: uuidv4 } = require('uuid');
const pool = require('../models/db');

class TrackingService {
  constructor() {
    this.baseUrl = process.env.API_URL || 'http://localhost:5000';
  }

  getPixelUrl(userId, contactId, subject = null) {
    const data = { userId, contactId, type: 'email_opened', subject };
    const dataString = Buffer.from(JSON.stringify(data)).toString('base64');
    return `${this.baseUrl}/api/track/pixel.png?d=${dataString}`;
  }

  getTrackedLink(url, userId, contactId) {
    const data = { userId, contactId, url, type: 'link_clicked' };
    const dataString = Buffer.from(JSON.stringify(data)).toString('base64');
    return `${this.baseUrl}/api/track/link?d=${dataString}`;
  }

  injectTrackingIntoHtml(html, userId, contactId, subject = null) {
    const pixelUrl = this.getPixelUrl(userId, contactId, subject);
    const pixelImg = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />`;
    
    let trackedHtml = html;
    const linkRegex = /href=["'](http[^\n"']+)["']/gi;
    
    trackedHtml = trackedHtml.replace(linkRegex, (match, url) => {
      if (url.includes('/api/track')) return match; 
      const trackedUrl = this.getTrackedLink(url, userId, contactId);
      return `href="${trackedUrl}"`;
    });

    if (trackedHtml.includes('</body>')) {
      trackedHtml = trackedHtml.replace('</body>', `${pixelImg}</body>`);
    } else {
      trackedHtml += pixelImg;
    }

    return trackedHtml;
  }

  // Create a new engagement tracking record for an asset (proposal, invoice, etc)
  async createEngagementTracking(userId, contactId, assetType, assetId) {
    try {
      const trackingId = uuidv4();
      const result = await pool.query(
        `INSERT INTO engagement_tracking (user_id, contact_id, tracking_id, asset_type, asset_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, contactId, trackingId, assetType, assetId]
      );
      return {
        tracking: result.rows[0],
        pixelUrl: `${this.baseUrl}/api/track/${trackingId}.png`
      };
    } catch (error) {
      console.error('Error creating engagement tracking:', error);
      throw error;
    }
  }

  // Inject tracking pixel into HTML for an asset
  async injectAssetPixel(html, userId, contactId, assetType, assetId) {
    try {
      const { pixelUrl } = await this.createEngagementTracking(userId, contactId, assetType, assetId);
      const pixelImg = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />`;
      
      let trackedHtml = html;
      if (trackedHtml.includes('</body>')) {
        trackedHtml = trackedHtml.replace('</body>', `${pixelImg}</body>`);
      } else {
        trackedHtml += pixelImg;
      }
      return trackedHtml;
    } catch (error) {
      console.error('Error injecting asset pixel:', error);
      return html; // Return untracked HTML on error
    }
  }

  // Get tracking pixel URL for an asset (without creating record)
  getAssetPixelUrl(trackingId) {
    return `${this.baseUrl}/api/track/${trackingId}.png`;
  }
}

module.exports = new TrackingService();