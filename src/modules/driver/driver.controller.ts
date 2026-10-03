import { Request, Response } from 'express';
import { driverService } from './driver.service';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/response';
import { ApiError } from '../../utils/ApiError';

export const driverController = {
    updateLocation: asyncHandler(async (req: Request, res: Response) => {
        const { latitude, longitude } = req.body;
        await driverService.updateLocation(req.user!.id, latitude, longitude);
        return ok(res, null, 'Location updated');
    }),

    setStatus: asyncHandler(async (req: Request, res: Response) => {
        await driverService.setStatus(req.user!.id, req.body.status);
        return ok(res, null, 'Status updated');
    }),

    updateProfile: asyncHandler(async (req: Request, res: Response) => {
        const data = await driverService.updateProfile(
            req.user!.id,
            req.body
        );
        return ok(res, data);
    }),

    updateServices: asyncHandler(async (req: Request, res: Response) => {
        const data = await driverService.updateServices(
            req.user!.id,
            req.body.services
        );
        return ok(res, data, 'Layanan diperbarui');
    }),

    getEarnings: asyncHandler(async (req: Request, res: Response) => {
        const data = await driverService.getEarnings(req.user!.id);
        return ok(res, data);
    }),

    getEarningsHistory: asyncHandler(async (req: Request, res: Response) => {
        const limit = Math.min(Number(req.query.limit ?? 50), 100);
        const offset = Math.max(Number(req.query.offset ?? 0), 0);

        const data = await driverService.getEarningsHistory(
            req.user!.id,
            limit,
            offset
        );
        return ok(res, data);
    }),

    getProfile: asyncHandler(async (req: Request, res: Response) => {
        const data = await driverService.getProfile(req.user!.id);
        return ok(res, data);
    }),

    nearby: asyncHandler(async (req: Request, res: Response) => {
        const lat = Number(req.query.lat);
        const lng = Number(req.query.lng);
        const radius = Math.min(Number(req.query.radius ?? 5000), 50000);
        const limit = Math.min(Number(req.query.limit ?? 50), 100);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw ApiError.badRequest('Query lat dan lng wajib diisi');
        }

        const data = await driverService.nearbyDrivers(
            lat,
            lng,
            radius,
            limit
        );
        return ok(res, data);
    }),
};