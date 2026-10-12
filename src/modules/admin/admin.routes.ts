import { Router } from 'express';
import { adminController } from './admin.controller';
import { requireAuth, requireRole } from '../../middleware/auth';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/stats', adminController.stats);
router.get('/users', adminController.listUsers);
router.put('/drivers/:id/verify', adminController.verifyDriver);
router.put('/merchants/:id/verify', adminController.verifyMerchant);

// TODO Fase 2:
// router.get('/orders', adminController.listOrders);
// router.get('/payouts', adminController.listPayouts);
// router.put('/payouts/:id/approve', adminController.approvePayout);

export default router;