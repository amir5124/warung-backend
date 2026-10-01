import { Request, Response } from 'express';
import { merchantService } from './merchant.service';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/response';

export const merchantController = {
    profile: asyncHandler(async (req: Request, res: Response) =>
        ok(res, await merchantService.getProfile(req.user!.id))
    ),
    update: asyncHandler(async (req: Request, res: Response) =>
        ok(res, await merchantService.updateProfile(req.user!.id, req.body))
    ),
    toggleOpen: asyncHandler(async (req: Request, res: Response) =>
        ok(res, await merchantService.toggleOpen(req.user!.id, !!req.body.is_open))
    ),
    listOpen: asyncHandler(async (_req: Request, res: Response) =>
        ok(res, await merchantService.listOpenMerchants())
    ),
};