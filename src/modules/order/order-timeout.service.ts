// src/modules/order/order-timeout.service.ts
import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../config/logger';
import { notificationService } from '../notification/notification.service';

const PENDING_TIMEOUT_MS = 5 * 60 * 1000; // 5 menit

let intervalRef: ReturnType<typeof setInterval> | null = null;

export const orderTimeoutService = {
    async cancelStalePendingOrders() {
        const cutoff = new Date(
            Date.now() - PENDING_TIMEOUT_MS
        ).toISOString();

        const { data: stale, error } = await supabaseAdmin
            .from('orders')
            .select('id, customer_id, type')
            .eq('status', 'pending')
            .lt('created_at', cutoff);

        if (error) {
            logger.error('Gagal cari order stale', { error });
            return;
        }

        if (!stale || stale.length === 0) return;

        logger.info('Auto-cancel order stale', { count: stale.length });

        for (const order of stale) {
            try {
                // ⬇️ Update + select, ambil hasilnya
                const { data: updated, error: updateErr } =
                    await supabaseAdmin
                        .from('orders')
                        .update({
                            status: 'cancelled',
                            cancelled_at: new Date().toISOString(),
                            cancellation_reason:
                                'Tidak ada driver yang menerima',
                        })
                        .eq('id', order.id)
                        .eq('status', 'pending')
                        .select('id')
                        .maybeSingle();

                if (updateErr) {
                    logger.warn('Gagal update order stale', {
                        orderId: order.id,
                        err: updateErr.message,
                    });
                    continue;   // ⬅️ SKIP notif
                }

                // ⬇️ Kalau tidak ada row yang di-update (sudah tidak pending),
                // skip notif
                if (!updated) {
                    logger.info(
                        'Order sudah tidak pending, skip notif',
                        { orderId: order.id }
                    );
                    continue;
                }

                // Cleanup bid
                await supabaseAdmin
                    .from('order_bids')
                    .update({
                        status: 'expired',
                        responded_at: new Date().toISOString(),
                    })
                    .eq('order_id', order.id)
                    .eq('status', 'pending');

                // Baru kirim notif SEKALI
                await notificationService
                    .sendToUser(order.customer_id, {
                        title: 'Pesanan dibatalkan',
                        body: 'Tidak ada driver yang menerima. Silakan coba lagi.',
                        data: {
                            order_id: order.id,
                            type: 'order_timeout',
                            service: order.type,
                        },
                    })
                    .catch((e) =>
                        logger.warn('Gagal kirim notif timeout', {
                            orderId: order.id,
                            err: e.message,
                        })
                    );

                logger.info('Auto-cancelled 1 stale order', {
                    orderId: order.id,
                });
            } catch (err: any) {
                logger.warn('Gagal cancel order stale', {
                    orderId: order.id,
                    err: err.message,
                });
            }
        }
    },

    start(intervalMs = 60_000) {
        // ⬇️ Cegah double-start
        if (intervalRef) {
            logger.warn('Order timeout service sudah jalan, skip start ulang');
            return;
        }

        console.log(
            '[order-timeout] Service started, interval:',
            intervalMs,
            'ms'
        );

        intervalRef = setInterval(() => {
            this.cancelStalePendingOrders().catch((e) =>
                logger.error('order-timeout cron error', {
                    err: e.message,
                })
            );
        }, intervalMs);

        logger.info('Order timeout service started', { intervalMs });
    },

    /** Stop service (opsional, untuk graceful shutdown) */
    stop() {
        if (intervalRef) {
            clearInterval(intervalRef);
            intervalRef = null;
            logger.info('Order timeout service stopped');
        }
    },
};