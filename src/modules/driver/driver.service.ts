import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../utils/ApiError';

/**
 * Parse kolom `current_location` (PostGIS geography) dari Supabase.
 * Supabase PostgREST bisa kirim sebagai:
 *  - EWKB hex string: "0101000020E6100000..."
 *  - GeoJSON: { type: 'Point', coordinates: [lng, lat] }
 *  - Object langsung: { latitude, longitude }
 */
function parseEwkbHex(hex: string): { latitude: number; longitude: number } | null {
    if (!hex || typeof hex !== 'string') return null;
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 50) return null;

    try {
        const little = hex.slice(0, 2) === '01';
        const lngHex = hex.slice(18, 34);
        const latHex = hex.slice(34, 50);

        const hexToDouble = (h: string) => {
            const bytes = new Uint8Array(8);
            for (let i = 0; i < 8; i++) {
                const idx = little ? i : 7 - i;
                bytes[idx] = parseInt(h.substr(i * 2, 2), 16);
            }
            return new DataView(bytes.buffer).getFloat64(0, true);
        };

        const longitude = hexToDouble(lngHex);
        const latitude = hexToDouble(latHex);

        if (
            Number.isFinite(latitude) &&
            Number.isFinite(longitude) &&
            !(latitude === 0 && longitude === 0)
        ) {
            return { latitude, longitude };
        }
    } catch (err) {
        console.warn('[parseEwkbHex] gagal:', err);
    }
    return null;
}

/**
 * Parse nilai location apapun (hex, GeoJSON, object, WKT).
 */
function parseLocation(loc: any): { latitude: number; longitude: number } | null {
    if (!loc) return null;

    // 1. Hex string EWKB
    if (typeof loc === 'string') {
        const fromHex = parseEwkbHex(loc);
        if (fromHex) return fromHex;

        // WKT: "POINT(lng lat)"
        const m = loc.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
        if (m) {
            return { latitude: Number(m[2]), longitude: Number(m[1]) };
        }
        return null;
    }

    // 2. GeoJSON: { type: 'Point', coordinates: [lng, lat] }
    if (Array.isArray(loc?.coordinates) && loc.coordinates.length >= 2) {
        const [lng, lat] = loc.coordinates;
        if (typeof lat === 'number' && typeof lng === 'number') {
            return { latitude: lat, longitude: lng };
        }
    }

    // 3. Object { latitude, longitude }
    if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
        return { latitude: loc.latitude, longitude: loc.longitude };
    }

    return null;
}

