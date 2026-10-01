import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabase';
import { notificationService } from '../modules/notification/notification.service';
import { logger } from '../config/logger';

// Setiap menit: cancel order pending > 5 menit
export const startOrderTimeoutJob = () => {
    cron.schedule('* * * * *', async () => {
        try {
            const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
            const { data: staleOrders } = await supabaseAdmin
                .from('orders')
                .select('id, customer_id')
                .eq('status', 'pending')
                .lt('created_at', cutoff);

            if (!staleOrders?.length) return;

            for (const o of staleOrders) {
                await supabaseAdmin
                    .from('orders')
                    .update({
                        status: 'cancelled',
                        cancelled_at: new Date().toISOString(),
                        cancellation_reason: 'No driver found',
                    })
                    .eq('id', o.id);

                await notificationService.sendToUser(o.customer_id, {
                    title: 'Pesanan dibatalkan',
                    body: 'Tidak ada driver. Silakan coba lagi.',
                    data: { order_id: o.id, type: 'order_cancelled' },
                });
            }
            logger.info(`Auto-cancelled ${staleOrders.length} stale orders`);
        } catch (err: any) {
            logger.error('Order timeout job failed', { err: err.message });
        }
    });
};