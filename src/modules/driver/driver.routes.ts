import { Router } from 'express';
import { driverController } from './driver.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
    updateLocationSchema,
    updateStatusSchema,
    updateDriverSchema,
    updateServicesSchema
} from './driver.schema';

const router = Router();


router.put(
    '/services',
    requireAuth,
    requireRole('driver'),
    validate(updateServicesSchema),
    driverController.updateServices
);

router.get(
    '/profile',
    requireAuth,
    requireRole('driver'),
    driverController.getProfile
);

// Earnings
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
// Endpoint PUBLIK: customer bisa lihat driver di sekitar
// Kalau mau butuh login, tinggal tambah requireAuth
router.get('/nearby', driverController.nearby);

// Endpoint DRIVER only
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

router.put(
    '/profile',
    requireAuth,
    requireRole('driver'),
    validate(updateDriverSchema),
    driverController.updateProfile
);


export default router;