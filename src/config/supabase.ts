import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { env } from './env';

// ⚠️ Fallback sementara untuk debugging. Isi di sini kalau env tidak terbaca.
// JANGAN di-commit ke git, dan hapus setelah masalah ketemu.
const FALLBACK_SUPABASE_URL = 'https://jkxyvbsayusxfvstofro.supabase.co';
const FALLBACK_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpreHl2YnNheXVzeGZ2c3RvZnJvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDQ4NDYwNywiZXhwIjoyMTA2MDYwNjA3fQ._maqSDOfgVWgHb341eKImQlvfdvamuakdDHRUxqf-9w';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpreHl2YnNheXVzeGZ2c3RvZnJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0ODQ2MDcsImV4cCI6MjEwNjA2MDYwN30.jEChhUXh4dzPNskH5xWBud5DtJO6QOSFygcaE9WX1VI';

const supabaseUrl = env.supabaseUrl || FALLBACK_SUPABASE_URL;
const supabaseServiceKey = env.supabaseServiceKey || FALLBACK_SERVICE_KEY;
const supabaseAnonKey = env.supabaseAnonKey || FALLBACK_ANON_KEY;

// Baca field "role" dari payload JWT (tanpa verifikasi, hanya untuk debug)
function jwtRole(key?: string): string {
    try {
        if (!key) return 'kosong';
        const payload = JSON.parse(
            Buffer.from(key.split('.')[1], 'base64').toString('utf8')
        );
        return payload.role ?? 'tidak ada role';
    } catch {
        return 'bukan JWT valid';
    }
}

console.log('[supabase config] URL:', supabaseUrl);
console.log(
    '[supabase config] Service key exists:', !!supabaseServiceKey,
    '| length:', supabaseServiceKey.length,
    '| role:', jwtRole(supabaseServiceKey),   // harus "service_role"
    '| dari env:', !!env.supabaseServiceKey
);
console.log(
    '[supabase config] Anon key exists:', !!supabaseAnonKey,
    '| length:', supabaseAnonKey.length,
    '| role:', jwtRole(supabaseAnonKey),       // harus "anon"
    '| dari env:', !!env.supabaseAnonKey
);

if (jwtRole(supabaseServiceKey) !== 'service_role') {
    console.error(
        '❌ [supabase config] supabaseServiceKey BUKAN service_role! RLS akan tetap berlaku.'
    );
}

// Service role client (bypass RLS), hanya dipakai backend
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as any },
});

// Anon client, untuk verifikasi token user
export const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as any },
});