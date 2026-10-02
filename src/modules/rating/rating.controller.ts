import { Request, Response } from 'express';
import { ratingService } from './rating.service';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created } from '../../utils/response';
import { ApiError } from '../../utils/ApiError';

export const ratingController = {
    submit: asyncHandler(async (req: Request, res: Response) => {
        const { orderId, rating, comment, tags } = req.body;

        if (!orderId || !rating) {
            throw ApiError.badRequest('orderId dan rating wajib');
        }

        const data = await ratingService.submit({
            orderId: Number(orderId),
            reviewerId: req.user!.id,
            rating: Number(rating),
            comment,
            tags,
        });

        return created(res, data, 'Rating tersimpan');
    }),

    getByOrder: asyncHandler(async (req: Request, res: Response) => {
        const data = await ratingService.getByOrder(
            Number(req.params.orderId)
        );
        return ok(res, data);
    }),

    listByDriver: asyncHandler(async (req: Request, res: Response) => {
        const data = await ratingService.listByDriver(
            req.params.driverId
        );
        return ok(res, data);
    }),

    getCustomerStats: asyncHandler(async (req: Request, res: Response) => {
        const data = await ratingService.getCustomerStats(
            req.params.customerId
        );

        if (!data) throw ApiError.notFound('Customer tidak ditemukan');

        return ok(res, data);
    }),
};