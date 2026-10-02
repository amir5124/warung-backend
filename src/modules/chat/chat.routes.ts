import { Router } from 'express';
import { chatController } from './chat.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

router.post('/rooms/order/:orderId', chatController.openRoom);
router.get('/rooms/:roomId/messages', chatController.listMessages);
router.post('/rooms/:roomId/messages', chatController.send);
router.put('/rooms/:roomId/read', chatController.markRead);

// upload gambar
router.post('/rooms/:roomId/images', chatController.uploadImage);

// jumlah pesan belum dibaca per order (badge di ikon chat)
router.get('/order/:orderId/unread', chatController.unreadByOrder);

export default router;