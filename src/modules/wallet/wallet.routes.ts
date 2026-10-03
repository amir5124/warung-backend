// src/modules/wallet/wallet.routes.ts
import { Router } from 'express';
import { walletController } from './wallet.controller';
import { requireAuth, requireRole } from '../../middleware/auth';

const router = Router();

router.use(requireAuth);
router.use(requireRole('driver'));

router.get('/', walletController.getWallet);
router.get('/ledger', walletController.listLedger);
router.get('/payouts', walletController.listPayouts);
router.post('/payouts', walletController.requestPayout);

export default router;