export const driverService = {
    async updateLocation(driverId: string, lat: number, lng: number) {
        const { error } = await supabaseAdmin.rpc('update_driver_location', {
            p_driver_id: driverId,
            p_lat: lat,
            p_lng: lng,
        });

        // Fallback kalau RPC belum dibuat
        if (error) {
            await supabaseAdmin
                .from('driver_profiles')
                .update({
                    current_location: `POINT(${lng} ${lat})`,
                    location_updated_at: new Date().toISOString(),
                })
                .eq('user_id', driverId);
        }
    },

    async setStatus(driverId: string, status: 'offline' | 'online' | 'busy') {
        const { error } = await supabaseAdmin
            .from('driver_profiles')
            .update({ status })
            .eq('user_id', driverId);
        if (error) throw ApiError.internal(error.message);
    },

    async updateProfile(driverId: string, patch: Record<string, any>) {
        const { data, error } = await supabaseAdmin
            .from('driver_profiles')
            .update(patch)
            .eq('user_id', driverId)
            .select()
            .single();
        if (error) throw ApiError.internal(error.message);
        return data;
    },

    async updateServices(driverId: string, services: string[]) {
        // Validasi: hanya boleh layanan yang ada di tabel tariffs
        const { data: validTariffs } = await supabaseAdmin
            .from('tariffs')
            .select('code')
            .eq('is_active', true);

        const validCodes = new Set((validTariffs ?? []).map((t: any) => t.code));
        const filtered = services.filter((s) => validCodes.has(s));

        if (filtered.length === 0) {
            throw ApiError.badRequest('Pilih minimal 1 layanan valid');
        }

        const { data, error } = await supabaseAdmin
            .from('driver_profiles')
            .update({ services: filtered })
            .eq('user_id', driverId)
            .select()
            .single();

        if (error) throw ApiError.internal(error.message);
        return data;
    },

    async getEarnings(driverId: string) {
        const now = new Date();

        // Awal hari ini (00:00)
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);

        // Awal minggu ini (Senin 00:00)
        const startOfWeek = new Date(now);
        const day = startOfWeek.getDay(); // 0=Minggu, 1=Senin
        const diff = day === 0 ? 6 : day - 1; // kalau Minggu, mundur 6 hari ke Senin
        startOfWeek.setDate(startOfWeek.getDate() - diff);
        startOfWeek.setHours(0, 0, 0, 0);

        // Awal bulan ini
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Query semua order completed milik driver ini
        const { data: orders, error } = await supabaseAdmin
            .from('orders')
            .select('driver_earning, completed_at, status')
            .eq('driver_id', driverId)
            .eq('status', 'completed');

        if (error) {
            throw new Error(error.message);
        }

        const rows = orders ?? [];

        const sumSince = (since: Date) =>
            rows
                .filter((o: any) => {
                    if (!o.completed_at) return false;
                    return new Date(o.completed_at) >= since;
                })
                .reduce(
                    (sum: number, o: any) =>
                        sum + Number(o.driver_earning ?? 0),
                    0
                );

        const total = rows.reduce(
            (sum: number, o: any) => sum + Number(o.driver_earning ?? 0),
            0
        );

        const today = sumSince(startOfToday);
        const week = sumSince(startOfWeek);
        const month = sumSince(startOfMonth);

        // Pending: order yang sudah accepted/arrived/in_progress tapi belum completed
        const { data: pendingOrders } = await supabaseAdmin
            .from('orders')
            .select('driver_earning')
            .eq('driver_id', driverId)
            .in('status', ['accepted', 'arrived', 'in_progress']);

        const pending = (pendingOrders ?? []).reduce(
            (sum: number, o: any) => sum + Number(o.driver_earning ?? 0),
            0
        );

        return {
            today,
            week,
            month,
            total,
            pending,
        };
    },

    async getEarningsHistory(driverId: string, limit = 50, offset = 0) {
        const { data, error } = await supabaseAdmin
            .from('orders')
            .select(
                'id, order_code, type, dropoff_name, pickup_name, driver_earning, completed_at, tariff_code, option_name'
            )
            .eq('driver_id', driverId)
            .eq('status', 'completed')
            .order('completed_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            throw new Error(error.message);
        }

        return data ?? [];
    },

    async getProfile(driverId: string) {
        const { data, error } = await supabaseAdmin
            .from('driver_profiles')
            .select('*')
            .eq('user_id', driverId)
            .single();
        if (error) throw ApiError.internal(error.message);
        return data;
    },

    /**
     * Driver online di sekitar titik tertentu.
     * Return data lengkap: id, nama, avatar, kendaraan, plat, rating, jarak, coords.
     */
    async nearbyDrivers(
        lat: number,
        lng: number,
        radius = 5000,
        limit = 50
    ) {
        // 1. Cari driver terdekat lewat RPC
        const { data, error } = await supabaseAdmin.rpc('find_nearby_drivers', {
            p_lat: lat,
            p_lng: lng,
            p_radius_m: radius,
            p_limit: limit,
        });
        if (error) throw ApiError.internal(error.message);
        if (!data || data.length === 0) return [];

        const driverIds = data.map((d: any) => d.user_id);

        // 2. Ambil profiles (nama, avatar)
        const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, avatar_url')
            .in('id', driverIds);

        // 3. Ambil driver_profiles (kendaraan, plat, rating, current_location)
        const { data: driverProfiles } = await supabaseAdmin
            .from('driver_profiles')
            .select(
                'user_id, vehicle_type, plate_number, vehicle_brand, rating_avg, total_trips, current_location'
            )
            .in('user_id', driverIds);

        const profileMap = new Map(
            (profiles ?? []).map((p: any) => [p.id, p])
        );
        const dpMap = new Map(
            (driverProfiles ?? []).map((d: any) => [d.user_id, d])
        );

        // 4. Gabungkan
        return data
            .map((d: any) => {
                const profile = profileMap.get(d.user_id);
                const dp = dpMap.get(d.user_id);
                const coords = parseLocation(dp?.current_location);

                return {
                    id: d.user_id,
                    name: profile?.full_name ?? 'Driver',
                    avatar_url: profile?.avatar_url ?? null,
                    vehicle_type: dp?.vehicle_type ?? 'motor',
                    plate_number: dp?.plate_number ?? null,
                    vehicle_brand: dp?.vehicle_brand ?? null,
                    rating_avg: dp?.rating_avg ?? 5,
                    total_trips: dp?.total_trips ?? 0,
                    distance_m: d.distance_m,
                    coords,   // { latitude, longitude } atau null
                };
            })
            .filter((d: any) => d.coords);   // hanya yang punya koordinat valid
    },
};

