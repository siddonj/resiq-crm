const crypto = require('crypto');

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
}

module.exports = new TrackingService();