/**
 * Code.gs
 * Server-side Apps Script for indexing Drive images and serving a lightweight JSON index.
 *
 * Requirements:
 *  - Enable Advanced Drive Service: Resources > Advanced Google services > Drive API v2 (or v3)
 *  - In Google Cloud Console enable Drive API for the project if prompted.
 *
 * Setup:
 *  - Set FOLDER_ID to the Drive folder where form uploads land.
 *  - Deploy as Web App (Execute as: Me; Who has access: Anyone, even anonymous) if you want public display.
 *  - Create two triggers:
 *      1) Installable Form Submit trigger -> onFormSubmit
 *      2) Time-driven trigger (e.g., every 5 minutes) -> reconcileFolder
 *
 * Notes:
 *  - This script sets each new file's permission to "anyoneWithLink" reader so the standee can fetch images without auth.
 *  - The index is stored as a Drive file named "index.json" in the same folder for persistence.
 */

/** CONFIGURATION **/
const FOLDER_ID = '1H8PvuSmujx6TSFh3ELzMb77LS0i_cxJ6wCXFNiOpvxbGUvMUjou18xN0J_YZDhIKIf2GnvrU'; // <-- replace with your folder ID
const INDEX_FILENAME = 'index.json';
const MAX_INDEX_ITEMS = 2000; // keep a cap to avoid huge index; tune as needed

/**
 * doGet: serves the web app HTML or the JSON index endpoint.
 * - / -> HTML page
 * - /?action=index -> returns JSON index
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'index') {
    const index = getIndex();
    return ContentService.createTextOutput(JSON.stringify(index))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // Serve the HTML UI
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Waterfall Collage')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * onFormSubmit: installable trigger for form submissions.
 * When a form with file upload is submitted, this runs and reconciles new files.
 */
function onFormSubmit(e) {
  // Best-effort: process new files added to the folder
  try {
    processNewFiles();
  } catch (err) {
    console.error('onFormSubmit error: ' + err);
  }
}

/**
 * reconcileFolder: time-driven trigger to reconcile folder contents with index.
 * Run every 1-5 minutes as a fallback to catch missed files.
 */
function reconcileFolder() {
  try {
    processNewFiles();
  } catch (err) {
    console.error('reconcileFolder error: ' + err);
  }
}

/**
 * processNewFiles: scans the folder, finds files not in index, sets public permission,
 * extracts metadata (thumbnailLink, webContentLink, width, height), and appends to index.
 */
function processNewFiles() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const index = getIndex(); // array of metadata objects
  const knownIds = new Set(index.map(item => item.id));
  const files = folder.getFiles();
  const newItems = [];

  // Use Drive API to fetch richer metadata (thumbnailLink, imageMediaMetadata)
  while (files.hasNext()) {
    const file = files.next();
    const id = file.getId();
    const mime = file.getMimeType();

    // Only process images
    if (!mime || !mime.startsWith('image/')) continue;
    if (knownIds.has(id)) continue;

    // Make file readable by anyone with link (so the standee can fetch without auth)
    try {
      // Check existing permissions via Drive API; then insert if needed
      // Using Advanced Drive Service (Drive)
      const perms = Drive.Permissions.list(id).items || [];
      const hasAnyone = perms.some(p => p.type === 'anyone');
      if (!hasAnyone) {
        Drive.Permissions.insert(
          { role: 'reader', type: 'anyone' },
          id
        );
      }
    } catch (permErr) {
      // If permission fails, log and continue; the file may still be accessible if folder is shared.
      console.warn('Permission set failed for ' + id + ': ' + permErr);
    }

    // Get file metadata via Drive API
    try {
      const fields = 'id,mimeType,thumbnailLink,webContentLink,webViewLink,imageMediaMetadata,createdDate';
      const meta = Drive.Files.get(id, { fields: fields });
      const thumb = meta.thumbnailLink || meta.webContentLink || getPublicDownloadUrl(id);
      const webContent = meta.webContentLink || getPublicDownloadUrl(id);
      const width = meta.imageMediaMetadata && meta.imageMediaMetadata.width ? meta.imageMediaMetadata.width : null;
      const height = meta.imageMediaMetadata && meta.imageMediaMetadata.height ? meta.imageMediaMetadata.height : null;
      const created = meta.createdDate || new Date().toISOString();

      const item = {
        id: id,
        mimeType: meta.mimeType || mime,
        thumb: thumb,
        url: webContent,
        width: width,
        height: height,
        created: created
      };

      newItems.push(item);
      knownIds.add(id);
    } catch (metaErr) {
      console.warn('Drive API metadata fetch failed for ' + id + ': ' + metaErr);
      // Fallback minimal metadata
      newItems.push({
        id: id,
        mimeType: mime,
        thumb: getPublicDownloadUrl(id),
        url: getPublicDownloadUrl(id),
        width: null,
        height: null,
        created: new Date().toISOString()
      });
      knownIds.add(id);
    }
  }

  if (newItems.length > 0) {
    // Append new items at the front (newest first)
    const merged = newItems.concat(index);
    // Trim to MAX_INDEX_ITEMS
    const trimmed = merged.slice(0, MAX_INDEX_ITEMS);
    saveIndex(trimmed);
    console.log('Added ' + newItems.length + ' new items to index.');
  } else {
    console.log('No new images found.');
  }
}

/**
 * getIndex: reads index.json from the folder; returns array.
 * If missing, returns [].
 */
function getIndex() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files = folder.getFilesByName(INDEX_FILENAME);
  if (files.hasNext()) {
    const file = files.next();
    try {
      const content = file.getBlob().getDataAsString();
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch (err) {
      console.warn('Failed to parse index.json: ' + err);
      return [];
    }
  } else {
    return [];
  }
}

/**
 * saveIndex: writes index array to index.json in the folder (overwrites existing).
 */
function saveIndex(indexArray) {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files = folder.getFilesByName(INDEX_FILENAME);
  const content = JSON.stringify(indexArray);
  if (files.hasNext()) {
    const file = files.next();
    file.setContent(content);
  } else {
    folder.createFile(INDEX_FILENAME, content, MimeType.PLAIN_TEXT);
  }
}

/**
 * getPublicDownloadUrl: fallback to construct a download URL that works for files with "anyoneWithLink" permission.
 */
function getPublicDownloadUrl(fileId) {
  return 'https://drive.google.com/uc?export=download&id=' + fileId;
}

/**
 * Utility: clearIndex (for debugging)
 */
function clearIndex() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files = folder.getFilesByName(INDEX_FILENAME);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
  Logger.log('index.json removed.');
}

function getIndexData() {
  return getIndex(); // returns the array of photo objects
}
