import { supabaseAdmin } from '../../config/supabase';
import { expoPushService } from './expoPush.service';
import { getIO } from '../../sockets';
import { logger } from '../../config/logger';

// HARUS sama dengan ANDROID_CHANNEL_ID di frontend (lib/push.ts)
const ANDROID_CHANNEL_ID = 'orders';
// HARUS sama dengan nama file di android/app/src/main/res/raw/notification.mp3
// TANPA ekstensi .mp3
const ANDROID_SOUND = 'notification';

export interface NotificationPayload {
    title: string;
    body: string;
    data?: Record<string, any>;
}

export const notificationService = {
    /**
     * Kirim notifikasi ke user:
     * 1. Simpan ke tabel `notifications`
     * 2. Emit via Socket.IO (kalau user online)
     * 3. Kirim via Expo Push (kalau user punya fcm_token)
     */
    async sendToUser(userId: string, payload: NotificationPayload) {
        // ---------- 1. Simpan ke DB ----------
        try {
            await supabaseAdmin.from('notifications').insert({
                user_id: userId,
                title: payload.title,
                body: payload.body,
                data: payload.data || {},
                channel: 'both',
                sent_at: new Date().toISOString(),
            });
        } catch (err: any) {
            logger.warn('Gagal simpan notification', {
                userId,
                err: err.message,
            });
        }

        // ---------- 2. Socket.IO ----------
        const io = getIO();
        if (io) {
            io.of('/app').to(`user:${userId}`).emit('notification:new', {
                title: payload.title,
                body: payload.body,
                data: payload.data,
                created_at: new Date().toISOString(),
            });
            logger.info('Socket emit notif', { userId });
        }

        // ---------- 3. Expo Push ----------
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('fcm_token')
            .eq('id', userId)
            .maybeSingle();

        if (!profile?.fcm_token) {
            logger.warn('User tidak punya fcm_token, skip push', { userId });
            return true;
        }

        const result = await expoPushService.send({
            to: profile.fcm_token,
            title: payload.title,
            body: payload.body,
            data: payload.data,
            sound: ANDROID_SOUND,        // ← 'notification' (tanpa .mp3)
            priority: 'high',
            channelId: ANDROID_CHANNEL_ID,  // ← 'orders'
        });

        if (result) {
            logger.info('Push terkirim', {
                userId,
                title: payload.title,
                channelId: ANDROID_CHANNEL_ID,
                sound: ANDROID_SOUND,
            });
        }

        return true;
    },

    /**
     * Kirim ke banyak user sekaligus.
     * Cocok untuk broadcast ke driver kandidat.
     */
    async sendToUsers(userIds: string[], payload: NotificationPayload) {
        if (!userIds.length) return;

        // Simpan ke DB batch
        try {
            await supabaseAdmin.from('notifications').insert(
                userIds.map((uid) => ({
                    user_id: uid,
                    title: payload.title,
                    body: payload.body,
                    data: payload.data || {},
                    channel: 'both',
                    sent_at: new Date().toISOString(),
                }))
            );
        } catch (err: any) {
            logger.warn('Gagal batch insert notifications', {
                err: err.message,
            });
        }

        // Socket.IO batch
        const io = getIO();
        if (io) {
            userIds.forEach((uid) => {
                io.of('/app').to(`user:${uid}`).emit('notification:new', {
                    title: payload.title,
                    body: payload.body,
                    data: payload.data,
                });
            });
        }

        // Expo push batch (1 request untuk banyak user)
        const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('id, fcm_token')
            .in('id', userIds)
            .not('fcm_token', 'is', null);

        if (!profiles?.length) {
            logger.warn('Tidak ada user dengan fcm_token', { userIds });
            return;
        }

        const messages = profiles.map((p) => ({
            to: p.fcm_token!,
            title: payload.title,
            body: payload.body,
            data: payload.data,
            sound: ANDROID_SOUND,
            priority: 'high' as const,
            channelId: ANDROID_CHANNEL_ID,
        }));

        await expoPushService.send(messages);
        logger.info('Batch push terkirim', {
            count: messages.length,
            channelId: ANDROID_CHANNEL_ID,
            sound: ANDROID_SOUND,
        });
    },

    async list(userId: string) {
        const { data } = await supabaseAdmin
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(100);
        return data || [];
    },

    async markRead(userId: string, notifId: number) {
        await supabaseAdmin
            .from('notifications')
            .update({ is_read: true })
            .eq('id', notifId)
            .eq('user_id', userId);
    },
};