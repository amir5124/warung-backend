import { Router } from 'express';
import { orderController } from './order.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createOrderSchema, updateStatusSchema } from './order.schema';

const router = Router();

router.use(requireAuth);

router.post('/', requireRole('customer'), validate(createOrderSchema), orderController.create);
router.post('/:id/accept', requireRole('driver'), orderController.accept);
router.put('/:id/status', validate(updateStatusSchema), orderController.updateStatus);
router.get('/:id', orderController.detail);
router.get('/', orderController.list);

export default router;