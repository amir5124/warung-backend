// src/modules/admin/admin.service.ts
//
// Logika data untuk semua layar app admin: Beranda, Pesanan, Mitra, Keuangan, Akun.
// Batas hari memakai WIB (UTC+7).
//
// ⚠️ Bagian bertanda "SESUAIKAN" adalah PERKIRAAN nama tabel/kolom/nilai status
// yang belum terlihat di kode yang kamu kirim. Cocokkan dengan schema Supabase-mu.

import { supabaseAdmin as sb } from '../../config/supabase';

// ─────────────────────────────────────────────────────────────
// Konfigurasi
// ─────────────────────────────────────────────────────────────
const T = {
    orders: 'orders',
    profiles: 'profiles',
    merchants: 'merchant_profiles', // sudah ada (kolom user_id, is_verified, store_name)
    drivers: 'driver_profiles', //     sudah ada (kolom user_id, is_verified)
    driverWallets: 'driver_wallets', // SESUAIKAN: kolom user_id, cash_debt
    walletTx: 'wallet_transactions', // SESUAIKAN: tabel top up & penarikan (type, status, amount, user_id)
    audit: 'admin_audit_logs', //       buat dengan supabase/admin_audit_logs.sql
} as const;

// SESUAIKAN: kelompok status order → nilai status asli di tabel orders
const STATUS_GROUPS: Record<string, string[]> = {
    diproses: ['pending', 'searching', 'accepted', 'preparing', 'ready', 'assigned'],
    diantar: ['picked_up', 'on_the_way', 'delivering', 'arrived'],
    selesai: ['completed'],
    batal: ['cancelled'],
};

// SESUAIKAN: filter jenis transaksi pada tabel wallet_transactions
const WITHDRAW_FILTER = 'type.ilike.%withdraw%,type.ilike.%tarik%,type.ilike.%payout%';
const TOPUP_FILTER = 'type.ilike.%top%up%,type.ilike.%deposit%';

const SERVICE_LABEL: Record<string, string> = { ride: 'URide/UCar', send: 'USend', food: 'UFood' };

// ─────────────────────────────────────────────────────────────
// Util
// ─────────────────────────────────────────────────────────────
export class HttpError extends Error {
    status: number;
    statusCode: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = this.statusCode = status;
    }
}

const WIB_MS = 7 * 60 * 60 * 1000;

/** Awal hari WIB, `daysAgo` hari ke belakang (negatif = ke depan). Hasil Date UTC. */
const startOfDayWIB = (daysAgo = 0) => {
    const w = new Date(Date.now() + WIB_MS);
    return new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() - daysAgo) - WIB_MS);
};
const dateKeyWIB = (d: Date) => new Date(d.getTime() + WIB_MS).toISOString().slice(0, 10);

const num = (v: any) => Number(v) || 0;
const page = (o: { limit?: any; offset?: any }) => ({
    limit: Math.min(Math.max(Number(o.limit) || 20, 1), 100),
    offset: Math.max(Number(o.offset) || 0, 0),
});
/** Bersihkan input pencarian dari karakter khusus filter PostgREST */
const cleanSearch = (s?: string) => (s ?? '').replace(/[%_,()*\\]/g, '').trim();
const chunk = <T,>(a: T[], n: number): T[][] =>
    Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

type CountQ = PromiseLike<{ count: number | null; error: any }>;
async function countRows(q: CountQ) {
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
}
/** Kalau tabel/kolom salah, jangan menjatuhkan seluruh layar. */
async function safeCount(label: string, q: CountQ) {
    try {
        return await countRows(q);
    } catch (e: any) {
        console.warn(`[ADMIN] ${label} gagal (cek nama tabel/kolom):`, e?.message);
        return 0;
    }
}
const head = { count: 'exact' as const, head: true };

/** Ambil profil sekaligus untuk banyak id. */
async function profileMap(ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter(Boolean) as string[])];
    const map = new Map<string, any>();
    for (const part of chunk(uniq, 200)) {
        const { data, error } = await sb
            .from(T.profiles)
            .select('id, full_name, phone, role, is_active, created_at')
            .in('id', part);
        if (error) throw new Error(`profiles: ${error.message}`);
        (data ?? []).forEach((p: any) => map.set(p.id, p));
    }
    return map;
}

