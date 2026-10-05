// src/modules/merchant/merchant.service.ts
import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../config/logger';

export const merchantService = {
    // ============================================================
    // UPSERT STORE — buat atau update profil toko
    // ============================================================
    async upsertStore(userId: string, data: {
        store_name: string;
        description?: string;
        address?: string;
        logo_url?: string;
        cover_url?: string;
        is_open?: boolean;
        open_hours?: any;
    }) {
        if (!data.store_name) {
            throw ApiError.badRequest('Nama toko wajib diisi');
        }

        const { data: store, error } = await supabaseAdmin
            .from('merchant_profiles')
            .upsert(
                {
                    user_id: userId,
                    store_name: data.store_name,
                    description: data.description ?? null,
                    address: data.address ?? null,
                    logo_url: data.logo_url ?? null,
                    cover_url: data.cover_url ?? null,
                    is_open: data.is_open ?? false,
                    open_hours: data.open_hours ?? null,
                },
                { onConflict: 'user_id' }
            )
            .select()
            .single();

        if (error) {
            logger.error('upsertStore error', { error, userId });
            throw ApiError.internal('Gagal menyimpan profil toko');
        }

        return store;
    },

    // ============================================================
    // GET STORE — ambil profil toko milik merchant
    // ============================================================
    async getMyStore(userId: string) {
        const { data, error } = await supabaseAdmin
            .from('merchant_profiles')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw ApiError.internal('Gagal mengambil profil toko');
        return data;
    },

    // ============================================================
    // TOGGLE OPEN — buka/tutup toko
    // ============================================================
    async setOpen(userId: string, isOpen: boolean) {
        const { data, error } = await supabaseAdmin
            .from('merchant_profiles')
            .update({ is_open: isOpen })
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw ApiError.internal('Gagal mengubah status toko');
        return data;
    },

    // ============================================================
    // CATEGORIES
    // ============================================================
    async listCategories(userId: string) {
        const { data, error } = await supabaseAdmin
            .from('menu_categories')
            .select('*')
            .eq('merchant_id', userId)
            .order('sort_order', { ascending: true });

        if (error) throw ApiError.internal('Gagal mengambil kategori');
        return data ?? [];
    },

    async addCategory(userId: string, name: string) {
        if (!name) throw ApiError.badRequest('Nama kategori wajib diisi');

        const { data, error } = await supabaseAdmin
            .from('menu_categories')
            .insert({ merchant_id: userId, name })
            .select()
            .single();

        if (error) throw ApiError.internal('Gagal menambah kategori');
        return data;
    },

    async deleteCategory(userId: string, categoryId: number) {
        const { error } = await supabaseAdmin
            .from('menu_categories')
            .delete()
            .eq('id', categoryId)
            .eq('merchant_id', userId);

        if (error) throw ApiError.internal('Gagal menghapus kategori');
    },

    // ============================================================
    // MENU ITEMS
    // ============================================================
    async listMenu(userId: string) {
        const { data, error } = await supabaseAdmin
            .from('menu_items')
            .select('*, menu_categories(name)')
            .eq('merchant_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw ApiError.internal('Gagal mengambil menu');
        return data ?? [];
    },

    async addMenuItem(userId: string, data: {
        category_id?: number;
        name: string;
        description?: string;
        price: number;
        image_url?: string;
        stock?: number;
    }) {
        if (!data.name) throw ApiError.badRequest('Nama menu wajib diisi');
        if (!data.price || data.price <= 0) {
            throw ApiError.badRequest('Harga wajib diisi dan > 0');
        }

        const { data: menu, error } = await supabaseAdmin
            .from('menu_items')
            .insert({
                merchant_id: userId,
                category_id: data.category_id ?? null,
                name: data.name,
                description: data.description ?? null,
                price: data.price,
                image_url: data.image_url ?? null,
                stock: data.stock ?? null,
                is_available: true,
            })
            .select()
            .single();

        if (error) {
            logger.error('addMenuItem error', { error, userId });
            throw ApiError.internal('Gagal menambah menu');
        }
        return menu;
    },

    async updateMenuItem(userId: string, itemId: number, data: any) {
        const { data: menu, error } = await supabaseAdmin
            .from('menu_items')
            .update({
                category_id: data.category_id,
                name: data.name,
                description: data.description,
                price: data.price,
                image_url: data.image_url,
                is_available: data.is_available,
                stock: data.stock,
                updated_at: new Date().toISOString(),
            })
            .eq('id', itemId)
            .eq('merchant_id', userId)
            .select()
            .single();

        if (error) throw ApiError.internal('Gagal update menu');
        return menu;
    },

    async toggleMenuAvailability(userId: string, itemId: number) {
        const { data: existing } = await supabaseAdmin
            .from('menu_items')
            .select('is_available')
            .eq('id', itemId)
            .eq('merchant_id', userId)
            .single();

        if (!existing) throw ApiError.notFound('Menu tidak ditemukan');

        const { data, error } = await supabaseAdmin
            .from('menu_items')
            .update({ is_available: !existing.is_available })
            .eq('id', itemId)
            .eq('merchant_id', userId)
            .select()
            .single();

        if (error) throw ApiError.internal('Gagal toggle menu');
        return data;
    },

    async deleteMenuItem(userId: string, itemId: number) {
        const { error } = await supabaseAdmin
            .from('menu_items')
            .delete()
            .eq('id', itemId)
            .eq('merchant_id', userId);

        if (error) throw ApiError.internal('Gagal menghapus menu');
    },
};