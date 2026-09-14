// ============================================
// GOOGLE DRIVE VIDEO STORAGE
// Replaces the old IndexedDB-backed storage for the "Add Video" feature
// with Google Drive, so videos you upload live in YOUR Google Drive
// instead of one specific browser - they follow you to a new PC.
//
// -------------------------------------------------------------------------
// ONE-TIME SETUP (only you can do this - it needs your own Google login)
// -------------------------------------------------------------------------
// 1. Go to https://console.cloud.google.com/ and create a new project
//    (top-left project dropdown -> New Project). Any name is fine.
// 2. Left menu -> APIs & Services -> Library -> search "Google Drive API"
//    -> Enable.
// 3. Left menu -> APIs & Services -> OAuth consent screen
//    -> User type: External -> Create.
//    -> Fill in an app name, your email as support/developer contact
//       -> Save and continue through the remaining steps (scopes/test
//       users can be left as default).
//    -> On the "Test users" step, add your own Google account's email,
//       otherwise Google will block you from signing in to your own app
//       while it's in testing mode.
// 4. Left menu -> APIs & Services -> Credentials
//    -> + Create Credentials -> OAuth client ID
//    -> Application type: Web application
//    -> Authorized JavaScript origins -> Add URI -> the exact URL you run
//       this portal from, e.g. http://localhost:8000
//    -> Create.
// 5. Copy the "Client ID" it shows you (ends in .apps.googleusercontent.com)
//    and paste it as GOOGLE_CLIENT_ID below.
//
// This Client ID is NOT a secret - Google's own docs say it's fine to embed
// directly in frontend JavaScript (unlike an API key or client secret).
// It only identifies which app is asking; Google still requires the actual
// user to approve sign-in every time, and the app can only touch files it
// itself created (see DRIVE_SCOPE below) - never the user's whole Drive.
// -------------------------------------------------------------------------

const GOOGLE_CLIENT_ID = 'PASTE_YOUR_CLIENT_ID_HERE.apps.googleusercontent.com';

// drive.file = the app can only see/manage files IT creates or that the
// user explicitly opens with it - not the user's whole Drive. Deliberately
// the narrowest scope that can do this job.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER_NAME = '3D Simulations Portal Videos';

let _driveAccessToken = null;
let _driveFolderId = null;
let _driveTokenClient = null;

function isDriveConfigured() {
    return !!GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID.indexOf('PASTE_YOUR') === -1;
}

function isDriveSignedIn() {
    return !!_driveAccessToken;
}

function initDriveAuth() {
    if (_driveTokenClient || !isDriveConfigured()) return;
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) return;
    _driveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: () => {} // overridden per-call in driveSignIn()
    });
}

function driveSignIn() {
    return new Promise((resolve, reject) => {
        if (!isDriveConfigured()) {
            reject(new Error('Google Drive isn\'t set up yet. See the setup steps in the comment at the top of google-drive-videos.js.'));
            return;
        }
        initDriveAuth();
        if (!_driveTokenClient) {
            reject(new Error('Google sign-in script has not finished loading yet - try again in a moment.'));
            return;
        }
        _driveTokenClient.callback = (resp) => {
            if (resp.error) { reject(new Error(resp.error)); return; }
            _driveAccessToken = resp.access_token;
            resolve(_driveAccessToken);
        };
        _driveTokenClient.requestAccessToken({ prompt: _driveAccessToken ? '' : 'consent' });
    });
}

function driveSignOut() {
    if (_driveAccessToken && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
        google.accounts.oauth2.revoke(_driveAccessToken, () => {});
    }
    _driveAccessToken = null;
    _driveFolderId = null;
}

async function driveFetch(url, options) {
    options = options || {};
    if (!_driveAccessToken) throw new Error('Not signed in to Google Drive');
    const headers = Object.assign({}, options.headers || {}, {
        Authorization: 'Bearer ' + _driveAccessToken
    });
    const res = await fetch(url, Object.assign({}, options, { headers }));
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error('Drive API ' + res.status + ': ' + text);
    }
    return res;
}

async function ensureDriveFolder() {
    if (_driveFolderId) return _driveFolderId;

    const safeName = DRIVE_FOLDER_NAME.replace(/'/g, "\\'");
    const q = encodeURIComponent(
        "name = '" + safeName + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    );
    const listRes = await driveFetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)');
    const listData = await listRes.json();

    if (listData.files && listData.files.length) {
        _driveFolderId = listData.files[0].id;
        return _driveFolderId;
    }

    const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    const created = await createRes.json();
    _driveFolderId = created.id;
    return _driveFolderId;
}

function driveVideoUrl(fileId) {
    return 'https://drive.google.com/uc?export=download&id=' + fileId;
}

async function uploadVideoToDrive(panelType, title, description, file) {
    const folderId = await ensureDriveFolder();

    const metadata = {
        name: title,
        parents: [folderId],
        appProperties: { panelType: panelType, description: description || '' }
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const res = await driveFetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,appProperties',
        { method: 'POST', body: form }
    );
    const created = await res.json();

    // Anyone-with-the-link can view, so <video src> playback works without
    // sending an auth header on every request. Nothing is made discoverable/
    // public-on-the-web - only someone with the exact link can open it.
    // Non-fatal if this fails; the upload itself already succeeded.
    await driveFetch('https://www.googleapis.com/drive/v3/files/' + created.id + '/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' })
    }).catch(() => {});

    return {
        id: created.id,
        title: title,
        description: description || '',
        panelType: panelType,
        url: driveVideoUrl(created.id)
    };
}

async function listDriveVideos() {
    const folderId = await ensureDriveFolder();
    const q = encodeURIComponent("'" + folderId + "' in parents and trashed = false");
    const res = await driveFetch(
        'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name,appProperties)&pageSize=200'
    );
    const data = await res.json();
    return (data.files || []).map((f) => ({
        id: f.id,
        title: f.name,
        description: (f.appProperties && f.appProperties.description) || '',
        panelType: (f.appProperties && f.appProperties.panelType) || 'general',
        url: driveVideoUrl(f.id)
    }));
}

function deleteDriveVideo(fileId) {
    return driveFetch('https://www.googleapis.com/drive/v3/files/' + fileId, { method: 'DELETE' });
}

window.driveVideos = {
    isConfigured: isDriveConfigured,
    isSignedIn: isDriveSignedIn,
    signIn: driveSignIn,
    signOut: driveSignOut,
    upload: uploadVideoToDrive,
    list: listDriveVideos,
    delete: deleteDriveVideo
};
