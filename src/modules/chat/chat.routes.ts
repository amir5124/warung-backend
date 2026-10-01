import { Router } from 'express';
import { chatController } from './chat.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

router.post('/rooms/order/:orderId', chatController.openRoom);
router.get('/rooms/:roomId/messages', chatController.listMessages);
router.post('/rooms/:roomId/messages', chatController.send);
router.put('/rooms/:roomId/read', chatController.markRead);

// ← tambah: upload gambar
router.post('/rooms/:roomId/images', chatController.uploadImage);

export default router;