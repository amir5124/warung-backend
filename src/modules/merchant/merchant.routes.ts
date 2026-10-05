// src/modules/merchant/merchant.routes.ts
import { Router } from 'express';
import { merchantController } from './merchant.controller';
import { requireAuth, requireRole } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requireRole('merchant')); // Hanya merchant yang bisa akses

router.post('/store', merchantController.upsertStore);
router.post('/categories', merchantController.addCategory);
router.post('/menu', merchantController.addMenuItem);
router.get('/menu', merchantController.getMyMenu);

export default router;