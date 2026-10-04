// src/modules/wallet/wallet.callback.ts
import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../config/logger';

const router = Router();

// ============================================================
// CALLBACK LINKQU — Topup & Withdraw
// POST /api/wallet/callback
// ============================================================
router.post('/callback', async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const { partner_reff, status, va_code, serialnumber } = body;

    logger.info('📥 [LinkQu Callback]', { partner_reff, status, va_code });

    // Kalau tidak ada partner_reff, langsung balas OK
    if (!partner_reff) {
        return res.status(200).send('OK');
    }

    try {
        // ============================================================
        // 1. CEK APAKAH INI TOPUP
        // ============================================================
        const { data: topup } = await supabaseAdmin
            .from('wallet_topups')
            .select('*')
            .eq('partner_reff', partner_reff)
            .maybeSingle();

        if (topup) {
            await handleTopupCallback(topup, status, va_code, serialnumber);
            return res.status(200).json({ status: 'SUCCESS', message: 'Topup diproses' });
        }

        // ============================================================
        // 2. CEK APAKAH INI WITHDRAW
        // ============================================================
        // withdraw disimpan pakai partner_reff (inquiry) atau partner_reff_pay (payment)
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
        // Tetap balas 200 supaya LinkQu tidak retry berkali-kali
        return res.status(200).send('OK');
    }
});

// ============================================================
// HANDLER: TOPUP CALLBACK
// ============================================================
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

    // Kalau sudah pernah sukses, skip (idempotent)
    if (topup.status === 'SUCCESS') {
        logger.info('ℹ️ Topup sudah SUCCESS, skip', { partner_reff: topup.partner_reff });
        return;
    }

    if (!isSuccess) {
        // Kalau gagal/expired, tandai FAILED
        if (status === 'FAILED' || status === 'EXPIRED') {
            await supabaseAdmin
                .from('wallet_topups')
                .update({ status: 'FAILED', updated_at: new Date().toISOString() })
                .eq('id', topup.id);
            logger.info('❌ Topup FAILED', { partner_reff: topup.partner_reff });
        }
        return;
    }

    // ============================================================
    // Kredit saldo user (atomic via transaction)
    // ============================================================
    const userId = topup.user_id;
    const amount = Number(topup.amount);

    // Ambil wallet user (driver atau customer)
    // Kita cek dulu apakah user ini driver (punya row di driver_profiles)
    const { data: driverProfile } = await supabaseAdmin
        .from('driver_profiles')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

    const isDriver = !!driverProfile;

    if (isDriver) {
        // ===== DRIVER: pakai driver_wallets =====
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

        const newBalance = Number(wallet?.balance ?? 0) + amount;
        const cashDebt = Number(wallet?.cash_debt ?? 0);

        await supabaseAdmin
            .from('driver_wallets')
            .update({
                balance: newBalance,
                updated_at: new Date().toISOString(),
            })
            .eq('driver_id', userId);

        await supabaseAdmin.from('driver_wallet_ledger').insert({
            driver_id: userId,
            entry_type: 'topup',
            amount,
            direction: 'in',
            balance_after: newBalance,
            cash_debt_after: cashDebt,
            description: `Topup via ${topup.method?.toUpperCase() ?? 'LinkQu'}`,
            metadata: {
                partner_reff: topup.partner_reff,
                va_code,
                serialnumber,
            },
        });
    } else {
        // ===== CUSTOMER: pakai wallets =====
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

        const newBalance = Number(wallet?.balance ?? 0) + amount;

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
            amount,
            balance_after: newBalance,
            reference_id: topup.partner_reff,
            description: `Topup via ${topup.method?.toUpperCase() ?? 'LinkQu'}`,
        });
    }

    // Update topup jadi SUCCESS
    await supabaseAdmin
        .from('wallet_topups')
        .update({
            status: 'SUCCESS',
            updated_at: new Date().toISOString(),
        })
        .eq('id', topup.id);

    logger.info('✅ Topup SUCCESS', {
        partner_reff: topup.partner_reff,
        userId,
        amount,
        isDriver,
    });
}

// ============================================================
// HANDLER: WITHDRAW CALLBACK
// ============================================================
async function handleWithdrawCallback(wd: any, status: string) {
    const isSuccess =
        status === 'SUCCESS' ||
        status === 'SETTLED';

    const isFailed =
        status === 'FAILED' ||
        status === 'REJECTED';

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

        logger.info('✅ Withdraw SUCCESS', { inquiry_reff: wd.inquiry_reff });
        return;
    }

    if (isFailed) {
        // ==== REFUND saldo user ====
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

        logger.info('❌ Withdraw FAILED + refund', {
            inquiry_reff: wd.inquiry_reff,
            userId,
            amount,
        });
    }
}

export default router;