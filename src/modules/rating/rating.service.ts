import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../config/logger';

export const ratingService = {
    async submit(input: {
        orderId: number;
        reviewerId: string;
        rating: number;
        comment?: string;
        tags?: string[];
    }) {
        // 1. Ambil order untuk tahu reviewee (driver) + status
        const { data: order, error: oErr } = await supabaseAdmin
            .from('orders')
            .select('id, customer_id, driver_id, status')
            .eq('id', input.orderId)
            .single();

        if (oErr || !order) throw ApiError.notFound('Order tidak ditemukan');
        if (order.customer_id !== input.reviewerId) {
            throw ApiError.forbidden('Bukan ordermu');
        }
        if (order.status !== 'completed') {
            throw ApiError.badRequest('Order belum selesai');
        }
        if (!order.driver_id) {
            throw ApiError.badRequest('Order tidak punya driver');
        }

        // 2. Upsert rating
        const { data: rating, error: rErr } = await supabaseAdmin
            .from('ratings')
            .upsert(
                {
                    order_id: input.orderId,
                    reviewer_id: input.reviewerId,
                    reviewee_id: order.driver_id,
                    rating: input.rating,
                    comment: input.comment ?? null,
                    tags: input.tags ?? [],
                },
                { onConflict: 'order_id,reviewer_id,reviewee_id' }
            )
            .select()
            .single();

        if (rErr) {
            logger.error('Gagal insert rating', { error: rErr });
            throw ApiError.internal(rErr.message);
        }

        // 3. Hitung ulang rating_avg driver
        const { data: agg, error: aggErr } = await supabaseAdmin
            .from('ratings')
            .select('rating')
            .eq('reviewee_id', order.driver_id);

        if (aggErr) {
            logger.warn('Gagal hitung rating avg', { error: aggErr });
        } else if (agg && agg.length > 0) {
            const avg =
                agg.reduce((s, r: any) => s + (r.rating ?? 0), 0) / agg.length;

            // Hitung total order completed driver
            const { count: tripsCount } = await supabaseAdmin
                .from('orders')
                .select('id', { count: 'exact', head: true })
                .eq('driver_id', order.driver_id)
                .eq('status', 'completed');

            await supabaseAdmin
                .from('driver_profiles')
                .update({
                    rating_avg: Number(avg.toFixed(2)),
                    total_trips: tripsCount ?? 0,
                })
                .eq('user_id', order.driver_id);

            logger.info('Driver stats updated', {
                driverId: order.driver_id,
                rating_avg: avg,
                total_trips: tripsCount,
            });
        }

        return rating;
    },

    async getByOrder(orderId: number) {
        const { data } = await supabaseAdmin
            .from('ratings')
            .select('*')
            .eq('order_id', orderId)
            .maybeSingle();
        return data;
    },

    async listByDriver(driverId: string, limit = 20) {
        const { data } = await supabaseAdmin
            .from('ratings')
            .select('id, rating, comment, tags, created_at, reviewer_id')
            .eq('reviewee_id', driverId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (!data) return [];

        // Ambil info reviewer terpisah
        const reviewerIds = [...new Set(data.map((r: any) => r.reviewer_id))];
        const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, avatar_url')
            .in('id', reviewerIds);

        const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

        return data.map((r: any) => ({
            ...r,
            reviewer: profileMap.get(r.reviewer_id) ?? null,
        }));
    },
};