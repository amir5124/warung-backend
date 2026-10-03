import { Router } from 'express';
import { driverController } from './driver.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
    updateLocationSchema,
    updateStatusSchema,
    updateDriverSchema,
    updateServicesSchema,
} from './driver.schema';

const router = Router();

// ============================================================
// Endpoint PUBLIK
// ============================================================
router.get('/nearby', driverController.nearby);

// ============================================================
// Endpoint DRIVER ONLY
// ============================================================
router.get(
    '/profile',
    requireAuth,
    requireRole('driver'),
    driverController.getProfile
);

router.put(
    '/profile',
    requireAuth,
    requireRole('driver'),
    validate(updateDriverSchema),
    driverController.updateProfile
);

router.put(
    '/services',
    requireAuth,
    requireRole('driver'),
    validate(updateServicesSchema),
    driverController.updateServices
);

router.put(
    '/location',
    requireAuth,
    requireRole('driver'),
    validate(updateLocationSchema),
    driverController.updateLocation
);

router.put(
    '/status',
    requireAuth,
    requireRole('driver'),
    validate(updateStatusSchema),
    driverController.setStatus
);

router.get(
    '/earnings',
    requireAuth,
    requireRole('driver'),
    driverController.getEarnings
);

router.get(
    '/earnings/history',
    requireAuth,
    requireRole('driver'),
    driverController.getEarningsHistory
);

export default router;