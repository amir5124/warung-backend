import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../config/logger';

export const matchingService = {
    async findDriversForOrder(
        orderId: number,
        lat: number,
        lng: number,
        type: string,
        tariffCode?: string | null
    ) {
        console.log('[matching] === CARI DRIVER ===');
        console.log('[matching] orderId:', orderId, '| pickup:', { lat, lng });
        console.log('[matching] type:', type, '| tariff_code:', tariffCode);

        const { data: drivers, error } = await supabaseAdmin.rpc('find_nearby_drivers', {
            p_lat: lat,
            p_lng: lng,
            p_radius_m: 20000,   // ← dari 5000 ke 20000 (20 km)
            p_limit: 20,
            p_tariff_code: tariffCode ?? null,
        });


        if (error) {
            console.error('[matching] RPC error:', error);
            logger.error('find_nearby_drivers gagal', { error, orderId });
            return [];
        }

        console.log('[matching] RPC result:', drivers?.length ?? 0, 'driver');

        if (!drivers || drivers.length === 0) {
            logger.warn('No drivers found', { orderId, lat, lng, tariffCode });
            return [];
        }

        const bids = drivers.map((d: any) => ({
            order_id: orderId,
            driver_id: d.user_id,
            distance_km: d.distance_m / 1000,
            status: 'pending',
        }));

        const { error: bidErr } = await supabaseAdmin.from('order_bids').insert(bids);
        if (bidErr) {
            console.error('[matching] Gagal insert bids:', bidErr);
            logger.error('Gagal insert bids', { error: bidErr, orderId });
        } else {
            console.log('[matching] ✅ Berhasil insert', bids.length, 'bid');
        }

        return drivers;
    },
};