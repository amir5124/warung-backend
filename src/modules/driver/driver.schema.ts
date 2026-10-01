import { z } from 'zod';

export const updateLocationSchema = z.object({
    body: z.object({
        latitude: z.number(),
        longitude: z.number(),
    }),
});

export const updateStatusSchema = z.object({
    body: z.object({
        status: z.enum(['offline', 'online', 'busy']),
    }),
});

export const updateDriverSchema = z.object({
    body: z.object({
        vehicle_type: z.enum(['motor', 'mobil', 'motor_food']).optional(),
        plate_number: z.string().optional(),
        vehicle_brand: z.string().optional(),
        vehicle_model: z.string().optional(),
        sim_number: z.string().optional(),
        ktp_number: z.string().optional(),
    }),
});

export const updateServicesSchema = z.object({
    body: z.object({
        services: z.array(z.string()).min(1, 'Pilih minimal 1 layanan'),
    }),
});