/** Catatan aktivitas admin (UI login menjanjikan "aktivitas admin dicatat"). Tidak pernah menggagalkan aksi. */
export async function audit(
    adminId: string | undefined,
    action: string,
    targetType: string,
    targetId: string,
    meta: Record<string, unknown> = {}
) {
    try {
        const { error } = await sb
            .from(T.audit)
            .insert({ admin_id: adminId ?? null, action, target_type: targetType, target_id: targetId, meta });
        if (error) console.warn('[ADMIN AUDIT] gagal menulis log:', error.message);
    } catch (e: any) {
        console.warn('[ADMIN AUDIT] gagal menulis log:', e?.message);
    }
}

// ─────────────────────────────────────────────────────────────
// BERANDA
// ─────────────────────────────────────────────────────────────
export async function getDashboard() {
    const days = Array.from({ length: 7 }, (_, i) => startOfDayWIB(6 - i)); // 6 hari lalu → hari ini
    const tomorrow = startOfDayWIB(-1);
    const todayStart = days[6];

    const perDay = Promise.all(
        days.map((d, i) =>
            countRows(
                sb
                    .from(T.orders)
                    .select('id', head)
                    .neq('status', 'cancelled')
                    .gte('created_at', d.toISOString())
                    .lt('created_at', (i < 6 ? days[i + 1] : tomorrow).toISOString())
            )
        )
    );

    // SESUAIKAN: kolom komisi & waktu selesai pada orders
    const commission = (async () => {
        const { data, error } = await sb
            .from(T.orders)
            .select('commission_amount')
            .eq('status', 'completed')
            .gte('completed_at', todayStart.toISOString())
            .lt('completed_at', tomorrow.toISOString())
            .limit(5000);
        if (error) {
            console.warn('[ADMIN] komisi gagal (cek kolom):', error.message);
            return 0;
        }
        return (data ?? []).reduce((s: number, r: any) => s + num(r.commission_amount), 0);
    })();

    const [counts, commissionToday, activePartners, pendingMerchants, pendingDrivers, pendingWithdrawals] =
        await Promise.all([
            perDay,
            commission,
            safeCount(
                'mitra aktif',
                sb
                    .from(T.profiles)
                    .select('id', head)
                    .in('role', ['driver', 'merchant'])
                    .or('is_active.is.null,is_active.eq.true')
            ),
            safeCount('merchant pending', sb.from(T.merchants).select('user_id', head).eq('is_verified', false)),
            safeCount('driver pending', sb.from(T.drivers).select('user_id', head).eq('is_verified', false)),
            safeCount('penarikan pending', sb.from(T.walletTx).select('id', head).or(WITHDRAW_FILTER).eq('status', 'pending')),
        ]);

    return {
        orders_today: counts[6],
        commission_today: commissionToday,
        active_partners: activePartners,
        pending_verification: {
            merchants: pendingMerchants,
            drivers: pendingDrivers,
            total: pendingMerchants + pendingDrivers,
        },
        pending_withdrawals: pendingWithdrawals,
        orders_last_7_days: days.map((d, i) => ({ date: dateKeyWIB(d), count: counts[i] })),
    };
}

// ─────────────────────────────────────────────────────────────
// PESANAN
// ─────────────────────────────────────────────────────────────
const groupOf = (status: string) =>
    Object.entries(STATUS_GROUPS).find(([, v]) => v.includes(String(status).toLowerCase()))?.[0] ?? 'lainnya';

async function enrichOrders(rows: any[]) {
    const [people, merchantRows] = await Promise.all([
        // SESUAIKAN: kolom customer_id / driver_id pada orders
        profileMap(rows.flatMap((o) => [o.customer_id, o.driver_id])),
        (async () => {
            // SESUAIKAN: kolom merchant_id pada orders (berisi user_id merchant)
            const ids = [...new Set(rows.map((o) => o.merchant_id).filter(Boolean))] as string[];
            const m = new Map<string, string>();
            for (const part of chunk(ids, 200)) {
                const { data } = await sb.from(T.merchants).select('user_id, store_name').in('user_id', part);
                (data ?? []).forEach((r: any) => m.set(r.user_id, r.store_name));
            }
            return m;
        })(),
    ]);

    return rows.map((o) => ({
        id: o.id,
        order_code: o.order_code ?? String(o.id),
        service: o.option_name || SERVICE_LABEL[String(o.type)] || String(o.type ?? ''),
        status: groupOf(o.status),
        raw_status: o.status,
        // SESUAIKAN: kolom total pesanan
        total: num(o.total_amount ?? o.total_price ?? o.total ?? o.price),
        settlement_type: o.settlement_type ?? null,
        merchant_name: merchantRows.get(o.merchant_id) ?? null,
        driver_name: people.get(o.driver_id)?.full_name ?? null,
        customer_name: people.get(o.customer_id)?.full_name ?? null,
        dropoff_name: o.dropoff_name ?? null,
        created_at: o.created_at,
        completed_at: o.completed_at ?? null,
    }));
}

