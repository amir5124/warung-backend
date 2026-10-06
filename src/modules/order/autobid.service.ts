// src/modules/order/autobid.service.ts
import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../config/logger';

export const autobidService = {
    /**
     * Cek apakah driver eligible untuk autobid order tertentu
     */
    async isEligible(
        driverId: string,
        order: {
            id: number;
            type: string;
            driver_earning: number;
            distance_km: number | null;
        }
    ): Promise<{ eligible: boolean; reason?: string }> {
        // 1. Ambil config autobid driver
        const { data: config } = await supabaseAdmin
            .from('driver_autobid')
            .select('*')
            .eq('driver_id', driverId)
            .maybeSingle();

        if (!config) {
            return { eligible: false, reason: 'no_config' };
        }

        if (!config.is_enabled) {
            return { eligible: false, reason: 'disabled' };
        }

        // 2. Cek driver online
        const { data: dp } = await supabaseAdmin
            .from('driver_profiles')
            .select('status')
            .eq('user_id', driverId)
            .maybeSingle();

        if (dp?.status !== 'online') {
            return { eligible: false, reason: 'not_online' };
        }

        // 3. Cek jam aktif (WIB)
        const nowWIB = new Date(Date.now() + 7 * 60 * 60 * 1000);
        const currentTime = nowWIB.toISOString().slice(11, 19); // HH:MM:SS

        if (
            currentTime < config.active_hours_start ||
            currentTime > config.active_hours_end
        ) {
            return { eligible: false, reason: 'outside_hours' };
        }

        // 4. Cek jenis layanan
        if (
            config.services &&
            config.services.length > 0 &&
            !config.services.includes(order.type)
        ) {
            return { eligible: false, reason: 'service_not_match' };
        }

        // 5. Cek fare minimum
        if (order.driver_earning < config.min_fare) {
            return { eligible: false, reason: 'fare_too_low' };
        }

        // 6. Cek radius
        if (
            order.distance_km != null &&
            order.distance_km > config.max_radius_km
        ) {
            return { eligible: false, reason: 'too_far' };
        }

        // 7. Cek max order per jam
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count: recentCount } = await supabaseAdmin
            .from('driver_autobid_log')
            .select('*', { count: 'exact', head: true })
            .eq('driver_id', driverId)
            .eq('status', 'accepted')
            .gte('created_at', oneHourAgo);

        if ((recentCount ?? 0) >= config.max_orders_per_hour) {
            return { eligible: false, reason: 'rate_limit' };
        }

        return { eligible: true };
    },

    /**
     * Coba autobid order ke list driver.
     * Return: driverId yang berhasil autobid, atau null.
     */
    async tryAutoBid(
        orderId: number,
        order: {
            type: string;
            driver_earning: number;
            distance_km: number | null;
        },
        candidateDriverIds: string[]
    ): Promise<string | null> {
        logger.info('[autobid] Coba autobid', {
            orderId,
            candidates: candidateDriverIds.length,
        });

        for (const driverId of candidateDriverIds) {
            // Cek eligibility
            const { eligible, reason } = await this.isEligible(driverId, {
                id: orderId,
                ...order,
            });

            // Log skip
            if (!eligible) {
                await supabaseAdmin.from('driver_autobid_log').insert({
                    driver_id: driverId,
                    order_id: orderId,
                    status: 'skipped',
                    reason: reason ?? 'unknown',
                    distance_km: order.distance_km,
                    fare: order.driver_earning,
                });
                continue;
            }

            // Coba accept order (race-safe)
            const { data: updated, error } = await supabaseAdmin
                .from('orders')
                .update({
                    driver_id: driverId,
                    status: 'accepted',
                    accepted_at: new Date().toISOString(),
                })
                .eq('id', orderId)
                .eq('status', 'pending')
                .select('id')
                .maybeSingle();

            if (error || !updated) {
                logger.warn('[autobid] Race — order sudah diambil', {
                    orderId,
                    driverId,
                });
                return null;
            }

            // ═══════════════════════════════════════════════════════
            // ✅ Log autobid accepted
            // ═══════════════════════════════════════════════════════
            await supabaseAdmin.from('driver_autobid_log').insert({
                driver_id: driverId,
                order_id: orderId,
                status: 'accepted',
                distance_km: order.distance_km,
                fare: order.driver_earning,
            });

            // ═══════════════════════════════════════════════════════
            // ✅ Increment counter (via RPC — atomic)
            // ═══════════════════════════════════════════════════════
            await supabaseAdmin.rpc('increment_autobid_count', {
                p_driver_id: driverId,
            });

            // Update bid driver ini → accepted
            await supabaseAdmin
                .from('order_bids')
                .update({
                    status: 'accepted',
                    responded_at: new Date().toISOString(),
                })
                .eq('order_id', orderId)
                .eq('driver_id', driverId);

            // Reject bid driver lain
            await supabaseAdmin
                .from('order_bids')
                .update({
                    status: 'rejected',
                    responded_at: new Date().toISOString(),
                })
                .eq('order_id', orderId)
                .neq('driver_id', driverId)
                .eq('status', 'pending');

            // Set driver busy
            await supabaseAdmin
                .from('driver_profiles')
                .update({ status: 'busy' })
                .eq('user_id', driverId);

            logger.info('✅ [autobid] Order auto-accepted', {
                orderId,
                driverId,
            });

            return driverId;
        }

        logger.info('[autobid] Tidak ada driver eligible', { orderId });
        return null;
    },
};