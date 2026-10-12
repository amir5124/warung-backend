// src/modules/admin/admin.routes.ts
import { Router } from 'express';
import { adminController } from './admin.controller';
import { requireAuth, requireRole } from '../../middleware/auth';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// Beranda
router.get('/stats', adminController.stats); // lama, tetap dipertahankan
router.get('/dashboard', adminController.dashboard);

// Pesanan
router.get('/orders', adminController.listOrders); //          ?status=semua|diproses|diantar|selesai|batal&search=&limit=&offset=
router.get('/orders/:id', adminController.getOrder);

// Mitra
router.get('/users', adminController.listUsers);
router.get('/partners', adminController.listPartners); //      ?type=merchant|driver&status=all|active|pending|suspended&search=&limit=&offset=
router.put('/partners/:id/suspend', adminController.setPartnerSuspended); // body: { suspended: boolean }
router.put('/drivers/:id/verify', adminController.verifyDriver);
router.put('/merchants/:id/verify', adminController.verifyMerchant);

// Keuangan
router.get('/finance/summary', adminController.financeSummary);
router.get('/finance/withdrawals', adminController.listWithdrawals); // ?status=pending|approved|rejected|all
router.put('/finance/withdrawals/:id/approve', adminController.approveWithdrawal);
router.put('/finance/withdrawals/:id/reject', adminController.rejectWithdrawal); // body: { reason? }
router.get('/finance/topups', adminController.listTopups);
router.get('/finance/commissions', adminController.listCommissions);

// Akun
router.get('/admins', adminController.listAdmins);
router.get('/audit-logs', adminController.listAuditLogs);

export default router;