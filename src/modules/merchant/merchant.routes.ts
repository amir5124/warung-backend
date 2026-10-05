// src/modules/merchant/merchant.routes.ts
import { Router } from 'express';
import { merchantController } from './merchant.controller';
import { requireAuth, requireRole } from '../../middleware/auth';

const router = Router();

// Semua endpoint merchant butuh login & role 'merchant'
router.use(requireAuth);
router.use(requireRole('merchant'));

// ============================================================
// STORE
// ============================================================
router.post('/store', merchantController.upsertStore);
router.get('/store', merchantController.getMyStore);
router.put('/store/open', merchantController.setOpen);

// ============================================================
// CATEGORIES
// ============================================================
router.get('/categories', merchantController.listCategories);
router.post('/categories', merchantController.addCategory);
router.delete('/categories/:id', merchantController.deleteCategory);

// ============================================================
// MENU ITEMS
// ============================================================
router.get('/menu', merchantController.listMenu);
router.post('/menu', merchantController.addMenuItem);
router.put('/menu/:id', merchantController.updateMenuItem);
router.put('/menu/:id/toggle', merchantController.toggleMenuAvailability);
router.delete('/menu/:id', merchantController.deleteMenuItem);

export default router;