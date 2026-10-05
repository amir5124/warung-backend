// src/modules/merchant/merchant.controller.ts
import { Request, Response } from 'express';
import { merchantService } from './merchant.service';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created } from '../../utils/response';

export const merchantController = {
    upsertStore: asyncHandler(async (req: Request, res: Response) => {
        const data = await merchantService.upsertStore(req.user!.id, req.body);
        return ok(res, data, 'Profil toko berhasil disimpan');
    }),

    addCategory: asyncHandler(async (req: Request, res: Response) => {
        const data = await merchantService.addCategory(req.user!.id, req.body.name);
        return created(res, data, 'Kategori berhasil ditambahkan');
    }),

    addMenuItem: asyncHandler(async (req: Request, res: Response) => {
        const data = await merchantService.addMenuItem(req.user!.id, req.body);
        return created(res, data, 'Menu berhasil ditambahkan');
    }),

    getMyMenu: asyncHandler(async (req: Request, res: Response) => {
        const data = await merchantService.getMyMenu(req.user!.id);
        return ok(res, data);
    }),
};