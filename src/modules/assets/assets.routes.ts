// src/modules/assets/assets.routes.ts
import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../../middleware/auth';
import { assetsController } from './assets.controller';

const router = Router();

// ─────────────────────────────────────────────────────────────
// Multer: memory storage (buffer langsung ke Supabase Storage)
// ─────────────────────────────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB
        files: 20, // max 20 file per request (bulk)
    },
    fileFilter: (_req, file, cb) => {
        const allowed = [
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/webp',
            'image/svg+xml',
            'image/gif',
        ];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Tipe file tidak didukung: ${file.mimetype}`));
        }
    },
});

// Semua route butuh auth + role admin
router.use(requireAuth, requireRole('admin'));


// ─────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────
// List & search
router.get('/', assetsController.list);

// Statistik
router.get('/stats', assetsController.stats);

// Detail
router.get('/:id', assetsController.getById);

// Upload single
router.post(
    '/',
    upload.single('file'),
    assetsController.upload
);

// Upload banyak sekaligus
router.post(
    '/bulk',
    upload.array('files', 20),
    assetsController.bulkUpload
);

// Update metadata
router.put('/:id', assetsController.update);

// Ganti file (isi) tanpa ubah key
router.put(
    '/:id/replace',
    upload.single('file'),
    assetsController.replaceFile
);

// Hapus (soft delete default, ?hard=true untuk permanen)
router.delete('/:id', assetsController.remove);

export default router;