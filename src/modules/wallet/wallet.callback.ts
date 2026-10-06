// src/modules/wallet/wallet.callback.ts
import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../config/logger';
import { notificationService } from '../notification/notification.service';

const router = Router();

// ============================================================
// KONSTANTA FEE ADMIN
// ============================================================
const FEE_ADMIN_VA = 2500;
const FEE_ADMIN_BCA = 4000;
const FEE_ADMIN_QRIS_PERCENT = 0.008;

function calculateAdminFee(method: string, bankCode: string | null, amount: number): number {
    const m = (method ?? '').toLowerCase();
    if (m === 'qris') return Math.round(amount * FEE_ADMIN_QRIS_PERCENT);
    if (bankCode === '014') return FEE_ADMIN_BCA;
    return FEE_ADMIN_VA;
}

// ============================================================
// CALLBACK LINKQU
// ============================================================
router.post('/callback', async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const { partner_reff, status, va_code, serialnumber } = body;

    logger.info('📥 [LinkQu Callback]', { partner_reff, status, va_code });

    if (!partner_reff) return res.status(200).send('OK');

    try {
        const { data: topup } = await supabaseAdmin
            .from('wallet_topups')
            .select('*')
            .eq('partner_reff', partner_reff)
            .maybeSingle();

        if (topup) {
            await handleTopupCallback(topup, status, va_code, serialnumber);
            return res.status(200).json({ status: 'SUCCESS', message: 'Topup diproses' });
        }

        const { data: wd } = await supabaseAdmin
            .from('wallet_withdrawals')
            .select('*')
            .or(`partner_reff.eq.${partner_reff},partner_reff_pay.eq.${partner_reff}`)
            .maybeSingle();

        if (wd) {
            await handleWithdrawCallback(wd, status);
            return res.status(200).json({ status: 'SUCCESS', message: 'Withdraw diproses' });
        }

        logger.warn('⚠️ Callback: partner_reff tidak dikenal', { partner_reff });
        return res.status(200).send('OK');
    } catch (err: any) {
        logger.error('❌ Callback error', { error: err.message, partner_reff });
        return res.status(200).send('OK');
    }
});

// ============================================================
// HANDLER: TOPUP CALLBACK
// ============================================================
// src/modules/wallet/wallet.callback.ts

