const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const VIEWER_PINCODE = process.env.VIEWER_PINCODE || '0000';
const USER_PINCODE = process.env.USER_PINCODE || '1234';
const ADMIN_PINCODE = process.env.ADMIN_PINCODE || 'admin123';
const CURATED_PINCODE = process.env.CURATED_PINCODE || '5555';

// Data directory for persistence
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'public', 'uploads');

// Ensure directories exist
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// File paths for persistent data
const memoriesFile = path.join(dataDir, 'memories.json');
const curatedFile = path.join(dataDir, 'curated.json');
const settingsFile = path.join(dataDir, 'settings.json');
const logsFile = path.join(dataDir, 'logs.json');

// Load data from files
const loadJSON = (file, defaultValue) => {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (e) {
        console.error(`Error loading ${file}:`, e);
    }
    return defaultValue;
};

// Save data to files
const saveJSON = (file, data) => {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`Error saving ${file}:`, e);
    }
};

// Load persistent data
let memories = loadJSON(memoriesFile, []);
let curatedMemories = loadJSON(curatedFile, []);
let settings = loadJSON(settingsFile, {
    announcementText: 'مرحباً بكم في ألبوم ذكرياتنا',
    curatedAnnouncementText: 'لحظات مميزة'
});
let loginLogs = loadJSON(logsFile, []);

// Multer config for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const imageTypes = /jpeg|jpg|png|gif|webp|heic|heif/;
        const videoTypes = /mp4|webm|mov|avi|mkv|m4v|hevc/;
        const ext = path.extname(file.originalname).toLowerCase().slice(1);
        const mime = file.mimetype;

        const isImage = imageTypes.test(ext) || mime.startsWith('image/');
        const isVideo = videoTypes.test(ext) || mime.startsWith('video/');

        if (isImage || isVideo) {
            cb(null, true);
        } else {
            cb(new Error('Only images and videos are allowed'));
        }
    },
    limits: { fileSize: 500 * 1024 * 1024 }
});

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SECRET_KEY || 'change-this-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Helper to determine file type
const getFileType = (filename) => {
    const ext = path.extname(filename).toLowerCase();
    const videoExts = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.hevc'];
    return videoExts.includes(ext) ? 'video' : 'image';
};

