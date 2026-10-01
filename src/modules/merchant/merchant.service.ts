import { supabaseAdmin } from '../../config/supabase';
import { ApiError } from '../../utils/ApiError';

export const merchantService = {
    async getProfile(merchantId: string) {
        const { data } = await supabaseAdmin
            .from('merchant_profiles')
            .select('*')
            .eq('user_id', merchantId)
            .single();
        return data;
    },

    async updateProfile(merchantId: string, patch: Record<string, any>) {
        const { data, error } = await supabaseAdmin
            .from('merchant_profiles')
            .update(patch)
            .eq('user_id', merchantId)
            .select()
            .single();
        if (error) throw ApiError.internal(error.message);
        return data;
    },

    async toggleOpen(merchantId: string, isOpen: boolean) {
        return this.updateProfile(merchantId, { is_open: isOpen });
    },

    async listOpenMerchants(lat?: number, lng?: number) {
        const { data } = await supabaseAdmin
            .from('merchant_profiles')
            .select('*')
            .eq('is_open', true)
            .eq('is_verified', true);
        return data;
    },
};