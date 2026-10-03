// src/modules/wallet/wallet.service.ts
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../config/logger';

// ============================================================
// Type helpers untuk hasil query Supabase (belum di-generate)
// ============================================================
type OrderRow = {
    id: number;
    type: string;
    status: string;
    driver_id: string | null;
    customer_id: string;
    delivery_fee: number | null;
    driver_earning: number | null;
    total_fare: number | null;
    tariff_code: string | null;
    payment_method: string | null;
    payment_status: string | null;
    settled_at: string | null;
    commission_amount: number | null;
    commission_rate: number | null;
    platform_earning: number | null;
    settlement_type: string | null;
};

type WalletRow = {
    driver_id: string;
    balance: number;
    cash_debt: number;
    total_earning: number;
    total_commission_paid: number;
    total_commission_owed: number;
    last_payout_at: string | null;
    updated_at: string;
};

export const walletService = {
    // ============================================================
    // GET WALLET
    // ============================================================
    async getWallet(driverId: string) {
        // Pastikan wallet ada
        await supabaseAdmin
            .from('driver_wallets')
            .upsert(
                { driver_id: driverId },
                { onConflict: 'driver_id', ignoreDuplicates: true }
            );

        const { data, error } = await supabaseAdmin
            .from('driver_wallets')
            .select('*')
            .eq('driver_id', driverId)
            .single();

        if (error || !data) {
            throw ApiError.internal('Gagal ambil wallet');
        }

        const wallet = data as unknown as WalletRow;

        return {
            balance: Number(wallet.balance),
            cash_debt: Number(wallet.cash_debt),
            net_balance: Number(wallet.balance) - Number(wallet.cash_debt),
            total_earning: Number(wallet.total_earning),
            total_commission_paid: Number(wallet.total_commission_paid),
            total_commission_owed: Number(wallet.total_commission_owed),
            last_payout_at: wallet.last_payout_at,
            updated_at: wallet.updated_at,
        };
    },

    // ============================================================
    // SETTLE ORDER — dipanggil setelah order completed
    // ============================================================
    async settleOrder(orderId: number) {
        // 1. Ambil order
        const { data: orderRaw, error: oErr } = await supabaseAdmin
            .from('orders')
            .select(
                `
                id, type, status, driver_id, customer_id,
                delivery_fee, driver_earning, total_fare,
                tariff_code, payment_method, payment_status,
                settled_at, commission_amount, commission_rate,
                platform_earning, settlement_type
                `
            )
            .eq('id', orderId)
            .single();

        if (oErr || !orderRaw) {
            throw ApiError.notFound('Order tidak ditemukan');
        }

        const order = orderRaw as unknown as OrderRow;

        if (order.status !== 'completed') {
            throw ApiError.badRequest('Order belum completed');
        }
        if (!order.driver_id) {
            throw ApiError.badRequest('Order tidak punya driver');
        }
        if (order.settled_at) {
            logger.info('Order sudah di-settle, skip', { orderId });
            return { already_settled: true };
        }

        // 2. Hitung komisi
        const commissionRate = await this.getCommissionRate(
            order.type,
            order.tariff_code
        );

        const commissionBase = Number(order.delivery_fee) || 0;
        const commissionAmount = Math.round(commissionBase * commissionRate);
        const driverEarning = Number(order.driver_earning) || 0;

        // 3. Tipe settlement
        const isCash = order.payment_method === 'cash';
        const settlementType = isCash ? 'cash' : 'gateway';

        // 4. Ambil wallet driver
        await supabaseAdmin
            .from('driver_wallets')
            .upsert(
                { driver_id: order.driver_id },
                { onConflict: 'driver_id', ignoreDuplicates: true }
            );

        const { data: walletRaw, error: wErr } = await supabaseAdmin
            .from('driver_wallets')
            .select('*')
            .eq('driver_id', order.driver_id)
            .single();

        if (wErr || !walletRaw) {
            throw ApiError.internal('Wallet tidak ditemukan');
        }

        const wallet = walletRaw as unknown as WalletRow;

        let newBalance = Number(wallet.balance);
        let newCashDebt = Number(wallet.cash_debt);
        const ledgerEntries: any[] = [];

        if (isCash) {
            // ============================================================
            // CASH: driver pegang uang penuh, utang komisi ke platform
            // ============================================================
            newCashDebt = newCashDebt + commissionAmount;

            ledgerEntries.push({
                driver_id: order.driver_id,
                order_id: order.id,
                entry_type: 'earning_cash',
                amount: driverEarning,
                direction: 'in',
                balance_after: newBalance,
                cash_debt_after: newCashDebt,
                description: `Pendapatan cash order #${order.id}`,
                metadata: { payment_method: 'cash' },
            });

            ledgerEntries.push({
                driver_id: order.driver_id,
                order_id: order.id,
                entry_type: 'commission_cash',
                amount: commissionAmount,
                direction: 'out',
                balance_after: newBalance,
                cash_debt_after: newCashDebt,
                description: `Komisi cash order #${order.id} (${(commissionRate * 100).toFixed(1)}%)`,
                metadata: {
                    commission_rate: commissionRate,
                    commission_base: commissionBase,
                },
            });
        } else {
            // ============================================================
            // GATEWAY: dana sudah masuk platform, potong komisi otomatis
            // ============================================================
            const netEarning = driverEarning - commissionAmount;

            let debtPaid = 0;
            if (newCashDebt > 0) {
                debtPaid = Math.min(newCashDebt, netEarning);
                newCashDebt = newCashDebt - debtPaid;
            }

            const balanceCredit = netEarning - debtPaid;
            newBalance = newBalance + balanceCredit;

            ledgerEntries.push({
                driver_id: order.driver_id,
                order_id: order.id,
                entry_type: 'earning_gateway',
                amount: netEarning,
                direction: 'in',
                balance_after: newBalance,
                cash_debt_after: newCashDebt,
                description: `Pendapatan order #${order.id} (net setelah komisi)`,
                metadata: { payment_method: order.payment_method },
            });

            if (debtPaid > 0) {
                ledgerEntries.push({
                    driver_id: order.driver_id,
                    order_id: order.id,
                    entry_type: 'debt_payment',
                    amount: debtPaid,
                    direction: 'out',
                    balance_after: newBalance,
                    cash_debt_after: newCashDebt,
                    description: `Pelunasan utang cash`,
                    metadata: { debt_paid: debtPaid },
                });
            }
        }

        // 5. Update wallet
        const { error: walletErr } = await supabaseAdmin
            .from('driver_wallets')
            .update({
                balance: newBalance,
                cash_debt: newCashDebt,
                total_earning: Number(wallet.total_earning) + driverEarning,
                total_commission_paid:
                    Number(wallet.total_commission_paid) +
                    (isCash ? 0 : commissionAmount),
                total_commission_owed: newCashDebt,
            })
            .eq('driver_id', order.driver_id);

        if (walletErr) {
            logger.error('Update wallet gagal', { error: walletErr, orderId });
            throw ApiError.internal('Gagal update wallet');
        }

        // 6. Insert ledger entries
        const { error: ledgerErr } = await supabaseAdmin
            .from('driver_wallet_ledger')
            .insert(ledgerEntries);

        if (ledgerErr) {
            logger.error('Insert ledger gagal', { error: ledgerErr, orderId });
            // Jangan throw — wallet sudah terupdate, ledger hanya audit
        }

        // 7. Mark order settled
        await supabaseAdmin
            .from('orders')
            .update({
                commission_rate: commissionRate,
                commission_amount: commissionAmount,
                platform_earning:
                    (Number(order.platform_earning) || 0) + commissionAmount,
                settled_at: new Date().toISOString(),
                settlement_type: settlementType,
            })
            .eq('id', order.id);

        logger.info('Order settled', {
            orderId: order.id,
            driverId: order.driver_id,
            settlementType,
            commissionAmount,
            newBalance,
            newCashDebt,
        });

        return {
            order_id: order.id,
            settlement_type: settlementType,
            commission_rate: commissionRate,
            commission_amount: commissionAmount,
            driver_earning: driverEarning,
            new_balance: newBalance,
            new_cash_debt: newCashDebt,
        };
    },

    // ============================================================
    // GET COMMISSION RATE
    // ============================================================
    async getCommissionRate(
        orderType: string,
        tariffCode?: string | null
    ): Promise<number> {
        const { data, error } = await supabaseAdmin.rpc(
            'get_commission_rate',
            {
                p_order_type: orderType,
                p_tariff_code: tariffCode ?? null,
            }
        );

        if (error || data == null) {
            logger.warn('Gagal ambil commission rate, pakai default', {
                error,
                orderType,
                tariffCode,
            });
            return orderType === 'food' ? 0.15 : 0.08;
        }

        return Number(data);
    },

    // ============================================================
    // REQUEST PAYOUT
    // ============================================================
    async requestPayout(
        driverId: string,
        amount: number,
        bankInfo: {
            bank_code: string;
            bank_name: string;
            account_number: string;
            account_name: string;
        }
    ) {
        if (amount <= 0) throw ApiError.badRequest('Jumlah harus > 0');

        const wallet = await this.getWallet(driverId);

        if (wallet.balance < amount) {
            throw ApiError.badRequest(
                `Saldo tidak cukup. Saldo tersedia: Rp${wallet.balance.toLocaleString('id-ID')}`
            );
        }

        if (wallet.cash_debt > 0) {
            throw ApiError.badRequest(
                `Lunasi utang cash dulu (Rp${wallet.cash_debt.toLocaleString('id-ID')})`
            );
        }

        const MIN_PAYOUT = 50000;
        if (amount < MIN_PAYOUT) {
            throw ApiError.badRequest(
                `Minimal pencairan Rp${MIN_PAYOUT.toLocaleString('id-ID')}`
            );
        }

        const { data: payoutRaw, error: pErr } = await supabaseAdmin
            .from('payouts')
            .insert({
                driver_id: driverId,
                amount,
                status: 'pending',
                ...bankInfo,
            })
            .select()
            .single();

        if (pErr || !payoutRaw) {
            throw ApiError.internal('Gagal buat payout');
        }

        const payout = payoutRaw as any;

        const newBalance = wallet.balance - amount;
        await supabaseAdmin
            .from('driver_wallets')
            .update({ balance: newBalance })
            .eq('driver_id', driverId);

        await supabaseAdmin.from('driver_wallet_ledger').insert({
            driver_id: driverId,
            entry_type: 'payout',
            amount,
            direction: 'out',
            balance_after: newBalance,
            cash_debt_after: wallet.cash_debt,
            description: `Request payout #${payout.id}`,
            metadata: { payout_id: payout.id, ...bankInfo },
        });

        logger.info('Payout requested', {
            payoutId: payout.id,
            driverId,
            amount,
        });

        return payout;
    },

    // ============================================================
    // LIST LEDGER
    // ============================================================
    async listLedger(driverId: string, limit = 50, offset = 0) {
        const { data, error } = await supabaseAdmin
            .from('driver_wallet_ledger')
            .select('*')
            .eq('driver_id', driverId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw ApiError.internal('Gagal ambil ledger');
        return data ?? [];
    },

    // ============================================================
    // LIST PAYOUTS
    // ============================================================
    async listPayouts(driverId: string, limit = 20) {
        const { data, error } = await supabaseAdmin
            .from('payouts')
            .select('*')
            .eq('driver_id', driverId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw ApiError.internal('Gagal ambil payout');
        return data ?? [];
    },
};