import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../config/logger';
import { notificationService } from '../notification/notification.service';

export const chatService = {
    async getOrCreateRoom(orderId: number, userId: string) {
        const { data: order } = await supabaseAdmin
            .from('orders')
            .select('id, customer_id, driver_id, merchant_id')
            .eq('id', orderId)
            .single();

        if (!order) throw ApiError.notFound('Order tidak ditemukan');

        const isParticipant =
            order.customer_id === userId ||
            order.driver_id === userId ||
            order.merchant_id === userId;

        if (!isParticipant) throw ApiError.forbidden('Bukan peserta order ini');
        if (!order.driver_id) throw ApiError.badRequest('Order belum punya driver');

        const { data: existing } = await supabaseAdmin
            .from('chat_rooms')
            .select('*')
            .eq('order_id', orderId)
            .maybeSingle();

        if (existing) return existing;

        const { data, error } = await supabaseAdmin
            .from('chat_rooms')
            .insert({
                order_id: orderId,
                customer_id: order.customer_id,
                driver_id: order.driver_id,
                merchant_id: order.merchant_id,
            })
            .select()
            .single();

        if (error) throw ApiError.internal(error.message);
        return data;
    },

    async listMessages(roomId: number, userId: string, limit = 100) {
        const { data: room } = await supabaseAdmin
            .from('chat_rooms')
            .select('customer_id, driver_id, merchant_id')
            .eq('id', roomId)
            .single();

        if (!room) throw ApiError.notFound('Room tidak ditemukan');

        const isParticipant =
            room.customer_id === userId ||
            room.driver_id === userId ||
            room.merchant_id === userId;

        if (!isParticipant) throw ApiError.forbidden();

        const { data, error } = await supabaseAdmin
            .from('chat_messages')
            .select('*')
            .eq('room_id', roomId)
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) throw ApiError.internal(error.message);
        return data || [];
    },

    async sendMessage(roomId: number, senderId: string, message: string, type = 'text') {
        const { data: room } = await supabaseAdmin
            .from('chat_rooms')
            .select('id, order_id, customer_id, driver_id, merchant_id')
            .eq('id', roomId)
            .single();

        if (!room) throw ApiError.notFound();

        const isParticipant =
            room.customer_id === senderId ||
            room.driver_id === senderId ||
            room.merchant_id === senderId;

        if (!isParticipant) throw ApiError.forbidden();

        const { data, error } = await supabaseAdmin
            .from('chat_messages')
            .insert({
                room_id: roomId,
                sender_id: senderId,
                message,
                message_type: type,
            })
            .select()
            .single();

        if (error) throw ApiError.internal(error.message);

        await supabaseAdmin
            .from('chat_rooms')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', roomId);

        // Broadcast realtime ke layar chat & badge (async, tidak blocking)
        this.broadcastMessage(roomId, room.order_id, data).catch((err) => {
            logger.warn('Gagal broadcast chat', { err: err.message });
        });

        // Kirim notifikasi ke lawan bicara (async, tidak blocking)
        this.notifyRecipient(room, senderId, message, type).catch((err) => {
            logger.warn('Gagal kirim notif chat', { err: err.message });
        });

        return data;
    },

    async markRead(roomId: number, userId: string) {
        await supabaseAdmin
            .from('chat_messages')
            .update({ is_read: true })
            .eq('room_id', roomId)
            .neq('sender_id', userId);
    },

    async uploadImage(
        roomId: number,
        senderId: string,
        file: { buffer: Buffer; mimetype: string; originalname: string }
    ) {
        const { data: room } = await supabaseAdmin
            .from('chat_rooms')
            .select('id, order_id, customer_id, driver_id, merchant_id')
            .eq('id', roomId)
            .single();

        if (!room) throw ApiError.notFound('Room tidak ditemukan');

        const isParticipant =
            room.customer_id === senderId ||
            room.driver_id === senderId ||
            room.merchant_id === senderId;

        if (!isParticipant) throw ApiError.forbidden('Bukan peserta chat');

        const ext = file.originalname.split('.').pop() || 'jpg';
        const filename = `${roomId}/${senderId}-${Date.now()}.${ext}`;

        const { error: upErr } = await supabaseAdmin.storage
            .from('chat-images')
            .upload(filename, file.buffer, {
                contentType: file.mimetype,
                upsert: false,
            });

        if (upErr) {
            logger.error('Gagal upload chat image', { error: upErr, roomId });
            throw ApiError.internal(upErr.message);
        }

        const { data: urlData } = supabaseAdmin.storage
            .from('chat-images')
            .getPublicUrl(filename);

        const publicUrl = urlData.publicUrl;

        const { data: message, error: msgErr } = await supabaseAdmin
            .from('chat_messages')
            .insert({
                room_id: roomId,
                sender_id: senderId,
                message: null,
                attachment_url: publicUrl,
                message_type: 'image',
            })
            .select()
            .single();

        if (msgErr) {
            logger.error('Gagal insert chat image message', { error: msgErr });
            throw ApiError.internal(msgErr.message);
        }

        await supabaseAdmin
            .from('chat_rooms')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', roomId);

        // Broadcast realtime
        this.broadcastMessage(roomId, room.order_id, message).catch((err) => {
            logger.warn('Gagal broadcast chat image', { err: err.message });
        });

        // Kirim notifikasi chat gambar
        this.notifyRecipient(room, senderId, null, 'image').catch((err) => {
            logger.warn('Gagal kirim notif chat image', { err: err.message });
        });

        return message;
    },

    /**
     * Jumlah pesan belum dibaca untuk satu order (dipakai badge di ikon chat).
     */
    async unreadCountByOrder(orderId: number, userId: string) {
        const { data: room } = await supabaseAdmin
            .from('chat_rooms')
            .select('id, customer_id, driver_id, merchant_id')
            .eq('order_id', orderId)
            .maybeSingle();

        if (!room) return { room_id: null, unread: 0 };

        const isParticipant =
            room.customer_id === userId ||
            room.driver_id === userId ||
            room.merchant_id === userId;
        if (!isParticipant) throw ApiError.forbidden();

        const { count, error } = await supabaseAdmin
            .from('chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('room_id', room.id)
            .eq('is_read', false)
            .neq('sender_id', userId);

        if (error) throw ApiError.internal(error.message);
        return { room_id: room.id, unread: count ?? 0 };
    },

    /**
     * Helper: broadcast ke dua channel Realtime:
     *  - `chat:{roomId}`        → isi pesan, untuk layar chat yang terbuka
     *  - `order-chat:{orderId}` → sinyal ringan (room_id saja), untuk badge unread
     * Memakai REST API Realtime, jadi tidak butuh JWT khusus di client.
     */
    async broadcastMessage(roomId: number, orderId: number, message: unknown) {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!url || !key) {
            logger.warn('Broadcast dilewati: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset');
            return;
        }

        const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: [
                    {
                        topic: `chat:${roomId}`,
                        event: 'new_message',
                        payload: message,
                        private: false,
                    },
                    {
                        topic: `order-chat:${orderId}`,
                        event: 'new_message',
                        payload: { room_id: roomId },
                        private: false,
                    },
                ],
            }),
        });

        if (!res.ok) {
            throw new Error(`Broadcast gagal: ${res.status} ${await res.text()}`);
        }
    },

    /**
     * Helper: kirim notifikasi ke lawan bicara di room.
     */
    async notifyRecipient(
        room: {
            id: number;
            order_id: number;
            customer_id: string;
            driver_id: string | null;
            merchant_id: string | null;
        },
        senderId: string,
        message: string | null,
        type: string
    ) {
        // Tentukan penerima: kalau sender customer → kirim ke driver; sebaliknya
        let recipientId: string | null = null;
        if (room.customer_id === senderId) {
            recipientId = room.driver_id;
        } else if (room.driver_id === senderId) {
            recipientId = room.customer_id;
        } else if (room.merchant_id === senderId) {
            recipientId = room.customer_id;
        }

        if (!recipientId) return;

        // Ambil nama pengirim
        const { data: sender } = await supabaseAdmin
            .from('profiles')
            .select('full_name, role')
            .eq('id', senderId)
            .maybeSingle();

        const senderName = sender?.full_name ?? 'Pengguna';

        // Preview pesan
        let preview = '';
        if (type === 'image') {
            preview = '📷 Mengirim foto';
        } else if (message) {
            preview = message.length > 60 ? message.slice(0, 60) + '…' : message;
        } else {
            preview = 'Pesan baru';
        }

        await notificationService.sendToUser(recipientId, {
            title: `Pesan dari ${senderName}`,
            body: preview,
            data: {
                type: 'chat_message',
                room_id: room.id ?? undefined,
                order_id: room.order_id,
            },
        });
    },
};