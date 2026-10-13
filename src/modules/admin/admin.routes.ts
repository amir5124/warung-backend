// src/modules/admin/admin.routes.ts
import { Router } from 'express';
import { adminController } from './admin.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import settingsAdminRoutes from '../settings/admin.routes';
import commissionRoutes from '../commission/commission.routes';

const router = Router();
router.use(requireAuth, requireRole('admin'));

// Pengaturan aplikasi & komisi → /api/admin/settings
// (dipasang di sini supaya otomatis ikut aktif selama /api/admin aktif)
router.use('/settings', settingsAdminRoutes);

// Tarif komisi per jenis order / kode tarif → /api/admin/commission-rates
router.use('/commission-rates', commissionRoutes);

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
router.get('/finance/withdrawals', adminController.listWithdrawals); // ?source=linkqu|payout&status=pending|success|failed|all
router.put('/finance/payouts/:id/approve', adminController.approvePayout); // pengajuan payout manual driver
router.put('/finance/payouts/:id/reject', adminController.rejectPayout); //  body: { reason? } — dana dikembalikan
router.get('/finance/topups', adminController.listTopups);
router.get('/finance/commissions', adminController.listCommissions);

// Akun
router.get('/admins', adminController.listAdmins);
router.get('/audit-logs', adminController.listAuditLogs);

export default router;