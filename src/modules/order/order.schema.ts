import { z } from 'zod';

export const createOrderSchema = z.object({
    body: z.object({
        type: z.enum(['ride', 'food', 'send']),
        pickup_name: z.string(),
        pickup_address: z.string(),
        pickup_lat: z.number(),
        pickup_lng: z.number(),
        dropoff_name: z.string(),
        dropoff_address: z.string(),
        dropoff_lat: z.number(),
        dropoff_lng: z.number(),
        distance_km: z.number(),
        duration_min: z.number().optional(),
        payment_method: z
            .enum(['cash', 'wallet', 'qris', 'bank_transfer'])
            .default('cash'),
        notes: z.string().optional(),
        merchant_id: z.string().uuid().optional(),

        // Field tarif dari frontend
        tariff_code: z.string().optional(),
        option_name: z.string().optional(),

        items: z
            .array(
                z.object({
                    menu_item_id: z.number(),
                    name: z.string(),
                    variant: z.string().optional(),
                    qty: z.number(),
                    price: z.number(),
                })
            )
            .optional(),

        receiver_name: z.string().optional(),
        receiver_phone: z.string().optional(),
        sender_name: z.string().optional(),
        sender_phone: z.string().optional(),

        sender_landmark: z.string().optional(),
        receiver_landmark: z.string().optional(),

        // ⬇️ Field paket WarSend
        package_type: z.string().optional(),
        package_size: z.enum(['kecil', 'sedang', 'besar']).optional(),
        package_weight: z.string().optional(),
        package_protection: z.enum(['silver', 'gold']).optional(),
    }),
});

export const updateStatusSchema = z.object({
    body: z.object({
        status: z.enum([
            'accepted',
            'arrived',
            'in_progress',
            'completed',
            'cancelled',
        ]),
        reason: z.string().optional(),
        // ⬇️ untuk validasi complete order WarSend
        send_code: z.string().optional(),
    }),
});