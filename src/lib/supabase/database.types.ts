export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_email: string
          admin_user_id: string
          correlation_id: string | null
          created_at: string
          id: string
          metadata: Json | null
          target_brand_id: string | null
          target_brand_slug: string | null
        }
        Insert: {
          action: string
          admin_email: string
          admin_user_id: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          target_brand_id?: string | null
          target_brand_slug?: string | null
        }
        Update: {
          action?: string
          admin_email?: string
          admin_user_id?: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          target_brand_id?: string | null
          target_brand_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_target_brand_id_fkey"
            columns: ["target_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      app_secrets: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      batch_processing_log: {
        Row: {
          duration_ms: number | null
          errors: Json | null
          id: string
          notified: number
          run_at: string | null
          triggered_by: string | null
          validated: number
        }
        Insert: {
          duration_ms?: number | null
          errors?: Json | null
          id?: string
          notified?: number
          run_at?: string | null
          triggered_by?: string | null
          validated?: number
        }
        Update: {
          duration_ms?: number | null
          errors?: Json | null
          id?: string
          notified?: number
          run_at?: string | null
          triggered_by?: string | null
          validated?: number
        }
        Relationships: []
      }
      brand_ai_results: {
        Row: {
          attempt: number | null
          audit_span_id: string | null
          brand_id: string | null
          cached_prompt_tokens: number | null
          category: string | null
          completion_tokens: number | null
          confidence: string | null
          config: Json | null
          cost_usd: number | null
          created_at: string
          description: string | null
          id: string
          input: Json | null
          is_non_brand: boolean | null
          job_id: string | null
          latency_ms: number | null
          model: string
          non_brand_reason: string | null
          phase: string
          prompt_tokens: number | null
          raw_response: Json | null
          retry_attempt: number
          slug_generated: string | null
          subcategories: string[] | null
          submission_id: string | null
        }
        Insert: {
          attempt?: number | null
          audit_span_id?: string | null
          brand_id?: string | null
          cached_prompt_tokens?: number | null
          category?: string | null
          completion_tokens?: number | null
          confidence?: string | null
          config?: Json | null
          cost_usd?: number | null
          created_at?: string
          description?: string | null
          id?: string
          input?: Json | null
          is_non_brand?: boolean | null
          job_id?: string | null
          latency_ms?: number | null
          model: string
          non_brand_reason?: string | null
          phase: string
          prompt_tokens?: number | null
          raw_response?: Json | null
          retry_attempt?: number
          slug_generated?: string | null
          subcategories?: string[] | null
          submission_id?: string | null
        }
        Update: {
          attempt?: number | null
          audit_span_id?: string | null
          brand_id?: string | null
          cached_prompt_tokens?: number | null
          category?: string | null
          completion_tokens?: number | null
          confidence?: string | null
          config?: Json | null
          cost_usd?: number | null
          created_at?: string
          description?: string | null
          id?: string
          input?: Json | null
          is_non_brand?: boolean | null
          job_id?: string | null
          latency_ms?: number | null
          model?: string
          non_brand_reason?: string | null
          phase?: string
          prompt_tokens?: number | null
          raw_response?: Json | null
          retry_attempt?: number
          slug_generated?: string | null
          subcategories?: string[] | null
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_ai_results_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_ai_results_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "curation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_ai_results_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "brand_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_channels: {
        Row: {
          address: string | null
          brand_id: string
          country: string | null
          created_at: string
          created_by: string | null
          district: string | null
          fetched_at: string | null
          id: string
          last_confirmed_at: string | null
          location_type: string | null
          name: string
          normalized_name: string
          owner_status: string
          owner_status_by: string | null
          provider_metadata: Json | null
          region_label: string | null
          removed_at: string | null
          removed_by: string | null
          source: string
          source_url: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          address?: string | null
          brand_id: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          district?: string | null
          fetched_at?: string | null
          id?: string
          last_confirmed_at?: string | null
          location_type?: string | null
          name: string
          normalized_name: string
          owner_status?: string
          owner_status_by?: string | null
          provider_metadata?: Json | null
          region_label?: string | null
          removed_at?: string | null
          removed_by?: string | null
          source: string
          source_url?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          address?: string | null
          brand_id?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          district?: string | null
          fetched_at?: string | null
          id?: string
          last_confirmed_at?: string | null
          location_type?: string | null
          name?: string
          normalized_name?: string
          owner_status?: string
          owner_status_by?: string | null
          provider_metadata?: Json | null
          region_label?: string | null
          removed_at?: string | null
          removed_by?: string | null
          source?: string
          source_url?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_channels_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_content_provenance: {
        Row: {
          brand_id: string
          description_content_hash: string
          first_published_at: string
          last_material_update_at: string
        }
        Insert: {
          brand_id: string
          description_content_hash: string
          first_published_at: string
          last_material_update_at?: string
        }
        Update: {
          brand_id?: string
          description_content_hash?: string
          first_published_at?: string
          last_material_update_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_content_provenance_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_faq_entries: {
        Row: {
          answer_en: string | null
          answer_zh: string | null
          brand_id: string
          position: number
          preset_id: string
          question_en: string | null
          question_zh: string | null
          source: string
          updated_at: string
        }
        Insert: {
          answer_en?: string | null
          answer_zh?: string | null
          brand_id: string
          position?: number
          preset_id: string
          question_en?: string | null
          question_zh?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          answer_en?: string | null
          answer_zh?: string | null
          brand_id?: string
          position?: number
          preset_id?: string
          question_en?: string | null
          question_zh?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_faq_entries_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_field_corrections: {
        Row: {
          brand_id: string
          created_at: string
          field: string
          id: string
          previous_value: Json | null
          proposed_value: Json
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          status: string
          visitor_hash: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          field: string
          id?: string
          previous_value?: Json | null
          proposed_value: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          visitor_hash?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          field?: string
          id?: string
          previous_value?: Json | null
          proposed_value?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          visitor_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_field_corrections_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_field_events: {
        Row: {
          actor: string | null
          brand_id: string
          created_at: string
          field: string
          id: number
          job_id: string | null
          new_value: Json | null
          old_value: Json | null
          source: string
        }
        Insert: {
          actor?: string | null
          brand_id: string
          created_at?: string
          field: string
          id?: number
          job_id?: string | null
          new_value?: Json | null
          old_value?: Json | null
          source: string
        }
        Update: {
          actor?: string | null
          brand_id?: string
          created_at?: string
          field?: string
          id?: number
          job_id?: string | null
          new_value?: Json | null
          old_value?: Json | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_field_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_field_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "curation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_field_state: {
        Row: {
          admin_locked: boolean
          brand_id: string
          field: string
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admin_locked?: boolean
          brand_id: string
          field: string
          source: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admin_locked?: boolean
          brand_id?: string
          field?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_field_state_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_images: {
        Row: {
          alt_zh: string | null
          brand_id: string
          created_at: string
          dominant_color: string | null
          entropy: number | null
          height: number | null
          id: string
          phash: string | null
          provider_metadata: Json | null
          rejected_at: string | null
          rejection_reasons: string[] | null
          score: number | null
          sharpness: number | null
          sort_order: number
          source: string
          source_url: string | null
          status: string
          storage_path: string | null
          tags: string[] | null
          url: string
          width: number | null
        }
        Insert: {
          alt_zh?: string | null
          brand_id: string
          created_at?: string
          dominant_color?: string | null
          entropy?: number | null
          height?: number | null
          id?: string
          phash?: string | null
          provider_metadata?: Json | null
          rejected_at?: string | null
          rejection_reasons?: string[] | null
          score?: number | null
          sharpness?: number | null
          sort_order?: number
          source: string
          source_url?: string | null
          status?: string
          storage_path?: string | null
          tags?: string[] | null
          url?: string
          width?: number | null
        }
        Update: {
          alt_zh?: string | null
          brand_id?: string
          created_at?: string
          dominant_color?: string | null
          entropy?: number | null
          height?: number | null
          id?: string
          phash?: string | null
          provider_metadata?: Json | null
          rejected_at?: string | null
          rejection_reasons?: string[] | null
          score?: number | null
          sharpness?: number | null
          sort_order?: number
          source?: string
          source_url?: string | null
          status?: string
          storage_path?: string | null
          tags?: string[] | null
          url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_images_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_likes: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          visitor_hash: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          visitor_hash: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          visitor_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_likes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_owners: {
        Row: {
          brand_id: string
          claimed_at: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          brand_id: string
          claimed_at?: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          claimed_at?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_owners_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_product_subcategory_additions: {
        Row: {
          brand_id: string
          created_at: string
          subcategory: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          subcategory: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          subcategory?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_product_subcategory_additions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_reports: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          notes: string | null
          reason: string
          reported_field: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          notes?: string | null
          reason: string
          reported_field?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          reason?: string
          reported_field?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_reports_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_saves: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_saves_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_search_results: {
        Row: {
          attempt: number
          audit_span_id: string | null
          brand_id: string | null
          call_status: string
          config: Json | null
          created_at: string
          endpoint: string | null
          error: string | null
          http_status: number | null
          id: string
          input: Json | null
          job_id: string | null
          latency_ms: number | null
          provider: string
          query: string
          raw_response: Json | null
          retry_attempt: number
          search_type: string
          snippets: string[]
          submission_id: string | null
          urls: string[]
        }
        Insert: {
          attempt?: number
          audit_span_id?: string | null
          brand_id?: string | null
          call_status?: string
          config?: Json | null
          created_at?: string
          endpoint?: string | null
          error?: string | null
          http_status?: number | null
          id?: string
          input?: Json | null
          job_id?: string | null
          latency_ms?: number | null
          provider?: string
          query: string
          raw_response?: Json | null
          retry_attempt?: number
          search_type: string
          snippets?: string[]
          submission_id?: string | null
          urls?: string[]
        }
        Update: {
          attempt?: number
          audit_span_id?: string | null
          brand_id?: string | null
          call_status?: string
          config?: Json | null
          created_at?: string
          endpoint?: string | null
          error?: string | null
          http_status?: number | null
          id?: string
          input?: Json | null
          job_id?: string | null
          latency_ms?: number | null
          provider?: string
          query?: string
          raw_response?: Json | null
          retry_attempt?: number
          search_type?: string
          snippets?: string[]
          submission_id?: string | null
          urls?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "brand_search_results_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_search_results_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "curation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_search_results_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "brand_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_slug_redirects: {
        Row: {
          created_at: string
          new_slug: string
          old_slug: string
        }
        Insert: {
          created_at?: string
          new_slug: string
          old_slug: string
        }
        Update: {
          created_at?: string
          new_slug?: string
          old_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_slug_redirects_new_slug_fkey"
            columns: ["new_slug"]
            isOneToOne: false
            referencedRelation: "brand_image_provenance"
            referencedColumns: ["brand_slug"]
          },
          {
            foreignKeyName: "brand_slug_redirects_new_slug_fkey"
            columns: ["new_slug"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["slug"]
          },
        ]
      }
      brand_submissions: {
        Row: {
          base_brand_data: Json | null
          base_brand_updated_at: string | null
          brand_id: string | null
          brand_name: string
          category_note: string | null
          denial_reason: string | null
          description: string | null
          enriched_data: Json | null
          hero_image_storage_path: string | null
          hero_image_url: string | null
          id: string
          idempotency_key: string | null
          intent: string
          is_brand_owner: boolean | null
          notified_at: string | null
          other_urls: Json
          owner_data: Json | null
          pdpa_consent_at: string | null
          purchase_myship: string | null
          purchase_pinkoi: string | null
          purchase_shopee: string | null
          purchase_website: string | null
          refresh_requested_by: string | null
          review_overrides: Json
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          romanized_name: string | null
          social_facebook: string | null
          social_instagram: string | null
          social_threads: string | null
          source_attribution: string | null
          status: string
          submitted_at: string | null
          submitter_email: string
          submitter_name: string | null
          suggested_tags: Json | null
          validation_errors: Json | null
          validation_status: string | null
          website_url: string | null
        }
        Insert: {
          base_brand_data?: Json | null
          base_brand_updated_at?: string | null
          brand_id?: string | null
          brand_name: string
          category_note?: string | null
          denial_reason?: string | null
          description?: string | null
          enriched_data?: Json | null
          hero_image_storage_path?: string | null
          hero_image_url?: string | null
          id?: string
          idempotency_key?: string | null
          intent?: string
          is_brand_owner?: boolean | null
          notified_at?: string | null
          other_urls?: Json
          owner_data?: Json | null
          pdpa_consent_at?: string | null
          purchase_myship?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
          refresh_requested_by?: string | null
          review_overrides?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          romanized_name?: string | null
          social_facebook?: string | null
          social_instagram?: string | null
          social_threads?: string | null
          source_attribution?: string | null
          status?: string
          submitted_at?: string | null
          submitter_email: string
          submitter_name?: string | null
          suggested_tags?: Json | null
          validation_errors?: Json | null
          validation_status?: string | null
          website_url?: string | null
        }
        Update: {
          base_brand_data?: Json | null
          base_brand_updated_at?: string | null
          brand_id?: string | null
          brand_name?: string
          category_note?: string | null
          denial_reason?: string | null
          description?: string | null
          enriched_data?: Json | null
          hero_image_storage_path?: string | null
          hero_image_url?: string | null
          id?: string
          idempotency_key?: string | null
          intent?: string
          is_brand_owner?: boolean | null
          notified_at?: string | null
          other_urls?: Json
          owner_data?: Json | null
          pdpa_consent_at?: string | null
          purchase_myship?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
          refresh_requested_by?: string | null
          review_overrides?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          romanized_name?: string | null
          social_facebook?: string | null
          social_instagram?: string | null
          social_threads?: string | null
          source_attribution?: string | null
          status?: string
          submitted_at?: string | null
          submitter_email?: string
          submitter_name?: string | null
          suggested_tags?: Json | null
          validation_errors?: Json | null
          validation_status?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_submissions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          approved_at: string | null
          blurb: string | null
          blurb_en: string | null
          brand_enriched_at: string | null
          category: string | null
          city: string | null
          contact_email: string | null
          created_at: string | null
          description: string | null
          description_en: string | null
          draft_data: Json | null
          draft_updated_at: string | null
          founding_year: number | null
          hero_image_storage_path: string | null
          hero_image_url: string | null
          hidden_reason: string | null
          id: string
          is_demo: boolean
          logo_storage_path: string | null
          material: string[]
          model_faq_count: number
          name: string
          onboarding_dismissed_at: string | null
          other_urls: Json
          purchase_myship: string | null
          purchase_pinkoi: string | null
          purchase_shopee: string | null
          purchase_website: string | null
          reputation_summary: Json | null
          romanized_name: string | null
          search_vector: unknown
          seo_promoted: boolean | null
          site_content: Json | null
          slug: string
          social_facebook: string | null
          social_instagram: string | null
          social_threads: string | null
          source: string | null
          status: string
          subcategories: string[] | null
          subcategories_en: string[] | null
          submitted_at: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          blurb?: string | null
          blurb_en?: string | null
          brand_enriched_at?: string | null
          category?: string | null
          city?: string | null
          contact_email?: string | null
          created_at?: string | null
          description?: string | null
          description_en?: string | null
          draft_data?: Json | null
          draft_updated_at?: string | null
          founding_year?: number | null
          hero_image_storage_path?: string | null
          hero_image_url?: string | null
          hidden_reason?: string | null
          id?: string
          is_demo?: boolean
          logo_storage_path?: string | null
          material?: string[]
          model_faq_count?: number
          name: string
          onboarding_dismissed_at?: string | null
          other_urls?: Json
          purchase_myship?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
          reputation_summary?: Json | null
          romanized_name?: string | null
          search_vector?: unknown
          seo_promoted?: boolean | null
          site_content?: Json | null
          slug: string
          social_facebook?: string | null
          social_instagram?: string | null
          social_threads?: string | null
          source?: string | null
          status?: string
          subcategories?: string[] | null
          subcategories_en?: string[] | null
          submitted_at?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          blurb?: string | null
          blurb_en?: string | null
          brand_enriched_at?: string | null
          category?: string | null
          city?: string | null
          contact_email?: string | null
          created_at?: string | null
          description?: string | null
          description_en?: string | null
          draft_data?: Json | null
          draft_updated_at?: string | null
          founding_year?: number | null
          hero_image_storage_path?: string | null
          hero_image_url?: string | null
          hidden_reason?: string | null
          id?: string
          is_demo?: boolean
          logo_storage_path?: string | null
          material?: string[]
          model_faq_count?: number
          name?: string
          onboarding_dismissed_at?: string | null
          other_urls?: Json
          purchase_myship?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
          reputation_summary?: Json | null
          romanized_name?: string | null
          search_vector?: unknown
          seo_promoted?: boolean | null
          site_content?: Json | null
          slug?: string
          social_facebook?: string | null
          social_instagram?: string | null
          social_threads?: string | null
          source?: string | null
          status?: string
          subcategories?: string[] | null
          subcategories_en?: string[] | null
          submitted_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      claim_proof_cleanup_jobs: {
        Row: {
          attempt_count: number
          claim_request_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          lease_token: string | null
          reason: string
          retry_at: string
          status: string
          storage_key: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          claim_request_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          reason: string
          retry_at?: string
          status?: string
          storage_key: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          claim_request_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          reason?: string
          retry_at?: string
          status?: string
          storage_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_proof_cleanup_jobs_claim_request_id_fkey"
            columns: ["claim_request_id"]
            isOneToOne: false
            referencedRelation: "claim_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_requests: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          mit_smile_cert: string | null
          proof_evidence: Json
          proof_notes: string | null
          proof_type: string | null
          proof_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          status: string
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          mit_smile_cert?: string | null
          proof_evidence?: Json
          proof_notes?: string | null
          proof_type?: string | null
          proof_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          mit_smile_cert?: string | null
          proof_evidence?: Json
          proof_notes?: string | null
          proof_type?: string | null
          proof_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_requests_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      crawler_hits: {
        Row: {
          count: number
          crawler_name: string
          day: string
          path_class: string
        }
        Insert: {
          count?: number
          crawler_name: string
          day: string
          path_class: string
        }
        Update: {
          count?: number
          crawler_name?: string
          day?: string
          path_class?: string
        }
        Relationships: []
      }
      cron_http_dispatch: {
        Row: {
          dispatch_id: string
          dispatched_at: string
          job_name: string
          request_id: number
        }
        Insert: {
          dispatch_id?: string
          dispatched_at?: string
          job_name: string
          request_id: number
        }
        Update: {
          dispatch_id?: string
          dispatched_at?: string
          job_name?: string
          request_id?: number
        }
        Relationships: []
      }
      cron_http_log: {
        Row: {
          created: string | null
          dispatch_id: string
          error_msg: string | null
          job_name: string
          logged_at: string
          request_id: number
          status_code: number | null
          timed_out: boolean
        }
        Insert: {
          created?: string | null
          dispatch_id?: string
          error_msg?: string | null
          job_name: string
          logged_at?: string
          request_id: number
          status_code?: number | null
          timed_out?: boolean
        }
        Update: {
          created?: string | null
          dispatch_id?: string
          error_msg?: string | null
          job_name?: string
          logged_at?: string
          request_id?: number
          status_code?: number | null
          timed_out?: boolean
        }
        Relationships: []
      }
      curated_product_candidates: {
        Row: {
          brand_id: string
          created_at: string
          deterministic_origin_assessment: Json | null
          final_rank: number | null
          gate_result: string
          id: string
          image_url: string | null
          job_id: string | null
          llm_origin_assessment: Json | null
          llm_rationale: string | null
          llm_score: number | null
          mit_qualified: boolean | null
          normalized_url: string
          qualification_method: string | null
          registry_origin_assessment: Json | null
          search_position: number | null
          submission_id: string | null
          supplier: string
          title: string | null
          url: string
          url_class: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          deterministic_origin_assessment?: Json | null
          final_rank?: number | null
          gate_result: string
          id?: string
          image_url?: string | null
          job_id?: string | null
          llm_origin_assessment?: Json | null
          llm_rationale?: string | null
          llm_score?: number | null
          mit_qualified?: boolean | null
          normalized_url: string
          qualification_method?: string | null
          registry_origin_assessment?: Json | null
          search_position?: number | null
          submission_id?: string | null
          supplier: string
          title?: string | null
          url: string
          url_class: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          deterministic_origin_assessment?: Json | null
          final_rank?: number | null
          gate_result?: string
          id?: string
          image_url?: string | null
          job_id?: string | null
          llm_origin_assessment?: Json | null
          llm_rationale?: string | null
          llm_score?: number | null
          mit_qualified?: boolean | null
          normalized_url?: string
          qualification_method?: string | null
          registry_origin_assessment?: Json | null
          search_position?: number | null
          submission_id?: string | null
          supplier?: string
          title?: string | null
          url?: string
          url_class?: string
        }
        Relationships: [
          {
            foreignKeyName: "curated_product_candidates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curated_product_candidates_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "brand_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      curated_product_selections: {
        Row: {
          created_at: string
          position: number
          product_id: string
          section_key: string
          state: string
          trail_slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          position?: number
          product_id: string
          section_key: string
          state?: string
          trail_slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          position?: number
          product_id?: string
          section_key?: string
          state?: string
          trail_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curated_product_selections_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "curated_products"
            referencedColumns: ["id"]
          },
        ]
      }
      curated_product_sources: {
        Row: {
          checked_at: string | null
          claim_en: string | null
          claim_zh: string | null
          created_at: string
          id: string
          product_id: string
          source_type: string
          state: string
          updated_at: string
          url: string
        }
        Insert: {
          checked_at?: string | null
          claim_en?: string | null
          claim_zh?: string | null
          created_at?: string
          id?: string
          product_id: string
          source_type?: string
          state?: string
          updated_at?: string
          url: string
        }
        Update: {
          checked_at?: string | null
          claim_en?: string | null
          claim_zh?: string | null
          created_at?: string
          id?: string
          product_id?: string
          source_type?: string
          state?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "curated_product_sources_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "curated_products"
            referencedColumns: ["id"]
          },
        ]
      }
      curated_products: {
        Row: {
          brand_id: string
          category: string
          created_at: string
          id: string
          image_height: number | null
          image_source_url: string | null
          image_url: string | null
          image_width: number | null
          key: string
          link_checked_at: string | null
          link_state: string
          made_in_taiwan_confirmed: boolean
          material: string[]
          materials_from_taiwan_confirmed: boolean
          mit_registry_id: number | null
          name_en: string | null
          name_zh: string
          official_url: string | null
          origin_candidate_id: string | null
          product_description_en: string | null
          product_description_zh: string
          product_position: number | null
          proposed_by: string
          review_due_at: string | null
          source_checked_at: string | null
          subcategory: string | null
          updated_at: string
          visible: boolean
        }
        Insert: {
          brand_id: string
          category: string
          created_at?: string
          id?: string
          image_height?: number | null
          image_source_url?: string | null
          image_url?: string | null
          image_width?: number | null
          key: string
          link_checked_at?: string | null
          link_state?: string
          made_in_taiwan_confirmed?: boolean
          material?: string[]
          materials_from_taiwan_confirmed?: boolean
          mit_registry_id?: number | null
          name_en?: string | null
          name_zh: string
          official_url?: string | null
          origin_candidate_id?: string | null
          product_description_en?: string | null
          product_description_zh: string
          product_position?: number | null
          proposed_by?: string
          review_due_at?: string | null
          source_checked_at?: string | null
          subcategory?: string | null
          updated_at?: string
          visible?: boolean
        }
        Update: {
          brand_id?: string
          category?: string
          created_at?: string
          id?: string
          image_height?: number | null
          image_source_url?: string | null
          image_url?: string | null
          image_width?: number | null
          key?: string
          link_checked_at?: string | null
          link_state?: string
          made_in_taiwan_confirmed?: boolean
          material?: string[]
          materials_from_taiwan_confirmed?: boolean
          mit_registry_id?: number | null
          name_en?: string | null
          name_zh?: string
          official_url?: string | null
          origin_candidate_id?: string | null
          product_description_en?: string | null
          product_description_zh?: string
          product_position?: number | null
          proposed_by?: string
          review_due_at?: string | null
          source_checked_at?: string | null
          subcategory?: string | null
          updated_at?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "curated_products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curated_products_mit_registry_id_fkey"
            columns: ["mit_registry_id"]
            isOneToOne: false
            referencedRelation: "mit_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curated_products_origin_candidate_id_fkey"
            columns: ["origin_candidate_id"]
            isOneToOne: false
            referencedRelation: "curated_product_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      curation_job_targets: {
        Row: {
          brand_name: string
          brand_slug: string | null
          changed_fields: string[]
          completed_at: string | null
          created_at: string
          current_phase: string | null
          duration_ms: number | null
          error: string | null
          id: string
          job_id: string
          phase_results: Json
          started_at: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          brand_name: string
          brand_slug?: string | null
          changed_fields?: string[]
          completed_at?: string | null
          created_at?: string
          current_phase?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          job_id: string
          phase_results?: Json
          started_at?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          brand_name?: string
          brand_slug?: string | null
          changed_fields?: string[]
          completed_at?: string | null
          created_at?: string
          current_phase?: string | null
          duration_ms?: number | null
          error?: string | null
          id?: string
          job_id?: string
          phase_results?: Json
          started_at?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "curation_job_targets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "curation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      curation_jobs: {
        Row: {
          attempt: number
          cancelled_count: number
          completed_at: string | null
          created_at: string | null
          current_phase: string | null
          current_target_id: string | null
          dedupe_key: string | null
          dispatch_error: string | null
          dispatch_status: string
          dispatched_at: string | null
          dry_run: boolean
          failed_count: number
          heartbeat_at: string | null
          id: string
          job_error: string | null
          operation: string
          params: Json | null
          parent_job_id: string | null
          progress: Json | null
          result: Json | null
          run_after: string
          scheduled_for: string | null
          skipped_count: number
          started_at: string | null
          started_by: string
          status: string
          succeeded_count: number
          target_total: number
          trigger: string
          worker_token: string | null
        }
        Insert: {
          attempt?: number
          cancelled_count?: number
          completed_at?: string | null
          created_at?: string | null
          current_phase?: string | null
          current_target_id?: string | null
          dedupe_key?: string | null
          dispatch_error?: string | null
          dispatch_status?: string
          dispatched_at?: string | null
          dry_run?: boolean
          failed_count?: number
          heartbeat_at?: string | null
          id?: string
          job_error?: string | null
          operation: string
          params?: Json | null
          parent_job_id?: string | null
          progress?: Json | null
          result?: Json | null
          run_after?: string
          scheduled_for?: string | null
          skipped_count?: number
          started_at?: string | null
          started_by: string
          status?: string
          succeeded_count?: number
          target_total?: number
          trigger?: string
          worker_token?: string | null
        }
        Update: {
          attempt?: number
          cancelled_count?: number
          completed_at?: string | null
          created_at?: string | null
          current_phase?: string | null
          current_target_id?: string | null
          dedupe_key?: string | null
          dispatch_error?: string | null
          dispatch_status?: string
          dispatched_at?: string | null
          dry_run?: boolean
          failed_count?: number
          heartbeat_at?: string | null
          id?: string
          job_error?: string | null
          operation?: string
          params?: Json | null
          parent_job_id?: string | null
          progress?: Json | null
          result?: Json | null
          run_after?: string
          scheduled_for?: string | null
          skipped_count?: number
          started_at?: string | null
          started_by?: string
          status?: string
          succeeded_count?: number
          target_total?: number
          trigger?: string
          worker_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curation_jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "curation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sends: {
        Row: {
          id: string
          sent_at: string
          template_key: string
          user_id: string
        }
        Insert: {
          id?: string
          sent_at?: string
          template_key: string
          user_id: string
        }
        Update: {
          id?: string
          sent_at?: string
          template_key?: string
          user_id?: string
        }
        Relationships: []
      }
      event_brands: {
        Row: {
          area: string | null
          area_en: string | null
          booth: string | null
          brand_id: string
          created_at: string
          event_exhibitor_id: string | null
          event_id: string
          id: string
          note: string | null
          note_en: string | null
          sort_order: number
        }
        Insert: {
          area?: string | null
          area_en?: string | null
          booth?: string | null
          brand_id: string
          created_at?: string
          event_exhibitor_id?: string | null
          event_id: string
          id?: string
          note?: string | null
          note_en?: string | null
          sort_order?: number
        }
        Update: {
          area?: string | null
          area_en?: string | null
          booth?: string | null
          brand_id?: string
          created_at?: string
          event_exhibitor_id?: string | null
          event_id?: string
          id?: string
          note?: string | null
          note_en?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_brands_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_brands_event_exhibitor_event_fkey"
            columns: ["event_id", "event_exhibitor_id"]
            isOneToOne: false
            referencedRelation: "event_exhibitors"
            referencedColumns: ["event_id", "id"]
          },
          {
            foreignKeyName: "event_brands_event_exhibitor_id_fkey"
            columns: ["event_exhibitor_id"]
            isOneToOne: false
            referencedRelation: "event_exhibitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_brands_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_exhibitors: {
        Row: {
          area: string | null
          area_en: string | null
          booth: string | null
          content_source: string | null
          content_submission_id: string | null
          content_verified_at: string | null
          created_at: string
          event_category: string
          event_id: string
          id: string
          image_storage_path: string | null
          image_url: string | null
          name: string
          name_en: string | null
          sort_order: number
          source_key: string
          source_url: string
          summary_en: string | null
          summary_zh: string | null
          updated_at: string
          verified_at: string
          website_url: string | null
          zone: string | null
        }
        Insert: {
          area?: string | null
          area_en?: string | null
          booth?: string | null
          content_source?: string | null
          content_submission_id?: string | null
          content_verified_at?: string | null
          created_at?: string
          event_category: string
          event_id: string
          id?: string
          image_storage_path?: string | null
          image_url?: string | null
          name: string
          name_en?: string | null
          sort_order?: number
          source_key: string
          source_url: string
          summary_en?: string | null
          summary_zh?: string | null
          updated_at?: string
          verified_at: string
          website_url?: string | null
          zone?: string | null
        }
        Update: {
          area?: string | null
          area_en?: string | null
          booth?: string | null
          content_source?: string | null
          content_submission_id?: string | null
          content_verified_at?: string | null
          created_at?: string
          event_category?: string
          event_id?: string
          id?: string
          image_storage_path?: string | null
          image_url?: string | null
          name?: string
          name_en?: string | null
          sort_order?: number
          source_key?: string
          source_url?: string
          summary_en?: string | null
          summary_zh?: string | null
          updated_at?: string
          verified_at?: string
          website_url?: string | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_exhibitors_content_submission_id_fkey"
            columns: ["content_submission_id"]
            isOneToOne: false
            referencedRelation: "brand_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_exhibitors_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          admission_note: string | null
          admission_note_en: string | null
          city: string | null
          created_at: string
          description: string | null
          description_en: string | null
          ends_on: string
          hero_image_storage_path: string | null
          hero_image_url: string | null
          id: string
          is_free: boolean | null
          lineup_note: string | null
          lineup_note_en: string | null
          name: string
          name_en: string | null
          official_url: string | null
          organizer_name: string | null
          schedule_note: string | null
          schedule_note_en: string | null
          slug: string
          starts_on: string
          status: string
          summary: string
          summary_en: string | null
          ticket_url: string | null
          travel_note: string | null
          travel_note_en: string | null
          updated_at: string
          venue_address: string | null
          venue_name: string | null
          venue_name_en: string | null
        }
        Insert: {
          admission_note?: string | null
          admission_note_en?: string | null
          city?: string | null
          created_at?: string
          description?: string | null
          description_en?: string | null
          ends_on: string
          hero_image_storage_path?: string | null
          hero_image_url?: string | null
          id?: string
          is_free?: boolean | null
          lineup_note?: string | null
          lineup_note_en?: string | null
          name: string
          name_en?: string | null
          official_url?: string | null
          organizer_name?: string | null
          schedule_note?: string | null
          schedule_note_en?: string | null
          slug: string
          starts_on: string
          status?: string
          summary: string
          summary_en?: string | null
          ticket_url?: string | null
          travel_note?: string | null
          travel_note_en?: string | null
          updated_at?: string
          venue_address?: string | null
          venue_name?: string | null
          venue_name_en?: string | null
        }
        Update: {
          admission_note?: string | null
          admission_note_en?: string | null
          city?: string | null
          created_at?: string
          description?: string | null
          description_en?: string | null
          ends_on?: string
          hero_image_storage_path?: string | null
          hero_image_url?: string | null
          id?: string
          is_free?: boolean | null
          lineup_note?: string | null
          lineup_note_en?: string | null
          name?: string
          name_en?: string | null
          official_url?: string | null
          organizer_name?: string | null
          schedule_note?: string | null
          schedule_note_en?: string | null
          slug?: string
          starts_on?: string
          status?: string
          summary?: string
          summary_en?: string | null
          ticket_url?: string | null
          travel_note?: string | null
          travel_note_en?: string | null
          updated_at?: string
          venue_address?: string | null
          venue_name?: string | null
          venue_name_en?: string | null
        }
        Relationships: []
      }
      external_call_audit: {
        Row: {
          causation_id: string | null
          completion_tokens: number | null
          correlation_id: string
          cost_usd: number | null
          created_at: string
          error_message: string | null
          id: string
          job_id: string | null
          kind: string
          latency_ms: number | null
          operation: string
          prompt_tokens: number | null
          provider: string
          retry_attempt: number | null
          span_id: string
          status: string
          subject_id: string | null
          summary: Json | null
        }
        Insert: {
          causation_id?: string | null
          completion_tokens?: number | null
          correlation_id: string
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_id?: string | null
          kind: string
          latency_ms?: number | null
          operation: string
          prompt_tokens?: number | null
          provider: string
          retry_attempt?: number | null
          span_id: string
          status: string
          subject_id?: string | null
          summary?: Json | null
        }
        Update: {
          causation_id?: string | null
          completion_tokens?: number | null
          correlation_id?: string
          cost_usd?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_id?: string | null
          kind?: string
          latency_ms?: number | null
          operation?: string
          prompt_tokens?: number | null
          provider?: string
          retry_attempt?: number | null
          span_id?: string
          status?: string
          subject_id?: string | null
          summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "external_call_audit_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "curation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      health_agent_run_ledger: {
        Row: {
          claimed_at: string
          completed_at: string | null
          created_at: string
          dry_run: boolean
          error: string | null
          id: string
          logical_date: string
          requested_run_id: string
          result: Json | null
          routine: string
          status: string
          updated_at: string
          workflow_attempt: number
        }
        Insert: {
          claimed_at?: string
          completed_at?: string | null
          created_at?: string
          dry_run?: boolean
          error?: string | null
          id?: string
          logical_date: string
          requested_run_id: string
          result?: Json | null
          routine: string
          status?: string
          updated_at?: string
          workflow_attempt: number
        }
        Update: {
          claimed_at?: string
          completed_at?: string | null
          created_at?: string
          dry_run?: boolean
          error?: string | null
          id?: string
          logical_date?: string
          requested_run_id?: string
          result?: Json | null
          routine?: string
          status?: string
          updated_at?: string
          workflow_attempt?: number
        }
        Relationships: []
      }
      health_fix_queue: {
        Row: {
          attempt_count: number
          attempted_at: string | null
          confirmation_data: Json | null
          created_at: string
          deployed_at: string | null
          evidence: Json
          fingerprint: string
          fixed_at: string | null
          id: string
          key_frames: Json | null
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          linear_identifier: string | null
          merge_policy: string
          merge_sha: string | null
          next_attempt_at: string | null
          pr_number: number | null
          pr_url: string | null
          recommended_action: string | null
          seer_root_cause: string | null
          sentry_issue_id: string | null
          source: string
          status: string
          ticketed_at: string | null
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          attempt_count?: number
          attempted_at?: string | null
          confirmation_data?: Json | null
          created_at?: string
          deployed_at?: string | null
          evidence?: Json
          fingerprint: string
          fixed_at?: string | null
          id?: string
          key_frames?: Json | null
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          linear_identifier?: string | null
          merge_policy?: string
          merge_sha?: string | null
          next_attempt_at?: string | null
          pr_number?: number | null
          pr_url?: string | null
          recommended_action?: string | null
          seer_root_cause?: string | null
          sentry_issue_id?: string | null
          source: string
          status?: string
          ticketed_at?: string | null
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          attempt_count?: number
          attempted_at?: string | null
          confirmation_data?: Json | null
          created_at?: string
          deployed_at?: string | null
          evidence?: Json
          fingerprint?: string
          fixed_at?: string | null
          id?: string
          key_frames?: Json | null
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          linear_identifier?: string | null
          merge_policy?: string
          merge_sha?: string | null
          next_attempt_at?: string | null
          pr_number?: number | null
          pr_url?: string | null
          recommended_action?: string | null
          seer_root_cause?: string | null
          sentry_issue_id?: string | null
          source?: string
          status?: string
          ticketed_at?: string | null
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      health_snapshots: {
        Row: {
          created_at: string
          id: string
          metrics: Json
          snapshot_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metrics: Json
          snapshot_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metrics?: Json
          snapshot_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      link_check_results: {
        Row: {
          auto_nulled_at: string | null
          brand_id: string
          cleanup_required: boolean
          cleanup_required_at: string | null
          consecutive_failures: number
          created_at: string
          distinct_failure_days: number
          failure_dates: string[]
          failure_reason: string | null
          field: string
          id: string
          last_checked_at: string | null
          last_ok_at: string | null
          last_status_code: number | null
          updated_at: string
          url: string
        }
        Insert: {
          auto_nulled_at?: string | null
          brand_id: string
          cleanup_required?: boolean
          cleanup_required_at?: string | null
          consecutive_failures?: number
          created_at?: string
          distinct_failure_days?: number
          failure_dates?: string[]
          failure_reason?: string | null
          field: string
          id?: string
          last_checked_at?: string | null
          last_ok_at?: string | null
          last_status_code?: number | null
          updated_at?: string
          url: string
        }
        Update: {
          auto_nulled_at?: string | null
          brand_id?: string
          cleanup_required?: boolean
          cleanup_required_at?: string | null
          consecutive_failures?: number
          created_at?: string
          distinct_failure_days?: number
          failure_dates?: string[]
          failure_reason?: string | null
          field?: string
          id?: string
          last_checked_at?: string | null
          last_ok_at?: string | null
          last_status_code?: number | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_check_results_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_model_prices: {
        Row: {
          cached_input_per_m: number
          created_at: string
          effective_from: string
          id: string
          input_per_m: number
          model: string
          output_per_m: number
          source: string | null
        }
        Insert: {
          cached_input_per_m: number
          created_at?: string
          effective_from?: string
          id?: string
          input_per_m: number
          model: string
          output_per_m: number
          source?: string | null
        }
        Update: {
          cached_input_per_m?: number
          created_at?: string
          effective_from?: string
          id?: string
          input_per_m?: number
          model?: string
          output_per_m?: number
          source?: string | null
        }
        Relationships: []
      }
      mit_registry: {
        Row: {
          brand_name: string | null
          cert_number: string
          company_name: string | null
          id: number
          industry_type: string | null
          normalized_brand: string
          normalized_model: string
          normalized_product: string
          product_model: string | null
          product_name: string | null
          record_key: string
          synced_at: string
          valid_until: string | null
        }
        Insert: {
          brand_name?: string | null
          cert_number: string
          company_name?: string | null
          id?: number
          industry_type?: string | null
          normalized_brand: string
          normalized_model: string
          normalized_product: string
          product_model?: string | null
          product_name?: string | null
          record_key: string
          synced_at?: string
          valid_until?: string | null
        }
        Update: {
          brand_name?: string | null
          cert_number?: string
          company_name?: string | null
          id?: number
          industry_type?: string | null
          normalized_brand?: string
          normalized_model?: string
          normalized_product?: string
          product_model?: string | null
          product_name?: string | null
          record_key?: string
          synced_at?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      moderation_flags: {
        Row: {
          brand_id: string
          created_at: string
          field_name: string
          flag_reason: string
          flagged_content: string
          id: string
          previous_content: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          status: string
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          field_name: string
          flag_reason: string
          flagged_content: string
          id?: string
          previous_content?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          field_name?: string
          flag_reason?: string
          flagged_content?: string
          id?: string
          previous_content?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_flags_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_subscribers: {
        Row: {
          confirm_token: string
          confirmed_at: string | null
          consent_recorded_at: string | null
          consent_source: string | null
          consent_version: string | null
          created_at: string
          email: string
          id: string
          interests: string[] | null
          locale: string
          name: string | null
          subscribed_at: string
          unsubscribe_token: string
          unsubscribed_at: string | null
        }
        Insert: {
          confirm_token?: string
          confirmed_at?: string | null
          consent_recorded_at?: string | null
          consent_source?: string | null
          consent_version?: string | null
          created_at?: string
          email: string
          id?: string
          interests?: string[] | null
          locale?: string
          name?: string | null
          subscribed_at?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
        }
        Update: {
          confirm_token?: string
          confirmed_at?: string | null
          consent_recorded_at?: string | null
          consent_source?: string | null
          consent_version?: string | null
          created_at?: string
          email?: string
          id?: string
          interests?: string[] | null
          locale?: string
          name?: string | null
          subscribed_at?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
        }
        Relationships: []
      }
      owner_email_preferences: {
        Row: {
          consent_source: string | null
          consent_version: string | null
          created_at: string
          lifecycle_opted_in_at: string | null
          unsubscribe_token: string
          unsubscribed_at: string | null
          user_id: string
        }
        Insert: {
          consent_source?: string | null
          consent_version?: string | null
          created_at?: string
          lifecycle_opted_in_at?: string | null
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          user_id: string
        }
        Update: {
          consent_source?: string | null
          consent_version?: string | null
          created_at?: string
          lifecycle_opted_in_at?: string | null
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ownership_revocations: {
        Row: {
          brand_id: string
          id: string
          reason: string
          revoked_at: string
          revoked_by: string
          revoked_user_email: string
          revoked_user_id: string | null
        }
        Insert: {
          brand_id: string
          id?: string
          reason: string
          revoked_at?: string
          revoked_by: string
          revoked_user_email: string
          revoked_user_id?: string | null
        }
        Update: {
          brand_id?: string
          id?: string
          reason?: string
          revoked_at?: string
          revoked_by?: string
          revoked_user_email?: string
          revoked_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ownership_revocations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_brand_edits: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          proposed_data: Json
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          status: string
          submitted_by: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          proposed_data: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          submitted_by: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          proposed_data?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          status?: string
          submitted_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_brand_edits_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          locale_preference: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          locale_preference?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          locale_preference?: string
          updated_at?: string
        }
        Relationships: []
      }
      staging_auth_email_captures: {
        Row: {
          action: string
          created_at: string
          id: string
          recipient: string
          redirect_to: string
          token_hash: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          recipient: string
          redirect_to: string
          token_hash: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          recipient?: string
          redirect_to?: string
          token_hash?: string
        }
        Relationships: []
      }
      subcategory_label_map: {
        Row: {
          disposition: string
          label_key: string
          target_slug: string | null
        }
        Insert: {
          disposition: string
          label_key: string
          target_slug?: string | null
        }
        Update: {
          disposition?: string
          label_key?: string
          target_slug?: string | null
        }
        Relationships: []
      }
      submission_images: {
        Row: {
          alt_zh: string | null
          created_at: string
          dominant_color: string | null
          entropy: number | null
          height: number | null
          id: string
          origin_brand_image_id: string | null
          phash: string | null
          provider_metadata: Json | null
          rejected_at: string | null
          rejection_reasons: string[] | null
          score: number | null
          sharpness: number | null
          sort_order: number
          source: string
          source_url: string | null
          status: string
          storage_path: string | null
          submission_id: string
          tags: string[] | null
          url: string
          width: number | null
        }
        Insert: {
          alt_zh?: string | null
          created_at?: string
          dominant_color?: string | null
          entropy?: number | null
          height?: number | null
          id?: string
          origin_brand_image_id?: string | null
          phash?: string | null
          provider_metadata?: Json | null
          rejected_at?: string | null
          rejection_reasons?: string[] | null
          score?: number | null
          sharpness?: number | null
          sort_order?: number
          source: string
          source_url?: string | null
          status?: string
          storage_path?: string | null
          submission_id: string
          tags?: string[] | null
          url?: string
          width?: number | null
        }
        Update: {
          alt_zh?: string | null
          created_at?: string
          dominant_color?: string | null
          entropy?: number | null
          height?: number | null
          id?: string
          origin_brand_image_id?: string | null
          phash?: string | null
          provider_metadata?: Json | null
          rejected_at?: string | null
          rejection_reasons?: string[] | null
          score?: number | null
          sharpness?: number | null
          sort_order?: number
          source?: string
          source_url?: string | null
          status?: string
          storage_path?: string | null
          submission_id?: string
          tags?: string[] | null
          url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "submission_images_origin_brand_image_id_fkey"
            columns: ["origin_brand_image_id"]
            isOneToOne: false
            referencedRelation: "brand_image_provenance"
            referencedColumns: ["image_id"]
          },
          {
            foreignKeyName: "submission_images_origin_brand_image_id_fkey"
            columns: ["origin_brand_image_id"]
            isOneToOne: false
            referencedRelation: "brand_images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_images_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "brand_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      taxonomy_terms: {
        Row: {
          axis: string
          name_en: string
          name_zh: string
          slug: string
        }
        Insert: {
          axis: string
          name_en: string
          name_zh: string
          slug: string
        }
        Update: {
          axis?: string
          name_en?: string
          name_zh?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      brand_image_provenance: {
        Row: {
          brand_name: string | null
          brand_slug: string | null
          created_at: string | null
          height: number | null
          image_id: string | null
          method: string | null
          rejection_reasons: string[] | null
          score: number | null
          search_query: string | null
          source: string | null
          source_page: string | null
          source_url: string | null
          status: string | null
          tags: string[] | null
          width: number | null
        }
        Relationships: []
      }
      external_call_audit_spans: {
        Row: {
          causation_id: string | null
          correlation_id: string | null
          error_message: string | null
          finished_at: string | null
          job_id: string | null
          kind: string | null
          latency_ms: number | null
          operation: string | null
          provider: string | null
          retry_attempt: number | null
          span_id: string | null
          started_at: string | null
          subject_id: string | null
          summary: Json | null
          terminal_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_call_audit_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "curation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_export_newsletter_subscribers: {
        Args: { p_interest?: string; p_query?: string; p_status?: string }
        Returns: Json
      }
      admin_list_newsletter_subscribers: {
        Args: {
          p_cursor_at?: string
          p_cursor_id?: string
          p_direction?: string
          p_interest?: string
          p_limit?: number
          p_query?: string
          p_status?: string
        }
        Returns: {
          confirmed_at: string
          consent_recorded_at: string
          consent_source: string
          consent_version: string
          email: string
          id: string
          interests: string[]
          locale: string
          name: string
          subscribed_at: string
          subscriber_status: string
          total_count: number
          unsubscribed_at: string
        }[]
      }
      apply_brand_patch: {
        Args: {
          p_actor: string
          p_brand_id: string
          p_job_id: string
          p_patch: Json
          p_source: string
        }
        Returns: undefined
      }
      apply_brand_refresh: {
        Args: { p_reviewer_id: string; p_submission_id: string }
        Returns: string[]
      }
      apply_brand_refresh_with_protected_location_gate: {
        Args: { p_reviewer_id: string; p_submission_id: string }
        Returns: string[]
      }
      apply_founding_fact_audit_patch: {
        Args: {
          p_actor: string
          p_allow_protected?: boolean
          p_brand_id: string
          p_expected: Json
          p_expected_protection: Json
          p_patch: Json
          p_source: string
        }
        Returns: boolean
      }
      apply_submission_enrichment_result: {
        Args: {
          p_enriched_data: Json
          p_job_id: string
          p_submission_id: string
        }
        Returns: boolean
      }
      approve_claim_request: {
        Args: { p_claim_id: string; p_reviewer_id: string }
        Returns: undefined
      }
      approve_submission: {
        Args: {
          p_brand_data: Json
          p_reviewer_id: string
          p_submission_id: string
        }
        Returns: {
          brand_id: string
          brand_name: string
          is_brand_owner: boolean
          submitter_email: string
          submitter_name: string
          suggested_tags: Json
        }[]
      }
      approve_submission_with_romanized_name: {
        Args: {
          p_brand_data: Json
          p_reviewer_id: string
          p_submission_id: string
        }
        Returns: {
          brand_id: string
          brand_name: string
          is_brand_owner: boolean
          submitter_email: string
          submitter_name: string
          suggested_tags: Json
        }[]
      }
      brand_search_tsquery: {
        Args: { input: string; prefix_mode?: boolean }
        Returns: unknown
      }
      brand_trgm_rank: {
        Args: {
          p_blurb_en: string
          p_category: string
          p_description: string
          p_name: string
          p_query: string
          p_slug: string
          p_subcategories: string[]
          p_subcategories_en: string[]
        }
        Returns: number
      }
      brands_search_document: {
        Args: {
          p_blurb_en: string
          p_category: string
          p_description: string
          p_name: string
          p_slug: string
          p_subcategories: string[]
          p_subcategories_en: string[]
        }
        Returns: unknown
      }
      cancel_curation_job: {
        Args: { p_job_id: string; p_reason: string }
        Returns: {
          attempt: number
          cancelled_count: number
          completed_at: string | null
          created_at: string | null
          current_phase: string | null
          current_target_id: string | null
          dedupe_key: string | null
          dispatch_error: string | null
          dispatch_status: string
          dispatched_at: string | null
          dry_run: boolean
          failed_count: number
          heartbeat_at: string | null
          id: string
          job_error: string | null
          operation: string
          params: Json | null
          parent_job_id: string | null
          progress: Json | null
          result: Json | null
          run_after: string
          scheduled_for: string | null
          skipped_count: number
          started_at: string | null
          started_by: string
          status: string
          succeeded_count: number
          target_total: number
          trigger: string
          worker_token: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "curation_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      canonicalize_subcategory_slugs: {
        Args: { p_subcategories: string[]; p_subcategories_en: string[] }
        Returns: string[]
      }
      check_brand_duplicates: {
        Args: { p_name: string; p_ubn?: string; p_website_key?: string }
        Returns: Json
      }
      cjk_bigrams: { Args: { input: string }; Returns: string }
      cjk_bigrams_bridged: { Args: { input: string }; Returns: string }
      claim_claim_proof_cleanup_jobs: {
        Args: {
          p_claim_request_id?: string
          p_lease_token: string
          p_limit?: number
        }
        Returns: {
          job_id: string
          storage_key: string
        }[]
      }
      claim_curation_job: {
        Args: { p_job_id: string; p_worker_token: string }
        Returns: {
          attempt: number
          cancelled_count: number
          completed_at: string | null
          created_at: string | null
          current_phase: string | null
          current_target_id: string | null
          dedupe_key: string | null
          dispatch_error: string | null
          dispatch_status: string
          dispatched_at: string | null
          dry_run: boolean
          failed_count: number
          heartbeat_at: string | null
          id: string
          job_error: string | null
          operation: string
          params: Json | null
          parent_job_id: string | null
          progress: Json | null
          result: Json | null
          run_after: string
          scheduled_for: string | null
          skipped_count: number
          started_at: string | null
          started_by: string
          status: string
          succeeded_count: number
          target_total: number
          trigger: string
          worker_token: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "curation_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_health_agent_run: {
        Args: {
          p_dry_run?: boolean
          p_logical_date: string
          p_requested_run_id: string
          p_routine: string
          p_workflow_attempt: number
        }
        Returns: Json
      }
      claim_health_fixes: {
        Args: {
          p_fingerprints: string[]
          p_lease_duration?: string
          p_lease_owner: string
          p_merge_policy: string
        }
        Returns: {
          attempt_count: number
          attempted_at: string | null
          confirmation_data: Json | null
          created_at: string
          deployed_at: string | null
          evidence: Json
          fingerprint: string
          fixed_at: string | null
          id: string
          key_frames: Json | null
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          linear_identifier: string | null
          merge_policy: string
          merge_sha: string | null
          next_attempt_at: string | null
          pr_number: number | null
          pr_url: string | null
          recommended_action: string | null
          seer_root_cause: string | null
          sentry_issue_id: string | null
          source: string
          status: string
          ticketed_at: string | null
          title: string
          updated_at: string
          url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "health_fix_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_next_curation_job: {
        Args: { p_worker_token: string }
        Returns: {
          attempt: number
          cancelled_count: number
          completed_at: string | null
          created_at: string | null
          current_phase: string | null
          current_target_id: string | null
          dedupe_key: string | null
          dispatch_error: string | null
          dispatch_status: string
          dispatched_at: string | null
          dry_run: boolean
          failed_count: number
          heartbeat_at: string | null
          id: string
          job_error: string | null
          operation: string
          params: Json | null
          parent_job_id: string | null
          progress: Json | null
          result: Json | null
          run_after: string
          scheduled_for: string | null
          skipped_count: number
          started_at: string | null
          started_by: string
          status: string
          succeeded_count: number
          target_total: number
          trigger: string
          worker_token: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "curation_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_claim_proof_cleanup_jobs: {
        Args: { p_job_ids: string[]; p_lease_token: string }
        Returns: undefined
      }
      complete_health_agent_run: {
        Args: {
          p_logical_date: string
          p_requested_run_id: string
          p_result: Json
          p_routine: string
          p_workflow_attempt: number
        }
        Returns: boolean
      }
      dev1648_aligned_subcategory_labels: {
        Args: { p_existing_labels: string[]; p_slugs: string[] }
        Returns: string[]
      }
      dev1648_l2_order: { Args: never; Returns: string[] }
      dev1648_l2_ordinal: { Args: { p_slug: string }; Returns: number }
      dev1648_release_brand_product_subcategory: {
        Args: { p_brand_id: string; p_subcategory: string }
        Returns: undefined
      }
      drop_needs_data_submissions: {
        Args: { p_submission_ids: string[] }
        Returns: string[]
      }
      enqueue_abandoned_claim_proof_cleanup_jobs: {
        Args: never
        Returns: number
      }
      enqueue_curation_job: {
        Args: {
          p_attempt: number
          p_dedupe_key: string
          p_dry_run: boolean
          p_operation: string
          p_params: Json
          p_parent_job_id: string
          p_run_after: string
          p_scheduled_for: string
          p_started_by: string
          p_targets: Json
          p_trigger: string
        }
        Returns: string
      }
      enqueue_health_fix: {
        Args: {
          p_evidence: Json
          p_fingerprint: string
          p_merge_policy: string
          p_sentry_issue_id?: string
          p_source: string
          p_title: string
          p_url?: string
        }
        Returns: string
      }
      fail_claim_proof_cleanup_jobs: {
        Args: { p_error: string; p_job_ids: string[]; p_lease_token: string }
        Returns: undefined
      }
      fail_health_agent_run: {
        Args: {
          p_error: string
          p_logical_date: string
          p_requested_run_id: string
          p_result?: Json
          p_routine: string
          p_workflow_attempt: number
        }
        Returns: boolean
      }
      find_similar_brands: {
        Args: { p_names: string[]; p_threshold?: number }
        Returns: {
          brand_name: string
          brand_slug: string
          input_name: string
          similarity_score: number
        }[]
      }
      get_brand_quality_metrics: {
        Args: never
        Returns: {
          avg_description_length: number
          completeness_excellent: number
          completeness_fair: number
          completeness_good: number
          completeness_poor: number
          description_count: number
          hero_image_count: number
          purchase_myship_count: number
          purchase_pinkoi_count: number
          purchase_shopee_count: number
          purchase_website_count: number
          social_facebook_count: number
          social_instagram_count: number
          social_threads_count: number
          total_brands: number
        }[]
      }
      increment_crawler_hits: { Args: { p_rows: Json }; Returns: undefined }
      mark_unreported_curation_job_targets_skipped: {
        Args: { p_job_id: string; p_worker_token: string }
        Returns: boolean
      }
      persist_curation_job_target_progress: {
        Args: {
          p_current_phase?: string
          p_current_target_id?: string
          p_job_id: string
          p_updates: Json
          p_worker_token: string
        }
        Returns: boolean
      }
      purchase_channel_sql_surface: { Args: never; Returns: Json }
      read_health_directory_database_evidence: { Args: never; Returns: Json }
      rearm_health_fix_canary: {
        Args: { p_fingerprint: string }
        Returns: {
          attempt_count: number
          attempted_at: string | null
          confirmation_data: Json | null
          created_at: string
          deployed_at: string | null
          evidence: Json
          fingerprint: string
          fixed_at: string | null
          id: string
          key_frames: Json | null
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          linear_identifier: string | null
          merge_policy: string
          merge_sha: string | null
          next_attempt_at: string | null
          pr_number: number | null
          pr_url: string | null
          recommended_action: string | null
          seer_root_cause: string | null
          sentry_issue_id: string | null
          source: string
          status: string
          ticketed_at: string | null
          title: string
          updated_at: string
          url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "health_fix_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reconcile_health_fix_lifecycle: {
        Args: {
          p_completed_sources: string[]
          p_observed_fingerprints: string[]
        }
        Returns: {
          current_status: string
          fingerprint: string
          id: string
          reconciliation: string
          sentry_issue_id: string
        }[]
      }
      record_health_snapshot: {
        Args: { p_metrics: Json; p_snapshot_date: string }
        Returns: {
          created_at: string
          id: string
          metrics: Json
          snapshot_date: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "health_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_link_health_result: {
        Args: {
          p_brand_id: string
          p_checked_at?: string
          p_field: string
          p_status_code: number
          p_url: string
        }
        Returns: {
          auto_nulled_at: string | null
          brand_id: string
          cleanup_required: boolean
          cleanup_required_at: string | null
          consecutive_failures: number
          created_at: string
          distinct_failure_days: number
          failure_dates: string[]
          failure_reason: string | null
          field: string
          id: string
          last_checked_at: string | null
          last_ok_at: string | null
          last_status_code: number | null
          updated_at: string
          url: string
        }
        SetofOptions: {
          from: "*"
          to: "link_check_results"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recount_brand_model_faq: {
        Args: { target_brand_id: string }
        Returns: undefined
      }
      recover_stale_curation_jobs: {
        Args: { p_stale_before: string }
        Returns: {
          attempt: number
          cancelled_count: number
          completed_at: string | null
          created_at: string | null
          current_phase: string | null
          current_target_id: string | null
          dedupe_key: string | null
          dispatch_error: string | null
          dispatch_status: string
          dispatched_at: string | null
          dry_run: boolean
          failed_count: number
          heartbeat_at: string | null
          id: string
          job_error: string | null
          operation: string
          params: Json | null
          parent_job_id: string | null
          progress: Json | null
          result: Json | null
          run_after: string
          scheduled_for: string | null
          skipped_count: number
          started_at: string | null
          started_by: string
          status: string
          succeeded_count: number
          target_total: number
          trigger: string
          worker_token: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "curation_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reject_submission: {
        Args: {
          p_denial_reason: string
          p_reviewer_id: string
          p_reviewer_notes: string
          p_submission_id: string
        }
        Returns: string[]
      }
      release_health_fix_claims: {
        Args: { p_lease_owner: string }
        Returns: {
          attempt_count: number
          attempted_at: string | null
          confirmation_data: Json | null
          created_at: string
          deployed_at: string | null
          evidence: Json
          fingerprint: string
          fixed_at: string | null
          id: string
          key_frames: Json | null
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          linear_identifier: string | null
          merge_policy: string
          merge_sha: string | null
          next_attempt_at: string | null
          pr_number: number | null
          pr_url: string | null
          recommended_action: string | null
          seer_root_cause: string | null
          sentry_issue_id: string | null
          source: string
          status: string
          ticketed_at: string | null
          title: string
          updated_at: string
          url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "health_fix_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      request_brand_refresh: {
        Args: {
          p_brand_id: string
          p_requested_by: string
          p_requester_email: string
        }
        Returns: string
      }
      revoke_brand_ownership: {
        Args: { p_brand_id: string; p_reason: string; p_revoked_by: string }
        Returns: {
          revoked_user_email: string
          revoked_user_id: string
        }[]
      }
      save_submission_review: {
        Args: { p_images: Json; p_review_data: Json; p_submission_id: string }
        Returns: undefined
      }
      search_brand_page: {
        Args: {
          filter_categories?: string[]
          filter_materials?: string[]
          filter_subcategories?: string[]
          filter_verification?: string
          page_offset?: number
          search_query: string
          sort_mode?: string
        }
        Returns: {
          id: string
          rank_score: number
          search_source: string
          total_count: number
        }[]
      }
      search_brands: {
        Args: {
          filter_categories?: string[]
          filter_materials?: string[]
          filter_status?: string
          filter_subcategories?: string[]
          filter_verification?: string
          include_test_brands?: boolean
          prefix_mode?: boolean
          result_limit?: number
          search_query: string
        }
        Returns: {
          hero_image_url: string
          id: string
          name: string
          primary_category_name: string
          rank_score: number
          search_source: string
          slug: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      staging_capture_auth_email: { Args: { event: Json }; Returns: Json }
      subcategory_json_to_slugs: { Args: { p_value: Json }; Returns: Json }
      subcategory_label_key: { Args: { p_label: string }; Returns: string }
      subcategory_labels_to_slugs: {
        Args: { p_labels: string[] }
        Returns: string[]
      }
      subcategory_slugs_to_names_en: {
        Args: { p_slugs: string[] }
        Returns: string[]
      }
      taxonomy_expand_subcategories: {
        Args: { p_values: string[] }
        Returns: string[]
      }
      transition_health_fix: {
        Args: {
          p_confirmation_data?: Json
          p_deployed_at?: string
          p_expected_status: string
          p_id: string
          p_last_error?: string
          p_lease_owner?: string
          p_merge_sha?: string
          p_new_status: string
          p_next_attempt_at?: string
          p_pr_number?: number
          p_pr_url?: string
        }
        Returns: {
          attempt_count: number
          attempted_at: string | null
          confirmation_data: Json | null
          created_at: string
          deployed_at: string | null
          evidence: Json
          fingerprint: string
          fixed_at: string | null
          id: string
          key_frames: Json | null
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          linear_identifier: string | null
          merge_policy: string
          merge_sha: string | null
          next_attempt_at: string | null
          pr_number: number | null
          pr_url: string | null
          recommended_action: string | null
          seer_root_cause: string | null
          sentry_issue_id: string | null
          source: string
          status: string
          ticketed_at: string | null
          title: string
          updated_at: string
          url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "health_fix_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_brand_channel_districts: {
        Args: { p_updates: Json }
        Returns: number
      }
      upsert_enriched_brand_channels: {
        Args: { p_brand_id: string; p_candidates: Json }
        Returns: number
      }
      verify_health_fix_absence: {
        Args: { p_expected_status: string; p_id: string }
        Returns: {
          attempt_count: number
          attempted_at: string | null
          confirmation_data: Json | null
          created_at: string
          deployed_at: string | null
          evidence: Json
          fingerprint: string
          fixed_at: string | null
          id: string
          key_frames: Json | null
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          linear_identifier: string | null
          merge_policy: string
          merge_sha: string | null
          next_attempt_at: string | null
          pr_number: number | null
          pr_url: string | null
          recommended_action: string | null
          seer_root_cause: string | null
          sentry_issue_id: string | null
          source: string
          status: string
          ticketed_at: string | null
          title: string
          updated_at: string
          url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "health_fix_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