async function handleTopupCallback(
    topup: any,
    status: string,
    va_code?: string,
    serialnumber?: string
) {
    const isSuccess =
        status === 'SUCCESS' ||
        status === 'SETTLED' ||
        status === 'PAID';

    // Idempotency — skip kalau sudah SUCCESS
    if (topup.status === 'SUCCESS') {
        logger.info('ℹ️ Topup sudah SUCCESS, skip', {
            partner_reff: topup.partner_reff,
        });
        return;
    }

    // Handle gagal / expired
    if (!isSuccess) {
        if (status === 'FAILED' || status === 'EXPIRED') {
            await supabaseAdmin
                .from('wallet_topups')
                .update({
                    status: 'FAILED',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', topup.id);

            const nominal = Number(topup.nominal ?? topup.amount);

            await notificationService.sendToUser(topup.user_id, {
                title: 'Topup Gagal',
                body: `Topup Rp${nominal.toLocaleString('id-ID')} gagal atau kadaluarsa.`,
                data: {
                    type: 'topup_failed',
                    amount: nominal,
                    partner_reff: topup.partner_reff,
                },
            });

            logger.info('❌ Topup FAILED', {
                partner_reff: topup.partner_reff,
            });
        }
        return;
    }

    // ═══════════════════════════════════════════════════════════
    // HITUNG NOMINAL & FEE
    // ═══════════════════════════════════════════════════════════
    // Model: FEE DITAMBAHKAN (ditanggung customer)
    // - totalBayar  = nominal + adminFee (Rp12.500)
    // - nominal     = yang masuk saldo     (Rp10.000)
    // - adminFee    = fee admin            (Rp2.500)
    // ═══════════════════════════════════════════════════════════
    const userId = topup.user_id;

    // ✅ Ambil dari kolom yang disimpan saat create (topupInquiry)
    const nominal = Number(topup.nominal ?? topup.amount);
    const adminFee = Number(topup.admin_fee ?? 0);
    const totalBayar = Number(topup.amount);

    // ✅ Yang masuk saldo = nominal (karena fee ditanggung customer)
    const netAmount = nominal;

    logger.info('💰 Fee admin', {
        partner_reff: topup.partner_reff,
        method: topup.method,
        bankCode: topup.bank_code,
        totalBayar,       // Rp12.500 (dibayar user)
        nominal,          // Rp10.000 (nominal topup)
        adminFee,         // Rp2.500 (fee admin)
        netAmount,        // Rp10.000 (masuk saldo)
    });

    // ═══════════════════════════════════════════════════════════
    // CEK APAKAH USER = DRIVER
    // ═══════════════════════════════════════════════════════════
    const { data: driverProfile } = await supabaseAdmin
        .from('driver_profiles')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

    const isDriver = !!driverProfile;

    // ═══════════════════════════════════════════════════════════
    // DRIVER
    // ═══════════════════════════════════════════════════════════
    if (isDriver) {
        await supabaseAdmin
            .from('driver_wallets')
            .upsert(
                { driver_id: userId },
                { onConflict: 'driver_id', ignoreDuplicates: true }
            );

        const { data: wallet } = await supabaseAdmin
            .from('driver_wallets')
            .select('*')
            .eq('driver_id', userId)
            .single();

        let newBalance = Number(wallet?.balance ?? 0);
        let newCashDebt = Number(wallet?.cash_debt ?? 0);
        let amountLeft = netAmount;

        // ── LANGKAH 1: Lunasi utang cash DULU ──
        let debtPaid = 0;
        if (newCashDebt > 0) {
            debtPaid = Math.min(newCashDebt, amountLeft);
            newCashDebt = newCashDebt - debtPaid;
            amountLeft = amountLeft - debtPaid;
        }

        // ── LANGKAH 2: Sisa masuk saldo ──
        newBalance = newBalance + amountLeft;

        // ── LANGKAH 3: Update wallet ──
        await supabaseAdmin
            .from('driver_wallets')
            .update({
                balance: newBalance,
                cash_debt: newCashDebt,
                total_commission_owed: newCashDebt,
                updated_at: new Date().toISOString(),
            })
            .eq('driver_id', userId);

        // ── LANGKAH 4: Ledger topup ──
        await supabaseAdmin.from('driver_wallet_ledger').insert({
            driver_id: userId,
            entry_type: 'topup',
            amount: netAmount,
            direction: 'in',
            balance_after: newBalance,
            cash_debt_after: newCashDebt,
            description: `Topup via ${topup.method?.toUpperCase() ?? 'LinkQu'} (nominal Rp${nominal.toLocaleString('id-ID')} + fee Rp${adminFee.toLocaleString('id-ID')})`,
            metadata: {
                partner_reff: topup.partner_reff,
                va_code,
                serialnumber,
                total_bayar: totalBayar,
                nominal: nominal,
                admin_fee: adminFee,
                net_amount: netAmount,
                debt_paid: debtPaid,
            },
        });

        // ── LANGKAH 5: Ledger pelunasan utang (kalau ada) ──
        if (debtPaid > 0) {
            await supabaseAdmin.from('driver_wallet_ledger').insert({
                driver_id: userId,
                entry_type: 'debt_payment',
                amount: debtPaid,
                direction: 'out',
                balance_after: newBalance,
                cash_debt_after: newCashDebt,
                description: 'Pelunasan utang cash dari topup',
                metadata: {
                    debt_paid: debtPaid,
                    source: 'topup',
                    partner_reff: topup.partner_reff,
                },
            });
        }

        logger.info('✅ Topup SUCCESS (driver)', {
            partner_reff: topup.partner_reff,
            userId,
            totalBayar,
            nominal,
            adminFee,
            netAmount,
            debtPaid,
            newBalance,
            newCashDebt,
        });
    }

    // ═══════════════════════════════════════════════════════════
    // CUSTOMER
    // ═══════════════════════════════════════════════════════════
    else {
        await supabaseAdmin
            .from('wallets')
            .upsert(
                { user_id: userId },
                { onConflict: 'user_id', ignoreDuplicates: true }
            );

        const { data: wallet } = await supabaseAdmin
            .from('wallets')
            .select('*')
            .eq('user_id', userId)
            .single();

        const newBalance = Number(wallet?.balance ?? 0) + netAmount;

        await supabaseAdmin
            .from('wallets')
            .update({
                balance: newBalance,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId);

        await supabaseAdmin.from('wallet_transactions').insert({
            user_id: userId,
            type: 'topup',
            amount: netAmount,
            balance_after: newBalance,
            reference_id: topup.partner_reff,
            description: `Topup via ${topup.method?.toUpperCase() ?? 'LinkQu'} (nominal Rp${nominal.toLocaleString('id-ID')} + fee Rp${adminFee.toLocaleString('id-ID')})`,
        });

        logger.info('✅ Topup SUCCESS (customer)', {
            partner_reff: topup.partner_reff,
            userId,
            totalBayar,
            nominal,
            adminFee,
            netAmount,
            newBalance,
        });
    }

    // ═══════════════════════════════════════════════════════════
    // UPDATE STATUS TOPUP → SUCCESS
    // ═══════════════════════════════════════════════════════════
    await supabaseAdmin
        .from('wallet_topups')
        .update({
            status: 'SUCCESS',
            updated_at: new Date().toISOString(),
        })
        .eq('id', topup.id);

    // ═══════════════════════════════════════════════════════════
    // NOTIFIKASI SUKSES
    // ═══════════════════════════════════════════════════════════
    await notificationService.sendToUser(userId, {
        title: 'Topup Berhasil',
        body: `Saldo Rp${netAmount.toLocaleString('id-ID')} sudah masuk (fee admin Rp${adminFee.toLocaleString('id-ID')}).`,
        data: {
            type: 'topup_success',
            amount: netAmount,             // nominal yang masuk
            nominal: nominal,              // nominal topup
            total_bayar: totalBayar,       // total bayar
            admin_fee: adminFee,           // fee
            partner_reff: topup.partner_reff,
        },
    });
}

// ============================================================
// HANDLER: WITHDRAW CALLBACK
// ============================================================
async function handleWithdrawCallback(wd: any, status: string) {
    const isSuccess = status === 'SUCCESS' || status === 'SETTLED';
    const isFailed = status === 'FAILED' || status === 'REJECTED';

    if (wd.status === 'SUCCESS') {
        logger.info('ℹ️ Withdraw sudah SUCCESS, skip', { inquiry_reff: wd.inquiry_reff });
        return;
    }

    if (isSuccess) {
        await supabaseAdmin
            .from('wallet_withdrawals')
            .update({
                status: 'SUCCESS',
                updated_at: new Date().toISOString(),
            })
            .eq('id', wd.id);

        await notificationService.sendToUser(wd.user_id, {
            title: 'Penarikan Berhasil',
            body: `Penarikan Rp${Number(wd.amount).toLocaleString('id-ID')} berhasil.`,
            data: {
                type: 'withdraw_success',
                amount: Number(wd.amount),
                inquiry_reff: wd.inquiry_reff,
            },
        });

        logger.info('✅ Withdraw SUCCESS', { inquiry_reff: wd.inquiry_reff });
        return;
    }

    if (isFailed) {
        const userId = wd.user_id;
        const amount = Number(wd.amount);

        const { data: driverProfile } = await supabaseAdmin
            .from('driver_profiles')
            .select('user_id')
            .eq('user_id', userId)
            .maybeSingle();

        const isDriver = !!driverProfile;

        if (isDriver) {
            const { data: wallet } = await supabaseAdmin
                .from('driver_wallets')
                .select('*')
                .eq('driver_id', userId)
                .single();

            const newBalance = Number(wallet?.balance ?? 0) + amount;
            const cashDebt = Number(wallet?.cash_debt ?? 0);

            await supabaseAdmin
                .from('driver_wallets')
                .update({ balance: newBalance })
                .eq('driver_id', userId);

            await supabaseAdmin.from('driver_wallet_ledger').insert({
                driver_id: userId,
                entry_type: 'adjustment',
                amount,
                direction: 'in',
                balance_after: newBalance,
                cash_debt_after: cashDebt,
                description: `Refund withdraw gagal #${wd.inquiry_reff}`,
                metadata: { inquiry_reff: wd.inquiry_reff },
            });
        } else {
            const { data: wallet } = await supabaseAdmin
                .from('wallets')
                .select('*')
                .eq('user_id', userId)
                .single();

            const newBalance = Number(wallet?.balance ?? 0) + amount;

            await supabaseAdmin
                .from('wallets')
                .update({ balance: newBalance })
                .eq('user_id', userId);

            await supabaseAdmin.from('wallet_transactions').insert({
                user_id: userId,
                type: 'withdraw_refund',
                amount,
                balance_after: newBalance,
                reference_id: wd.inquiry_reff,
                description: 'Refund withdraw gagal',
            });
        }

        await supabaseAdmin
            .from('wallet_withdrawals')
            .update({
                status: 'FAILED',
                updated_at: new Date().toISOString(),
            })
            .eq('id', wd.id);

        await notificationService.sendToUser(userId, {
            title: 'Penarikan Gagal',
            body: `Penarikan Rp${amount.toLocaleString('id-ID')} gagal. Saldo sudah dikembalikan.`,
            data: {
                type: 'withdraw_failed',
                amount,
                inquiry_reff: wd.inquiry_reff,
            },
        });

        logger.info('❌ Withdraw FAILED + refund', {
            inquiry_reff: wd.inquiry_reff,
            userId,
            amount,
        });
    }
}

export default router;