// src/modules/wallet/wallet.controller.ts
import { Request, Response } from 'express';
import { walletService } from './wallet.service';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created } from '../../utils/response';
import { ApiError } from '../../utils/ApiError';

export const walletController = {
    // GET /api/wallet
    getWallet: asyncHandler(async (req: Request, res: Response) => {
        const data = await walletService.getWallet(req.user!.id);
        return ok(res, data);
    }),

    // GET /api/wallet/ledger
    listLedger: asyncHandler(async (req: Request, res: Response) => {
        const limit = Number(req.query.limit ?? 50);
        const offset = Number(req.query.offset ?? 0);
        const data = await walletService.listLedger(
            req.user!.id,
            limit,
            offset
        );
        return ok(res, data);
    }),

    // GET /api/wallet/payouts
    listPayouts: asyncHandler(async (req: Request, res: Response) => {
        const data = await walletService.listPayouts(req.user!.id);
        return ok(res, data);
    }),

    // POST /api/wallet/payouts
    requestPayout: asyncHandler(async (req: Request, res: Response) => {
        const { amount, bank_code, bank_name, account_number, account_name } =
            req.body;

        if (!amount || amount <= 0) {
            throw ApiError.badRequest('Jumlah tidak valid');
        }
        if (!bank_code || !account_number || !account_name) {
            throw ApiError.badRequest('Info bank tidak lengkap');
        }

        const data = await walletService.requestPayout(
            req.user!.id,
            Number(amount),
            { bank_code, bank_name, account_number, account_name }
        );
        return created(res, data, 'Pencairan sedang diproses');
    }),
};