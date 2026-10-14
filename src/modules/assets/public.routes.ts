// src/modules/assets/public.routes.ts
// Route PUBLIK untuk aplikasi customer (tanpa auth).
import { Router } from 'express';
import { assetsController } from './assets.controller';

const router = Router();

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────────

// GET /api/public/assets?category=banner&limit=10
router.get('/assets', assetsController.listPublic);

export default router;