/**
 * Hand-written placeholder matching the migration schema.
 * Replace with `npx supabase gen types typescript --local` once Supabase is linked.
 *
 * Generated from: supabase/migrations/00001_create_service_tables.sql
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      brands: {
        Row: {
          id: string
          name: string
          slug: string
          description: string | null
          logo_url: string | null
          hero_image_url: string | null
          status: string
          category: string | null
          founding_year: number | null
          purchase_links: Json
          social_links: Json
          retail_locations: Json
          product_photos: Json
          contact_email: string | null
          founder: Json | null
          product_highlights: Json | null
          submitted_at: string
          approved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          description?: string | null
          logo_url?: string | null
          hero_image_url?: string | null
          status?: string
          category?: string | null
          founding_year?: number | null
          purchase_links?: Json
          social_links?: Json
          retail_locations?: Json
          product_photos?: Json
          contact_email?: string | null
          founder?: Json | null
          product_highlights?: Json | null
          submitted_at?: string
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          description?: string | null
          logo_url?: string | null
          hero_image_url?: string | null
          status?: string
          category?: string | null
          founding_year?: number | null
          purchase_links?: Json
          social_links?: Json
          retail_locations?: Json
          product_photos?: Json
          contact_email?: string | null
          founder?: Json | null
          product_highlights?: Json | null
          submitted_at?: string
          approved_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      taxonomy_tags: {
        Row: {
          id: string
          name: string
          name_zh: string | null
          slug: string
          category: string
          is_active: boolean
          suggested_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          name_zh?: string | null
          slug: string
          category: string
          is_active?: boolean
          suggested_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          name_zh?: string | null
          slug?: string
          category?: string
          is_active?: boolean
          suggested_by?: string | null
          created_at?: string
        }
      }
      brand_taxonomy: {
        Row: {
          brand_id: string
          tag_id: string
        }
        Insert: {
          brand_id: string
          tag_id: string
        }
        Update: {
          brand_id?: string
          tag_id?: string
        }
      }
      brand_submissions: {
        Row: {
          id: string
          brand_id: string | null
          brand_name: string
          submitter_email: string
          submitter_name: string | null
          description: string | null
          website_url: string | null
          social_links: Json
          suggested_tags: Json
          status: string
          reviewer_notes: string | null
          submitted_at: string
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          id?: string
          brand_id?: string | null
          brand_name: string
          submitter_email: string
          submitter_name?: string | null
          description?: string | null
          website_url?: string | null
          social_links?: Json
          suggested_tags?: Json
          status?: string
          reviewer_notes?: string | null
          submitted_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          id?: string
          brand_id?: string | null
          brand_name?: string
          submitter_email?: string
          submitter_name?: string | null
          description?: string | null
          website_url?: string | null
          social_links?: Json
          suggested_tags?: Json
          status?: string
          reviewer_notes?: string | null
          submitted_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