export async function listOrders(opts: { status?: string; search?: string; limit?: any; offset?: any }) {
    const { limit, offset } = page(opts);
    let q = sb
        .from(T.orders)
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    const group = opts.status ? STATUS_GROUPS[opts.status] : undefined;
    if (group) q = q.in('status', group);
    const term = cleanSearch(opts.search);
    if (term) q = q.ilike('order_code', `%${term}%`);

    const { data, error, count } = await q;
    if (error) throw new Error(`orders: ${error.message}`);
    return { items: await enrichOrders(data ?? []), total: count ?? 0 };
}

export async function getOrder(id: string) {
    const { data, error } = await sb.from(T.orders).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`orders: ${error.message}`);
    if (!data) throw new HttpError(404, 'Pesanan tidak ditemukan');
    const [item] = await enrichOrders([data]);
    return { ...item, raw: data };
}

// ─────────────────────────────────────────────────────────────
// MITRA (merchant & driver)
// ─────────────────────────────────────────────────────────────
type PartnerType = 'merchant' | 'driver';

export async function listPartners(opts: {
    type: PartnerType;
    status?: string; // all | active | pending | suspended
    search?: string;
    limit?: any;
    offset?: any;
}) {
    const { limit, offset } = page(opts);
    const isMerchant = opts.type === 'merchant';

    const { data, error } = await sb
        .from(isMerchant ? T.merchants : T.drivers)
        .select('*')
        .limit(2000);
    if (error) throw new Error(`partners: ${error.message}`);
    const rows = data ?? [];
    const people = await profileMap(rows.map((r: any) => r.user_id));

    let items = rows.map((r: any) => {
        const p = people.get(r.user_id);
        const suspended = p?.is_active === false;
        const verified = !!r.is_verified;
        return {
            user_id: r.user_id,
            name: (isMerchant ? r.store_name : null) ?? p?.full_name ?? 'Tanpa nama',
            owner_name: p?.full_name ?? null,
            phone: p?.phone ?? null,
            address: r.address ?? null,
            is_verified: verified,
            is_suspended: suspended,
            status: suspended ? 'suspended' : verified ? 'active' : 'pending',
            is_open: isMerchant ? (r.is_open ?? null) : null,
            rating_avg: r.rating_avg ?? null,
            total_orders: r.total_orders ?? null,
            created_at: r.created_at ?? p?.created_at ?? null,
        };
    });

    // hitungan per status (sebelum filter), untuk badge di tab
    const counts = {
        all: items.length,
        active: items.filter((i) => i.status === 'active').length,
        pending: items.filter((i) => i.status === 'pending').length,
        suspended: items.filter((i) => i.status === 'suspended').length,
    };

    if (opts.status && opts.status !== 'all') items = items.filter((i) => i.status === opts.status);
    const term = cleanSearch(opts.search).toLowerCase();
    if (term) {
        items = items.filter(
            (i) => i.name.toLowerCase().includes(term) || (i.phone ?? '').includes(term)
        );
    }

    // yang menunggu verifikasi tampil di atas, lalu terbaru
    items.sort((a, b) => {
        if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1;
        return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
    });

    return { items: items.slice(offset, offset + limit), total: items.length, counts };
}

export async function verifyPartner(type: PartnerType, userId: string, adminId?: string) {
    const { data, error } = await sb
        .from(type === 'merchant' ? T.merchants : T.drivers)
        .update({ is_verified: true })
        .eq('user_id', userId)
        .select('user_id');
    if (error) throw new Error(`verify ${type}: ${error.message}`);
    if (!data?.length) throw new HttpError(404, `${type === 'merchant' ? 'Merchant' : 'Driver'} tidak ditemukan`);
    await audit(adminId, `verify_${type}`, type, userId);
}

