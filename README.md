# Form-to-Photos setup guide

This Apps Script indexes photos uploaded through a Google Form (or any Drive folder) and exposes a lightweight JSON feed plus a simple waterfall-style viewer.

## What was broken
- The previous `FOLDER_ID` constant was truncated, causing a syntax error and preventing the script from running.
- There was no straightforward way to point the script at a new uploads folder for another form.

The code now reads the folder ID from a script property (set via `setFolderId()`), so you can reuse the project with different forms without editing source files.

## One-time script configuration
1. Open **Extensions → Apps Script** in your Sheet or Form response destination and paste `Code.gs` and `Index.html` into the project.
2. Turn on the **Drive API** in the editor: **Services → + → Drive API** (this is the Advanced Drive service).
3. Set the uploads folder ID (either the form response folder or any folder containing images):
   - In the Script Editor, open **Services → Script Properties** and add `PHOTOS_FOLDER_ID` with the folder ID, **or** run the function `setFolderId('<your-folder-id>')` once from **Run**.
4. Deploy the web app (for the viewer): **Deploy → New deployment → Web app**
   - **Execute as:** Me
   - **Who has access:** Anyone (or anyone with the link) depending on your needs.

## Connect to a new Form (recommended test flow)
1. Create a new Google Form with a **File upload** question. Google will create an uploads folder for that form.
2. In the Form editor, open **Settings → Responses** and click the folder link to open the uploads folder. Copy its ID from the URL.
3. In Apps Script, run `setFolderId('<copied-id>')` to point the script at this uploads folder.
4. Add two triggers ( **Triggers → + Add Trigger** ):
   - **Function:** `onFormSubmit` | **Event source:** From form | **Event type:** On form submit
   - **Function:** `reconcileFolder` | **Event source:** Time-driven | **Type:** Every 5 minutes (or similar)

## Test that everything works
1. Submit the form with one or more images.
2. In **Executions** or **Logs**, confirm `processNewFiles` runs without folder errors.
3. Open the web app URL you deployed. You should see the waterfall collage; the `Photos: X` badge updates as images arrive.
4. If images are not visible, verify the uploads folder has **Anyone with the link: Viewer** permissions on the files (the script attempts to set this automatically via the Drive API).

## Maintenance tips
- Run `clearIndex()` from the editor if you need to rebuild the `index.json` file.
- To switch forms/folders later, run `setFolderId('<new-folder-id>')` again.
- The index is capped at 2000 entries; adjust `MAX_INDEX_ITEMS` in `Code.gs` if you need a different limit.