// Helper to extract YouTube video ID
const getYouTubeId = (url) => {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
        /youtube\.com\/shorts\/([^&\n?#]+)/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
};

// Sort memories by date (newest first)
const sortByDate = (items) => {
    return [...items].sort((a, b) => {
        const dateA = a.date ? new Date(a.date) : new Date(0);
        const dateB = b.date ? new Date(b.date) : new Date(0);
        return dateB - dateA;
    });
};

// Log login attempt
const logLogin = (role, ip, success) => {
    const log = {
        timestamp: new Date().toISOString(),
        role: role,
        ip: ip,
        success: success
    };
    loginLogs.unshift(log);
    // Keep only last 100 logs
    if (loginLogs.length > 100) loginLogs = loginLogs.slice(0, 100);
    saveJSON(logsFile, loginLogs);
};

// Auth middleware - checks for valid roles only
const requireAuth = (req, res, next) => {
    const validRoles = ['admin', 'user', 'viewer', 'curated_viewer'];
    if (req.session.authenticated && validRoles.includes(req.session.role)) {
        return next();
    }
    res.redirect('/');
};

// Upload permission middleware
const requireUpload = (req, res, next) => {
    const role = req.session.role;
    if (role === 'admin' || role === 'user') return next();
    res.redirect('/album');
};

// Admin middleware
const requireAdmin = (req, res, next) => {
    if (req.session.role === 'admin') return next();
    res.redirect('/album');
};

// Routes
app.get('/', (req, res) => {
    if (req.session.authenticated) return res.redirect('/album');
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { pincode } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (pincode === ADMIN_PINCODE) {
        req.session.authenticated = true;
        req.session.role = 'admin';
        logLogin('مدير', ip, true);
        res.redirect('/album');
    } else if (pincode === USER_PINCODE) {
        req.session.authenticated = true;
        req.session.role = 'user';
        logLogin('مستخدم', ip, true);
        res.redirect('/album');
    } else if (pincode === VIEWER_PINCODE) {
        req.session.authenticated = true;
        req.session.role = 'viewer';
        logLogin('مشاهد', ip, true);
        res.redirect('/album');
    } else if (pincode === CURATED_PINCODE) {
        req.session.authenticated = true;
        req.session.role = 'curated_viewer';
        logLogin('مشاهد مميز', ip, true);
        res.redirect('/curated');
    } else {
        logLogin('محاولة فاشلة', ip, false);
        req.session.fakeAuth = true;
        res.redirect('/gallery');
    }
});

// Fake gallery page (looks real but empty)
app.get('/gallery', (req, res) => {
    if (!req.session.fakeAuth) {
        return res.redirect('/');
    }
    res.render('gallery');
});

// Admin logs page
app.get('/admin/logs', requireAuth, requireAdmin, (req, res) => {
    res.render('logs', { logs: loginLogs });
});

// Clear logs
app.post('/admin/logs/clear', requireAuth, requireAdmin, (req, res) => {
    loginLogs = [];
    saveJSON(logsFile, loginLogs);
    res.redirect('/admin/logs');
});

app.get('/album', requireAuth, (req, res) => {
    const role = req.session.role || 'viewer';
    res.render('album', {
        memories: sortByDate(memories),
        message: req.session.message,
        canUpload: role === 'admin' || role === 'user',
        canDelete: role === 'admin',
        isAdmin: role === 'admin',
        announcement: settings.announcementText
    });
    req.session.message = null;
});

app.post('/update-announcement', requireAuth, requireAdmin, (req, res) => {
    const { announcement } = req.body;
    if (announcement !== undefined) {
        settings.announcementText = announcement.trim();
        saveJSON(settingsFile, settings);
        req.session.message = { type: 'success', text: 'تم تحديث النص بنجاح!' };
    }
    res.redirect('/album');
});

app.post('/upload', requireAuth, requireUpload, upload.single('media'), (req, res) => {
    if (!req.file) {
        req.session.message = { type: 'error', text: 'لم يتم اختيار ملف' };
        return res.redirect('/album');
    }

    memories.push({
        id: Date.now(),
        filename: req.file.filename,
        type: getFileType(req.file.filename),
        description: req.body.description || '',
        date: req.body.date || ''
    });
    saveJSON(memoriesFile, memories);

    req.session.message = { type: 'success', text: 'تم رفع الذكرى بنجاح!' };
    res.redirect('/album');
});

app.post('/upload-youtube', requireAuth, requireUpload, (req, res) => {
    const { youtubeUrl, description, date } = req.body;

    if (!youtubeUrl) {
        req.session.message = { type: 'error', text: 'لم يتم إدخال رابط' };
        return res.redirect('/album');
    }

    const videoId = getYouTubeId(youtubeUrl);
    if (!videoId) {
        req.session.message = { type: 'error', text: 'رابط يوتيوب غير صالح' };
        return res.redirect('/album');
    }

    memories.push({
        id: Date.now(),
        type: 'youtube',
        youtubeId: videoId,
        description: description || '',
        date: date || ''
    });
    saveJSON(memoriesFile, memories);

    req.session.message = { type: 'success', text: 'تم إضافة فيديو يوتيوب بنجاح!' };
    res.redirect('/album');
});

app.post('/delete/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const index = memories.findIndex(m => m.id === id);

    if (index !== -1) {
        const memory = memories[index];
        if (memory.filename) {
            const filepath = path.join(uploadsDir, memory.filename);
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        }
        memories.splice(index, 1);
        saveJSON(memoriesFile, memories);
        req.session.message = { type: 'success', text: 'تم حذف الذكرى' };
    }

    res.redirect('/album');
});

// Curated Album Routes
const requireCuratedAccess = (req, res, next) => {
    const role = req.session.role;
    if (role === 'admin' || role === 'curated_viewer') {
        return next();
    }
    res.redirect('/album');
};

app.get('/curated', requireAuth, requireCuratedAccess, (req, res) => {
    const role = req.session.role;
    const canEdit = role === 'admin';
    res.render('curated', {
        memories: sortByDate(curatedMemories),
        message: req.session.message,
        canEdit,
        announcement: settings.curatedAnnouncementText
    });
    req.session.message = null;
});

app.post('/curated/upload', requireAuth, requireAdmin, upload.single('media'), (req, res) => {
    if (!req.file) {
        req.session.message = { type: 'error', text: 'لم يتم اختيار ملف' };
        return res.redirect('/curated');
    }

    curatedMemories.push({
        id: Date.now(),
        filename: req.file.filename,
        type: getFileType(req.file.filename),
        description: req.body.description || '',
        date: req.body.date || ''
    });
    saveJSON(curatedFile, curatedMemories);

    req.session.message = { type: 'success', text: 'تم رفع الذكرى بنجاح!' };
    res.redirect('/curated');
});

app.post('/curated/upload-youtube', requireAuth, requireAdmin, (req, res) => {
    const { youtubeUrl, description, date } = req.body;

    if (!youtubeUrl) {
        req.session.message = { type: 'error', text: 'لم يتم إدخال رابط' };
        return res.redirect('/curated');
    }

    const videoId = getYouTubeId(youtubeUrl);
    if (!videoId) {
        req.session.message = { type: 'error', text: 'رابط يوتيوب غير صالح' };
        return res.redirect('/curated');
    }

    curatedMemories.push({
        id: Date.now(),
        type: 'youtube',
        youtubeId: videoId,
        description: description || '',
        date: date || ''
    });
    saveJSON(curatedFile, curatedMemories);

    req.session.message = { type: 'success', text: 'تم إضافة فيديو يوتيوب بنجاح!' };
    res.redirect('/curated');
});

app.post('/curated/delete/:id', requireAuth, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id);
    const index = curatedMemories.findIndex(m => m.id === id);

    if (index !== -1) {
        const memory = curatedMemories[index];
        if (memory.filename) {
            const filepath = path.join(uploadsDir, memory.filename);
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        }
        curatedMemories.splice(index, 1);
        saveJSON(curatedFile, curatedMemories);
        req.session.message = { type: 'success', text: 'تم حذف الذكرى' };
    }

    res.redirect('/curated');
});

app.post('/curated/update-announcement', requireAuth, requireAdmin, (req, res) => {
    const { announcement } = req.body;
    if (announcement !== undefined) {
        settings.curatedAnnouncementText = announcement.trim();
        saveJSON(settingsFile, settings);
        req.session.message = { type: 'success', text: 'تم تحديث النص بنجاح!' };
    }
    res.redirect('/curated');
});

// Our Story page
app.get('/our-story', (req, res) => {
    res.render('our-story');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Viewer Pincode: ${VIEWER_PINCODE} (view only)`);
    console.log(`User Pincode: ${USER_PINCODE} (view + upload)`);
    console.log(`Admin Pincode: ${ADMIN_PINCODE} (view + upload + delete + logs)`);
    console.log(`Curated Pincode: ${CURATED_PINCODE} (curated album - view only)`);
});