export async function setPartnerSuspended(userId: string, suspended: boolean, adminId?: string) {
    const { data: prof, error: pe } = await sb.from(T.profiles).select('id, role').eq('id', userId).maybeSingle();
    if (pe) throw new Error(`profiles: ${pe.message}`);
    if (!prof) throw new HttpError(404, 'Akun tidak ditemukan');
    if (prof.role === 'admin') throw new HttpError(403, 'Akun admin tidak bisa ditangguhkan lewat menu mitra');

    const { error } = await sb.from(T.profiles).update({ is_active: !suspended }).eq('id', userId);
    if (error) throw new Error(`suspend: ${error.message}`);

    // merchant yang ditangguhkan otomatis ditutup
    if (suspended && prof.role === 'merchant') {
        await sb.from(T.merchants).update({ is_open: false }).eq('user_id', userId);
    }
    await audit(adminId, suspended ? 'suspend_partner' : 'activate_partner', prof.role, userId);
}

// ─────────────────────────────────────────────────────────────
// KEUANGAN
// ─────────────────────────────────────────────────────────────
const txStatus = (s: any): 'pending' | 'approved' | 'rejected' | 'success' | 'failed' => {
    const v = String(s ?? '').toLowerCase();
    if (['approved'].includes(v)) return 'approved';
    if (['rejected', 'cancelled', 'canceled'].includes(v)) return 'rejected';
    if (['success', 'paid', 'completed', 'settled', 'done'].includes(v)) return 'success';
    if (['failed', 'expired'].includes(v)) return 'failed';
    return 'pending';
};

async function debtMap(userIds: string[]) {
    const m = new Map<string, number>();
    for (const part of chunk([...new Set(userIds)], 200)) {
        const { data, error } = await sb.from(T.driverWallets).select('user_id, cash_debt').in('user_id', part);
        if (error) {
            console.warn('[ADMIN] cash_debt gagal (cek tabel driver_wallets):', error.message);
            continue;
        }
        (data ?? []).forEach((w: any) => m.set(w.user_id, num(w.cash_debt)));
    }
    return m;
}

async function listWalletTx(
    filter: string,
    opts: { status?: string; limit?: any; offset?: any }
) {
    const { limit, offset } = page(opts);
    let q = sb
        .from(T.walletTx)
        .select('*', { count: 'exact' })
        .or(filter)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (opts.status && opts.status !== 'all') q = q.eq('status', opts.status);

    const { data, error, count } = await q;
    if (error) throw new Error(`wallet_transactions: ${error.message}`);
    const rows = data ?? [];

    const [people, debts] = await Promise.all([
        profileMap(rows.map((t: any) => t.user_id)),
        debtMap(rows.map((t: any) => t.user_id)),
    ]);

    const items = rows.map((t: any) => {
        const p = people.get(t.user_id);
        return {
            id: t.id,
            user_id: t.user_id,
            name: p?.full_name ?? 'Tanpa nama',
            role: p?.role ?? null,
            amount: Math.abs(num(t.amount)),
            status: txStatus(t.status),
            raw_status: t.status,
            // SESUAIKAN: nama kolom rekening tujuan
            bank_name: t.bank_name ?? t.bank_code ?? null,
            account_number: t.account_number ?? null,
            account_name: t.account_name ?? null,
            cash_debt: debts.get(t.user_id) ?? 0,
            created_at: t.created_at,
        };
    });
    return { items, total: count ?? 0 };
}

export const listWithdrawals = (opts: { status?: string; limit?: any; offset?: any }) =>
    listWalletTx(WITHDRAW_FILTER, { status: opts.status ?? 'pending', ...opts });

export const listTopups = (opts: { status?: string; limit?: any; offset?: any }) =>
    listWalletTx(TOPUP_FILTER, opts);

export async function getFinanceSummary() {
    const { data, error } = await sb
        .from(T.walletTx)
        .select('amount')
        .or(WITHDRAW_FILTER)
        .eq('status', 'pending')
        .limit(5000);
    if (error) throw new Error(`wallet_transactions: ${error.message}`);
    const rows = data ?? [];
    return {
        pending_withdrawals: {
            count: rows.length,
            total: rows.reduce((s: number, r: any) => s + Math.abs(num(r.amount)), 0),
        },
    };
}

