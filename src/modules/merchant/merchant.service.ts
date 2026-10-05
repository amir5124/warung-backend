// src/modules/merchant/merchant.service.ts
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../utils/ApiError';

export const merchantService = {
    // 1. Buat / Update Profil Toko
    async upsertStore(userId: string, data: any) {
        const { data: store, error } = await supabaseAdmin
            .from('merchant_profiles')
            .upsert({
                user_id: userId,
                store_name: data.store_name,
                description: data.description,
                address: data.address,
                logo_url: data.logo_url,
                cover_url: data.cover_url,
                open_hours: data.open_hours, // contoh: { "senin": "08:00-22:00" }
                is_open: true, // default buka
            }, { onConflict: 'user_id' })
            .select()
            .single();

        if (error) throw ApiError.internal('Gagal menyimpan profil toko');
        return store;
    },

    // 2. Tambah Kategori Menu
    async addCategory(merchantId: string, name: string) {
        const { data, error } = await supabaseAdmin
            .from('menu_categories')
            .insert({ merchant_id: merchantId, name })
            .select()
            .single();

        if (error) throw ApiError.internal('Gagal menambah kategori');
        return data;
    },

    // 3. Tambah Item Menu (Produk)
    async addMenuItem(merchantId: string, payload: any) {
        const { data, error } = await supabaseAdmin
            .from('menu_items')
            .insert({
                merchant_id: merchantId,
                category_id: payload.category_id,
                name: payload.name,
                description: payload.description,
                price: payload.price,
                image_url: payload.image_url,
                is_available: true,
            })
            .select()
            .single();

        if (error) throw ApiError.internal('Gagal menambah menu');
        return data;
    },

    // 4. Ambil Menu berdasarkan Toko
    async getMyMenu(merchantId: string) {
        const { data, error } = await supabaseAdmin
            .from('menu_items')
            .select('*, menu_categories(name)')
            .eq('merchant_id', merchantId)
            .order('created_at', { ascending: false });

        if (error) throw ApiError.internal('Gagal mengambil menu');
        return data;
    }
};