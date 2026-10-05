// src/modules/merchant/merchant.controller.ts
import { Request, Response } from 'express';
import { merchantService } from './merchant.service';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created } from '../../utils/response';
import { ApiError } from '../../utils/ApiError';

export const merchantController = {
    // ============================================================
    // STORE
    // ============================================================
    upsertStore: asyncHandler(async (req: Request, res: Response) => {
        const data = await merchantService.upsertStore(req.user!.id, req.body);
        return ok(res, data, 'Profil toko berhasil disimpan');
    }),

    getMyStore: asyncHandler(async (req: Request, res: Response) => {
        const data = await merchantService.getMyStore(req.user!.id);
        return ok(res, data);
    }),

    setOpen: asyncHandler(async (req: Request, res: Response) => {
        const { is_open } = req.body;
        if (typeof is_open !== 'boolean') {
            throw ApiError.badRequest('is_open harus boolean');
        }
        const data = await merchantService.setOpen(req.user!.id, is_open);
        return ok(res, data, is_open ? 'Toko dibuka' : 'Toko ditutup');
    }),

    // ============================================================
    // CATEGORIES
    // ============================================================
    listCategories: asyncHandler(async (req: Request, res: Response) => {
        const data = await merchantService.listCategories(req.user!.id);
        return ok(res, data);
    }),

    addCategory: asyncHandler(async (req: Request, res: Response) => {
        const { name } = req.body;
        if (!name) throw ApiError.badRequest('Nama kategori wajib');
        const data = await merchantService.addCategory(req.user!.id, name);
        return created(res, data, 'Kategori berhasil ditambahkan');
    }),

    deleteCategory: asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) throw ApiError.badRequest('ID tidak valid');
        await merchantService.deleteCategory(req.user!.id, id);
        return ok(res, null, 'Kategori dihapus');
    }),

    // ============================================================
    // MENU ITEMS
    // ============================================================
    listMenu: asyncHandler(async (req: Request, res: Response) => {
        const data = await merchantService.listMenu(req.user!.id);
        return ok(res, data);
    }),

    addMenuItem: asyncHandler(async (req: Request, res: Response) => {
        const data = await merchantService.addMenuItem(req.user!.id, req.body);
        return created(res, data, 'Menu berhasil ditambahkan');
    }),

    updateMenuItem: asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) throw ApiError.badRequest('ID tidak valid');
        const data = await merchantService.updateMenuItem(req.user!.id, id, req.body);
        return ok(res, data, 'Menu berhasil diupdate');
    }),

    toggleMenuAvailability: asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) throw ApiError.badRequest('ID tidak valid');
        const data = await merchantService.toggleMenuAvailability(req.user!.id, id);
        return ok(res, data, 'Status menu diubah');
    }),

    deleteMenuItem: asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id)) throw ApiError.badRequest('ID tidak valid');
        await merchantService.deleteMenuItem(req.user!.id, id);
        return ok(res, null, 'Menu dihapus');
    }),
};