/** Komisi platform per pesanan selesai (terbaru dulu). */
export async function listCommissions(opts: { limit?: any; offset?: any }) {
    const { limit, offset } = page(opts);
    // SESUAIKAN: kolom commission_amount, completed_at
    const { data, error, count } = await sb
        .from(T.orders)
        .select('id, order_code, type, option_name, settlement_type, commission_amount, completed_at', {
            count: 'exact',
        })
        .eq('status', 'completed')
        .gt('commission_amount', 0)
        .order('completed_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) throw new Error(`orders: ${error.message}`);

    return {
        items: (data ?? []).map((o: any) => ({
            id: o.id,
            order_code: o.order_code ?? String(o.id),
            service: o.option_name || SERVICE_LABEL[String(o.type)] || String(o.type ?? ''),
            settlement_type: o.settlement_type ?? null,
            commission: num(o.commission_amount),
            completed_at: o.completed_at,
        })),
        total: count ?? 0,
    };
}

async function getPendingWithdrawal(id: string) {
    const { data, error } = await sb.from(T.walletTx).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`wallet_transactions: ${error.message}`);
    if (!data) throw new HttpError(404, 'Permintaan penarikan tidak ditemukan');
    if (txStatus(data.status) !== 'pending') throw new HttpError(409, 'Permintaan ini sudah diproses');
    return data;
}

export async function approveWithdrawal(id: string, adminId?: string) {
    const tx = await getPendingWithdrawal(id);

    // Aturan: saldo tidak bisa ditarik selama masih ada utang komisi
    const debt = (await debtMap([tx.user_id])).get(tx.user_id) ?? 0;
    if (debt > 0) {
        throw new HttpError(409, `Mitra masih punya utang komisi Rp${Math.round(debt).toLocaleString('id-ID')}`);
    }

    // `.eq('status', tx.status)` mencegah dua admin menyetujui bersamaan
    const { data, error } = await sb
        .from(T.walletTx)
        .update({ status: 'approved' })
        .eq('id', id)
        .eq('status', tx.status)
        .select('id');
    if (error) throw new Error(`approve: ${error.message}`);
    if (!data?.length) throw new HttpError(409, 'Permintaan ini sudah diproses');

    // TODO: jalankan pencairan ke rekening (LinkQu) lewat wallet service yang sudah ada,
    //       lalu ubah status → 'success' / 'failed' dari callback.
    await audit(adminId, 'approve_withdrawal', 'withdrawal', id, { user_id: tx.user_id, amount: tx.amount });
}

export async function rejectWithdrawal(id: string, reason: string | undefined, adminId?: string) {
    const tx = await getPendingWithdrawal(id);

    const { data, error } = await sb
        .from(T.walletTx)
        .update({ status: 'rejected' })
        .eq('id', id)
        .eq('status', tx.status)
        .select('id');
    if (error) throw new Error(`reject: ${error.message}`);
    if (!data?.length) throw new HttpError(409, 'Permintaan ini sudah diproses');

    // TODO PENTING: kalau saat pengajuan dana sudah ditahan (mis. pindah ke pending_payout),
    //               kembalikan ke saldo mitra di sini lewat wallet service yang sudah ada.
    await audit(adminId, 'reject_withdrawal', 'withdrawal', id, {
        user_id: tx.user_id,
        amount: tx.amount,
        reason: reason ?? null,
    });
}

// ─────────────────────────────────────────────────────────────
// AKUN
// ─────────────────────────────────────────────────────────────
export async function listAdmins() {
    const { data, error } = await sb
        .from(T.profiles)
        .select('id, full_name, email, phone, is_active, created_at')
        .eq('role', 'admin')
        .order('created_at', { ascending: true });
    if (error) throw new Error(`profiles: ${error.message}`);
    return data ?? [];
}

export async function listAuditLogs(opts: { limit?: any; offset?: any }) {
    const { limit, offset } = page(opts);
    const { data, error, count } = await sb
        .from(T.audit)
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) throw new Error(`${T.audit}: ${error.message}`);
    const rows = data ?? [];
    const people = await profileMap(rows.map((r: any) => r.admin_id));
    return {
        items: rows.map((r: any) => ({ ...r, admin_name: people.get(r.admin_id)?.full_name ?? null })),
        total: count ?? 0,
    };
}