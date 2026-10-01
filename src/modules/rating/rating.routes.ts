import { Router } from 'express';
import { ratingController } from './rating.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();

router.post('/', requireAuth, ratingController.submit);
router.get('/order/:orderId', requireAuth, ratingController.getByOrder);
router.get('/driver/:driverId', ratingController.listByDriver);

export default router;