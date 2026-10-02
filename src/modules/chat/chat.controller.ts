import { Request, Response } from 'express';
import multer from 'multer';
import { chatService } from './chat.service';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created } from '../../utils/response';
import { ApiError } from '../../utils/ApiError';

// Setup multer (memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },     // max 5 MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Hanya file gambar yang diizinkan'));
    },
});

export const chatController = {
    openRoom: asyncHandler(async (req: Request, res: Response) => {
        const orderId = Number(req.params.orderId);
        const data = await chatService.getOrCreateRoom(orderId, req.user!.id);
        return ok(res, data);
    }),

    listMessages: asyncHandler(async (req: Request, res: Response) => {
        const roomId = Number(req.params.roomId);
        const data = await chatService.listMessages(roomId, req.user!.id);
        return ok(res, data);
    }),

    send: asyncHandler(async (req: Request, res: Response) => {
        const roomId = Number(req.params.roomId);
        const { message, type } = req.body;
        const data = await chatService.sendMessage(roomId, req.user!.id, message, type);
        return created(res, data, 'Pesan terkirim');
    }),

    markRead: asyncHandler(async (req: Request, res: Response) => {
        const roomId = Number(req.params.roomId);
        await chatService.markRead(roomId, req.user!.id);
        return ok(res, null, 'Ditandai terbaca');
    }),

    unreadByOrder: asyncHandler(async (req: Request, res: Response) => {
        const orderId = Number(req.params.orderId);
        const data = await chatService.unreadCountByOrder(orderId, req.user!.id);
        return ok(res, data);
    }),

    /**
     * Upload gambar ke chat room.
     * Pakai multer middleware — file di-parse dari multipart/form-data
     * dengan field name 'image'.
     */
    uploadImage: [
        upload.single('image'),
        asyncHandler(async (req: Request, res: Response) => {
            const roomId = Number(req.params.roomId);
            const file = req.file;

            if (!file) {
                throw ApiError.badRequest('File gambar wajib diunggah (field: image)');
            }

            const data = await chatService.uploadImage(roomId, req.user!.id, {
                buffer: file.buffer,
                mimetype: file.mimetype,
                originalname: file.originalname,
            });

            return created(res, data, 'Gambar terkirim');
        }),
    ],
};