import { Router } from 'express';
import { merchantController } from './merchant.controller';
import { requireAuth, requireRole } from '../../middleware/auth';

const router = Router();

router.get('/open', merchantController.listOpen);

router.use(requireAuth, requireRole('merchant'));
router.get('/me', merchantController.profile);
router.put('/me', merchantController.update);
router.put('/toggle-open', merchantController.toggleOpen);

export default router;