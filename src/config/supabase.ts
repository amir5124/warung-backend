import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { env } from './env';

// 🔧 Debug sementara — cek apakah env var ke-load dengan benar.
// Hapus blok ini setelah masalah ketemu.
console.log('[supabase config] URL:', env.supabaseUrl);
console.log('[supabase config] Service key exists:', !!env.supabaseServiceKey, '| length:', env.supabaseServiceKey?.length ?? 0);
console.log('[supabase config] Anon key exists:', !!env.supabaseAnonKey, '| length:', env.supabaseAnonKey?.length ?? 0);

// Service role client (bypass RLS) — hanya dipakai backend
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as any },
});

// Anon client — untuk verifikasi token user
export const supabaseAnon = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as any },
});