/**
 * 🖼️ PiStream FFmpeg Seek & Custom Thumbnail Generator
 * Generates custom seekbar preview thumbnail images (JPEG) at specific timestamps
 * and caches them inside disk storage to avoid overloading the Raspberry Pi's processor.
 */

const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

/**
 * Extracts a 320x180 JPEG thumbnail frame at a specific timestamp
 * @param {string} videoPath 
 * @param {number} timeSeconds 
 * @param {string} outputDir 
 * @returns {Promise<string>} File path of the generated JPEG
 */
function generateThumbnailFrame(videoPath, timeSeconds, outputDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Standard cached filename format: thumb_second_152.jpg
    const thumbName = `thumb_sec_${Math.floor(timeSeconds)}.jpg`;
    const targetJpgPath = path.join(outputDir, thumbName);

    // Serve cached thumbnail if it already exists
    if (fs.existsSync(targetJpgPath)) {
      return resolve(targetJpgPath);
    }

    console.log(`📸 [FFmpeg Screenshot] Seeking to ${timeSeconds}s and capturing frame...`);

    ffmpeg(videoPath)
      .seekInput(timeSeconds)
      .frames(1)
      .size('320x180')
      .output(targetJpgPath)
      .on('end', () => {
        resolve(targetJpgPath);
      })
      .on('error', (err) => {
        console.warn(`[FFmpeg Screen Capture Failed]:`, err.message);
        reject(err);
      })
      .run();
  });
}

/**
 * Returns a base64 inline placeholder image when FFmpeg screenshots are still booting or fail
 */
function getPlaceholderThumbnail() {
  // Simple dark grey 16:9 box SVG in Base64
  return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMTgwIiB2aWV3Qm94PSIwIDAgMzIwIDE4MCI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iIzE4MTgxYSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmaWxsPSIjNTVVNTU1IiBmb250LXNpemU9IjE0IiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZHk9Ii4zZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiPkxvYWRpbmcgcHJldmlldy4uLjwvdGV4dD48L3N2Zz4=';
}

module.exports = {
  generateThumbnailFrame,
  getPlaceholderThumbnail
};
