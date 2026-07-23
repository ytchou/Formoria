export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string;
          admin_email: string;
          admin_user_id: string;
          created_at: string;
          id: string;
          metadata: Json | null;
          target_brand_id: string | null;
          target_brand_slug: string | null;
        };
        Insert: {
          action: string;
          admin_email: string;
          admin_user_id: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          target_brand_id?: string | null;
          target_brand_slug?: string | null;
        };
        Update: {
          action?: string;
          admin_email?: string;
          admin_user_id?: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          target_brand_id?: string | null;
          target_brand_slug?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_target_brand_id_fkey";
            columns: ["target_brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      app_secrets: {
        Row: {
          key: string;
          value: string;
        };
        Insert: {
          key: string;
          value: string;
        };
        Update: {
          key?: string;
          value?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          updated_at: string;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [];
      };
      batch_processing_log: {
        Row: {
          duration_ms: number | null;
          errors: Json | null;
          id: string;
          notified: number;
          run_at: string | null;
          triggered_by: string | null;
          validated: number;
        };
        Insert: {
          duration_ms?: number | null;
          errors?: Json | null;
          id?: string;
          notified?: number;
          run_at?: string | null;
          triggered_by?: string | null;
          validated?: number;
        };
        Update: {
          duration_ms?: number | null;
          errors?: Json | null;
          id?: string;
          notified?: number;
          run_at?: string | null;
          triggered_by?: string | null;
          validated?: number;
        };
        Relationships: [];
      };
      brand_ai_results: {
        Row: {
          attempt: number | null;
          brand_id: string | null;
          confidence: string | null;
          config: Json | null;
          created_at: string;
          description: string | null;
          id: string;
          input: Json | null;
          is_non_brand: boolean | null;
          job_id: string | null;
          latency_ms: number | null;
          model: string;
          non_brand_reason: string | null;
          phase: string;
          price_range: number | null;
          product_tags: string[] | null;
          product_type: string | null;
          raw_response: Json | null;
          slug_generated: string | null;
          submission_id: string | null;
        };
        Insert: {
          attempt?: number | null;
          brand_id?: string | null;
          confidence?: string | null;
          config?: Json | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          input?: Json | null;
          is_non_brand?: boolean | null;
          job_id?: string | null;
          latency_ms?: number | null;
          model: string;
          non_brand_reason?: string | null;
          phase: string;
          price_range?: number | null;
          product_tags?: string[] | null;
          product_type?: string | null;
          raw_response?: Json | null;
          slug_generated?: string | null;
          submission_id?: string | null;
        };
        Update: {
          attempt?: number | null;
          brand_id?: string | null;
          confidence?: string | null;
          config?: Json | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          input?: Json | null;
          is_non_brand?: boolean | null;
          job_id?: string | null;
          latency_ms?: number | null;
          model?: string;
          non_brand_reason?: string | null;
          phase?: string;
          price_range?: number | null;
          product_tags?: string[] | null;
          product_type?: string | null;
          raw_response?: Json | null;
          slug_generated?: string | null;
          submission_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "brand_ai_results_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brand_ai_results_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "curation_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brand_ai_results_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "brand_submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_faq: {
        Row: {
          brand_id: string;
          faq_custom_1: Json | null;
          faq_custom_2: Json | null;
          faq_custom_3: Json | null;
          faq_custom_4: Json | null;
          faq_founded: Json | null;
          faq_mit: Json | null;
          faq_price: Json | null;
          faq_products: Json | null;
          faq_reputation: Json | null;
          faq_where_to_buy: Json | null;
          updated_at: string | null;
        };
        Insert: {
          brand_id: string;
          faq_custom_1?: Json | null;
          faq_custom_2?: Json | null;
          faq_custom_3?: Json | null;
          faq_custom_4?: Json | null;
          faq_founded?: Json | null;
          faq_mit?: Json | null;
          faq_price?: Json | null;
          faq_products?: Json | null;
          faq_reputation?: Json | null;
          faq_where_to_buy?: Json | null;
          updated_at?: string | null;
        };
        Update: {
          brand_id?: string;
          faq_custom_1?: Json | null;
          faq_custom_2?: Json | null;
          faq_custom_3?: Json | null;
          faq_custom_4?: Json | null;
          faq_founded?: Json | null;
          faq_mit?: Json | null;
          faq_price?: Json | null;
          faq_products?: Json | null;
          faq_reputation?: Json | null;
          faq_where_to_buy?: Json | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "brand_faq_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: true;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_field_events: {
        Row: {
          actor: string | null;
          brand_id: string;
          created_at: string;
          field: string;
          id: number;
          job_id: string | null;
          new_value: Json | null;
          old_value: Json | null;
          source: string;
        };
        Insert: {
          actor?: string | null;
          brand_id: string;
          created_at?: string;
          field: string;
          id?: number;
          job_id?: string | null;
          new_value?: Json | null;
          old_value?: Json | null;
          source: string;
        };
        Update: {
          actor?: string | null;
          brand_id?: string;
          created_at?: string;
          field?: string;
          id?: number;
          job_id?: string | null;
          new_value?: Json | null;
          old_value?: Json | null;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brand_field_events_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brand_field_events_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "curation_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_field_state: {
        Row: {
          admin_locked: boolean;
          brand_id: string;
          field: string;
          source: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          admin_locked?: boolean;
          brand_id: string;
          field: string;
          source: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          admin_locked?: boolean;
          brand_id?: string;
          field?: string;
          source?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "brand_field_state_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_images: {
        Row: {
          alt_en: string | null;
          alt_zh: string | null;
          brand_id: string;
          created_at: string;
          dominant_color: string | null;
          height: number | null;
          id: string;
          phash: string | null;
          score: number | null;
          sort_order: number;
          source: string;
          source_url: string | null;
          status: string;
          storage_path: string | null;
          tags: string[] | null;
          url: string;
          width: number | null;
        };
        Insert: {
          alt_en?: string | null;
          alt_zh?: string | null;
          brand_id: string;
          created_at?: string;
          dominant_color?: string | null;
          height?: number | null;
          id?: string;
          phash?: string | null;
          score?: number | null;
          sort_order?: number;
          source: string;
          source_url?: string | null;
          status?: string;
          storage_path?: string | null;
          tags?: string[] | null;
          url: string;
          width?: number | null;
        };
        Update: {
          alt_en?: string | null;
          alt_zh?: string | null;
          brand_id?: string;
          created_at?: string;
          dominant_color?: string | null;
          height?: number | null;
          id?: string;
          phash?: string | null;
          score?: number | null;
          sort_order?: number;
          source?: string;
          source_url?: string | null;
          status?: string;
          storage_path?: string | null;
          tags?: string[] | null;
          url?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "brand_images_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_owners: {
        Row: {
          brand_id: string;
          claimed_at: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          brand_id: string;
          claimed_at?: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          brand_id?: string;
          claimed_at?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brand_owners_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: true;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_reports: {
        Row: {
          brand_id: string;
          created_at: string;
          id: string;
          notes: string | null;
          reason: string;
          reported_field: string | null;
          reviewed_at: string | null;
          status: string;
          user_id: string | null;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          reason: string;
          reported_field?: string | null;
          reviewed_at?: string | null;
          status?: string;
          user_id?: string | null;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          reason?: string;
          reported_field?: string | null;
          reviewed_at?: string | null;
          status?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "brand_reports_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_saves: {
        Row: {
          brand_id: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brand_saves_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_location_candidates: {
        Row: {
          audit_result_ids: string[];
          brand_id: string | null;
          created_at: string;
          evidence: Json;
          id: string;
          job_id: string | null;
          location: Json;
          match_reason: string;
          normalized_address: string | null;
          normalized_identity: string;
          submission_id: string | null;
          updated_at: string;
          verification_decision: string;
        };
        Insert: {
          audit_result_ids?: string[];
          brand_id?: string | null;
          created_at?: string;
          evidence?: Json;
          id?: string;
          job_id?: string | null;
          location: Json;
          match_reason: string;
          normalized_address?: string | null;
          normalized_identity: string;
          submission_id?: string | null;
          updated_at?: string;
          verification_decision: string;
        };
        Update: {
          audit_result_ids?: string[];
          brand_id?: string | null;
          created_at?: string;
          evidence?: Json;
          id?: string;
          job_id?: string | null;
          location?: Json;
          match_reason?: string;
          normalized_address?: string | null;
          normalized_identity?: string;
          submission_id?: string | null;
          updated_at?: string;
          verification_decision?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brand_location_candidates_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brand_location_candidates_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "curation_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brand_location_candidates_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "brand_submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_search_results: {
        Row: {
          brand_id: string | null;
          attempt: number;
          call_status: string;
          config: Json | null;
          created_at: string;
          endpoint: string | null;
          error: string | null;
          http_status: number | null;
          id: string;
          input: Json | null;
          job_id: string | null;
          latency_ms: number | null;
          provider: string;
          query: string;
          raw_response: Json | null;
          search_type: string;
          snippets: string[];
          submission_id: string | null;
          urls: string[];
        };
        Insert: {
          attempt?: number;
          brand_id?: string | null;
          call_status?: string;
          config?: Json | null;
          created_at?: string;
          endpoint?: string | null;
          error?: string | null;
          http_status?: number | null;
          id?: string;
          input?: Json | null;
          job_id?: string | null;
          latency_ms?: number | null;
          provider?: string;
          query: string;
          raw_response?: Json | null;
          search_type: string;
          snippets?: string[];
          submission_id?: string | null;
          urls?: string[];
        };
        Update: {
          attempt?: number;
          brand_id?: string | null;
          call_status?: string;
          config?: Json | null;
          created_at?: string;
          endpoint?: string | null;
          error?: string | null;
          http_status?: number | null;
          id?: string;
          input?: Json | null;
          job_id?: string | null;
          latency_ms?: number | null;
          provider?: string;
          query?: string;
          raw_response?: Json | null;
          search_type?: string;
          snippets?: string[];
          submission_id?: string | null;
          urls?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "brand_search_results_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brand_search_results_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "curation_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brand_search_results_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "brand_submissions";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_slug_redirects: {
        Row: {
          created_at: string;
          new_slug: string;
          old_slug: string;
        };
        Insert: {
          created_at?: string;
          new_slug: string;
          old_slug: string;
        };
        Update: {
          created_at?: string;
          new_slug?: string;
          old_slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brand_slug_redirects_new_slug_fkey";
            columns: ["new_slug"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["slug"];
          },
        ];
      };
      brand_submissions: {
        Row: {
          base_brand_data: Json | null;
          base_brand_updated_at: string | null;
          brand_id: string | null;
          brand_name: string;
          denial_reason: string | null;
          description: string | null;
          enriched_data: Json | null;
          hero_image_url: string | null;
          id: string;
          intent: string;
          is_brand_owner: boolean | null;
          notified_at: string | null;
          other_urls: Json;
          owner_data: Json | null;
          pdpa_consent_at: string | null;
          product_type_note: string | null;
          purchase_pinkoi: string | null;
          purchase_shopee: string | null;
          purchase_website: string | null;
          refresh_requested_by: string | null;
          review_overrides: Json;
          reviewed_at: string | null;
          reviewed_by: string | null;
          reviewer_notes: string | null;
          romanized_name: string | null;
          social_facebook: string | null;
          social_instagram: string | null;
          social_threads: string | null;
          source_attribution: string | null;
          status: string;
          submitted_at: string | null;
          submitter_email: string;
          submitter_name: string | null;
          suggested_tags: Json | null;
          validation_errors: Json | null;
          validation_status: string | null;
          website_url: string | null;
        };
        Insert: {
          base_brand_data?: Json | null;
          base_brand_updated_at?: string | null;
          brand_id?: string | null;
          brand_name: string;
          denial_reason?: string | null;
          description?: string | null;
          enriched_data?: Json | null;
          hero_image_url?: string | null;
          id?: string;
          intent?: string;
          is_brand_owner?: boolean | null;
          notified_at?: string | null;
          other_urls?: Json;
          owner_data?: Json | null;
          pdpa_consent_at?: string | null;
          product_type_note?: string | null;
          purchase_pinkoi?: string | null;
          purchase_shopee?: string | null;
          purchase_website?: string | null;
          refresh_requested_by?: string | null;
          review_overrides?: Json;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewer_notes?: string | null;
          romanized_name?: string | null;
          social_facebook?: string | null;
          social_instagram?: string | null;
          social_threads?: string | null;
          source_attribution?: string | null;
          status?: string;
          submitted_at?: string | null;
          submitter_email: string;
          submitter_name?: string | null;
          suggested_tags?: Json | null;
          validation_errors?: Json | null;
          validation_status?: string | null;
          website_url?: string | null;
        };
        Update: {
          base_brand_data?: Json | null;
          base_brand_updated_at?: string | null;
          brand_id?: string | null;
          brand_name?: string;
          denial_reason?: string | null;
          description?: string | null;
          enriched_data?: Json | null;
          hero_image_url?: string | null;
          id?: string;
          intent?: string;
          is_brand_owner?: boolean | null;
          notified_at?: string | null;
          other_urls?: Json;
          owner_data?: Json | null;
          pdpa_consent_at?: string | null;
          product_type_note?: string | null;
          purchase_pinkoi?: string | null;
          purchase_shopee?: string | null;
          purchase_website?: string | null;
          refresh_requested_by?: string | null;
          review_overrides?: Json;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewer_notes?: string | null;
          romanized_name?: string | null;
          social_facebook?: string | null;
          social_instagram?: string | null;
          social_threads?: string | null;
          source_attribution?: string | null;
          status?: string;
          submitted_at?: string | null;
          submitter_email?: string;
          submitter_name?: string | null;
          suggested_tags?: Json | null;
          validation_errors?: Json | null;
          validation_status?: string | null;
          website_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "brand_submissions_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      brands: {
        Row: {
          approved_at: string | null;
          blurb: string | null;
          blurb_en: string | null;
          brand_enriched_at: string | null;
          category_attributes: Json | null;
          city: string | null;
          contact_email: string | null;
          created_at: string | null;
          description: string | null;
          description_en: string | null;
          draft_data: Json | null;
          draft_updated_at: string | null;
          founding_year: number | null;
          hero_image_url: string | null;
          id: string;
          is_demo: boolean;
          mit_declared_at: string | null;
          mit_declared_by: string | null;
          mit_declared_scope: string | null;
          mit_evidence: Json | null;
          mit_status: string;
          mit_story: string | null;
          mit_verified_at: string | null;
          name: string;
          onboarding_dismissed_at: string | null;
          other_urls: Json;
          price_range: number | null;
          product_tags: string[] | null;
          product_tags_en: string[] | null;
          product_type: string | null;
          purchase_pinkoi: string | null;
          purchase_shopee: string | null;
          purchase_website: string | null;
          reputation_summary: Json | null;
          retail_locations: Json | null;
          romanized_name: string | null;
          search_vector: unknown;
          site_content: Json | null;
          slug: string;
          social_facebook: string | null;
          social_instagram: string | null;
          social_threads: string | null;
          source: string | null;
          status: string;
          submitted_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          approved_at?: string | null;
          blurb?: string | null;
          blurb_en?: string | null;
          brand_enriched_at?: string | null;
          category_attributes?: Json | null;
          city?: string | null;
          contact_email?: string | null;
          created_at?: string | null;
          description?: string | null;
          description_en?: string | null;
          draft_data?: Json | null;
          draft_updated_at?: string | null;
          founding_year?: number | null;
          hero_image_url?: string | null;
          id?: string;
          is_demo?: boolean;
          mit_declared_at?: string | null;
          mit_declared_by?: string | null;
          mit_declared_scope?: string | null;
          mit_evidence?: Json | null;
          mit_status?: string;
          mit_story?: string | null;
          mit_verified_at?: string | null;
          name: string;
          onboarding_dismissed_at?: string | null;
          other_urls?: Json;
          price_range?: number | null;
          product_tags?: string[] | null;
          product_tags_en?: string[] | null;
          product_type?: string | null;
          purchase_pinkoi?: string | null;
          purchase_shopee?: string | null;
          purchase_website?: string | null;
          reputation_summary?: Json | null;
          retail_locations?: Json | null;
          romanized_name?: string | null;
          search_vector?: unknown;
          site_content?: Json | null;
          slug: string;
          social_facebook?: string | null;
          social_instagram?: string | null;
          social_threads?: string | null;
          source?: string | null;
          status?: string;
          submitted_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          approved_at?: string | null;
          blurb?: string | null;
          blurb_en?: string | null;
          brand_enriched_at?: string | null;
          category_attributes?: Json | null;
          city?: string | null;
          contact_email?: string | null;
          created_at?: string | null;
          description?: string | null;
          description_en?: string | null;
          draft_data?: Json | null;
          draft_updated_at?: string | null;
          founding_year?: number | null;
          hero_image_url?: string | null;
          id?: string;
          is_demo?: boolean;
          mit_declared_at?: string | null;
          mit_declared_by?: string | null;
          mit_declared_scope?: string | null;
          mit_evidence?: Json | null;
          mit_status?: string;
          mit_story?: string | null;
          mit_verified_at?: string | null;
          name?: string;
          onboarding_dismissed_at?: string | null;
          other_urls?: Json;
          price_range?: number | null;
          product_tags?: string[] | null;
          product_tags_en?: string[] | null;
          product_type?: string | null;
          purchase_pinkoi?: string | null;
          purchase_shopee?: string | null;
          purchase_website?: string | null;
          reputation_summary?: Json | null;
          retail_locations?: Json | null;
          romanized_name?: string | null;
          search_vector?: unknown;
          site_content?: Json | null;
          slug?: string;
          social_facebook?: string | null;
          social_instagram?: string | null;
          social_threads?: string | null;
          source?: string | null;
          status?: string;
          submitted_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      claim_requests: {
        Row: {
          brand_id: string;
          created_at: string;
          id: string;
          mit_smile_cert: string | null;
          proof_evidence: Json;
          proof_notes: string | null;
          proof_type: string | null;
          proof_url: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          reviewer_notes: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          id?: string;
          mit_smile_cert?: string | null;
          proof_evidence?: Json;
          proof_notes?: string | null;
          proof_type?: string | null;
          proof_url?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewer_notes?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          id?: string;
          mit_smile_cert?: string | null;
          proof_evidence?: Json;
          proof_notes?: string | null;
          proof_type?: string | null;
          proof_url?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewer_notes?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "claim_requests_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      curation_job_targets: {
        Row: {
          brand_name: string;
          brand_slug: string | null;
          changed_fields: string[];
          completed_at: string | null;
          created_at: string;
          current_phase: string | null;
          duration_ms: number | null;
          error: string | null;
          id: string;
          job_id: string;
          phase_results: Json;
          started_at: string | null;
          status: string;
          target_id: string;
          target_type: string;
        };
        Insert: {
          brand_name: string;
          brand_slug?: string | null;
          changed_fields?: string[];
          completed_at?: string | null;
          created_at?: string;
          current_phase?: string | null;
          duration_ms?: number | null;
          error?: string | null;
          id?: string;
          job_id: string;
          phase_results?: Json;
          started_at?: string | null;
          status?: string;
          target_id: string;
          target_type: string;
        };
        Update: {
          brand_name?: string;
          brand_slug?: string | null;
          changed_fields?: string[];
          completed_at?: string | null;
          created_at?: string;
          current_phase?: string | null;
          duration_ms?: number | null;
          error?: string | null;
          id?: string;
          job_id?: string;
          phase_results?: Json;
          started_at?: string | null;
          status?: string;
          target_id?: string;
          target_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "curation_job_targets_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "curation_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      curation_jobs: {
        Row: {
          attempt: number;
          cancelled_count: number;
          completed_at: string | null;
          created_at: string | null;
          current_phase: string | null;
          current_target_id: string | null;
          dedupe_key: string | null;
          dispatch_error: string | null;
          dispatch_status: string;
          dispatched_at: string | null;
          dry_run: boolean;
          failed_count: number;
          heartbeat_at: string | null;
          id: string;
          job_error: string | null;
          operation: string;
          params: Json | null;
          parent_job_id: string | null;
          progress: Json | null;
          result: Json | null;
          run_after: string;
          scheduled_for: string | null;
          skipped_count: number;
          started_at: string | null;
          started_by: string;
          status: string;
          succeeded_count: number;
          target_total: number;
          trigger: string;
          worker_token: string | null;
        };
        Insert: {
          attempt?: number;
          cancelled_count?: number;
          completed_at?: string | null;
          created_at?: string | null;
          current_phase?: string | null;
          current_target_id?: string | null;
          dedupe_key?: string | null;
          dispatch_error?: string | null;
          dispatch_status?: string;
          dispatched_at?: string | null;
          dry_run?: boolean;
          failed_count?: number;
          heartbeat_at?: string | null;
          id?: string;
          job_error?: string | null;
          operation: string;
          params?: Json | null;
          parent_job_id?: string | null;
          progress?: Json | null;
          result?: Json | null;
          run_after?: string;
          scheduled_for?: string | null;
          skipped_count?: number;
          started_at?: string | null;
          started_by: string;
          status?: string;
          succeeded_count?: number;
          target_total?: number;
          trigger?: string;
          worker_token?: string | null;
        };
        Update: {
          attempt?: number;
          cancelled_count?: number;
          completed_at?: string | null;
          created_at?: string | null;
          current_phase?: string | null;
          current_target_id?: string | null;
          dedupe_key?: string | null;
          dispatch_error?: string | null;
          dispatch_status?: string;
          dispatched_at?: string | null;
          dry_run?: boolean;
          failed_count?: number;
          heartbeat_at?: string | null;
          id?: string;
          job_error?: string | null;
          operation?: string;
          params?: Json | null;
          parent_job_id?: string | null;
          progress?: Json | null;
          result?: Json | null;
          run_after?: string;
          scheduled_for?: string | null;
          skipped_count?: number;
          started_at?: string | null;
          started_by?: string;
          status?: string;
          succeeded_count?: number;
          target_total?: number;
          trigger?: string;
          worker_token?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "curation_jobs_parent_job_id_fkey";
            columns: ["parent_job_id"];
            isOneToOne: false;
            referencedRelation: "curation_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      email_sends: {
        Row: {
          id: string;
          sent_at: string;
          template_key: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          sent_at?: string;
          template_key: string;
          user_id: string;
        };
        Update: {
          id?: string;
          sent_at?: string;
          template_key?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      health_agent_run_ledger: {
        Row: {
          claimed_at: string;
          completed_at: string | null;
          created_at: string;
          dry_run: boolean;
          error: string | null;
          id: string;
          logical_date: string;
          requested_run_id: string;
          result: Json | null;
          routine: string;
          status: string;
          updated_at: string;
          workflow_attempt: number;
        };
        Insert: {
          claimed_at?: string;
          completed_at?: string | null;
          created_at?: string;
          dry_run?: boolean;
          error?: string | null;
          id?: string;
          logical_date: string;
          requested_run_id: string;
          result?: Json | null;
          routine: string;
          status?: string;
          updated_at?: string;
          workflow_attempt: number;
        };
        Update: {
          claimed_at?: string;
          completed_at?: string | null;
          created_at?: string;
          dry_run?: boolean;
          error?: string | null;
          id?: string;
          logical_date?: string;
          requested_run_id?: string;
          result?: Json | null;
          routine?: string;
          status?: string;
          updated_at?: string;
          workflow_attempt?: number;
        };
        Relationships: [];
      };
      health_fix_queue: {
        Row: {
          attempt_count: number;
          attempted_at: string | null;
          confirmation_data: Json | null;
          created_at: string;
          deployed_at: string | null;
          evidence: Json;
          fingerprint: string;
          fixed_at: string | null;
          id: string;
          key_frames: Json | null;
          last_error: string | null;
          lease_expires_at: string | null;
          lease_owner: string | null;
          merge_policy: string;
          merge_sha: string | null;
          next_attempt_at: string | null;
          pr_number: number | null;
          pr_url: string | null;
          recommended_action: string | null;
          seer_root_cause: string | null;
          sentry_issue_id: string | null;
          source: string;
          status: string;
          title: string;
          updated_at: string;
          url: string | null;
        };
        Insert: {
          attempt_count?: number;
          attempted_at?: string | null;
          confirmation_data?: Json | null;
          created_at?: string;
          deployed_at?: string | null;
          evidence?: Json;
          fingerprint: string;
          fixed_at?: string | null;
          id?: string;
          key_frames?: Json | null;
          last_error?: string | null;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          merge_policy?: string;
          merge_sha?: string | null;
          next_attempt_at?: string | null;
          pr_number?: number | null;
          pr_url?: string | null;
          recommended_action?: string | null;
          seer_root_cause?: string | null;
          sentry_issue_id?: string | null;
          source: string;
          status?: string;
          title: string;
          updated_at?: string;
          url?: string | null;
        };
        Update: {
          attempt_count?: number;
          attempted_at?: string | null;
          confirmation_data?: Json | null;
          created_at?: string;
          deployed_at?: string | null;
          evidence?: Json;
          fingerprint?: string;
          fixed_at?: string | null;
          id?: string;
          key_frames?: Json | null;
          last_error?: string | null;
          lease_expires_at?: string | null;
          lease_owner?: string | null;
          merge_policy?: string;
          merge_sha?: string | null;
          next_attempt_at?: string | null;
          pr_number?: number | null;
          pr_url?: string | null;
          recommended_action?: string | null;
          seer_root_cause?: string | null;
          sentry_issue_id?: string | null;
          source?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          url?: string | null;
        };
        Relationships: [];
      };
      health_snapshots: {
        Row: {
          created_at: string;
          id: string;
          metrics: Json;
          snapshot_date: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          metrics: Json;
          snapshot_date: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          metrics?: Json;
          snapshot_date?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      link_check_results: {
        Row: {
          auto_nulled_at: string | null;
          brand_id: string;
          cleanup_required: boolean;
          cleanup_required_at: string | null;
          consecutive_failures: number;
          created_at: string;
          distinct_failure_days: number;
          failure_dates: string[];
          field: string;
          id: string;
          last_checked_at: string | null;
          last_ok_at: string | null;
          last_status_code: number | null;
          updated_at: string;
          url: string;
        };
        Insert: {
          auto_nulled_at?: string | null;
          brand_id: string;
          cleanup_required?: boolean;
          cleanup_required_at?: string | null;
          consecutive_failures?: number;
          created_at?: string;
          distinct_failure_days?: number;
          failure_dates?: string[];
          field: string;
          id?: string;
          last_checked_at?: string | null;
          last_ok_at?: string | null;
          last_status_code?: number | null;
          updated_at?: string;
          url: string;
        };
        Update: {
          auto_nulled_at?: string | null;
          brand_id?: string;
          cleanup_required?: boolean;
          cleanup_required_at?: string | null;
          consecutive_failures?: number;
          created_at?: string;
          distinct_failure_days?: number;
          failure_dates?: string[];
          field?: string;
          id?: string;
          last_checked_at?: string | null;
          last_ok_at?: string | null;
          last_status_code?: number | null;
          updated_at?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "link_check_results_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      mit_registry: {
        Row: {
          brand_name: string | null;
          cert_number: string;
          company_name: string | null;
          id: number;
          industry_type: string | null;
          product_model: string | null;
          product_name: string | null;
          synced_at: string;
          valid_until: string | null;
        };
        Insert: {
          brand_name?: string | null;
          cert_number: string;
          company_name?: string | null;
          id?: number;
          industry_type?: string | null;
          product_model?: string | null;
          product_name?: string | null;
          synced_at?: string;
          valid_until?: string | null;
        };
        Update: {
          brand_name?: string | null;
          cert_number?: string;
          company_name?: string | null;
          id?: number;
          industry_type?: string | null;
          product_model?: string | null;
          product_name?: string | null;
          synced_at?: string;
          valid_until?: string | null;
        };
        Relationships: [];
      };
      moderation_flags: {
        Row: {
          brand_id: string;
          created_at: string;
          field_name: string;
          flag_reason: string;
          flagged_content: string;
          id: string;
          previous_content: string | null;
          reviewed_at: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          field_name: string;
          flag_reason: string;
          flagged_content: string;
          id?: string;
          previous_content?: string | null;
          reviewed_at?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          field_name?: string;
          flag_reason?: string;
          flagged_content?: string;
          id?: string;
          previous_content?: string | null;
          reviewed_at?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moderation_flags_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      newsletter_subscribers: {
        Row: {
          confirm_token: string;
          confirmed_at: string | null;
          consent_recorded_at: string | null;
          consent_source: string | null;
          consent_version: string | null;
          created_at: string;
          email: string;
          id: string;
          interests: string[] | null;
          locale: string;
          name: string | null;
          subscribed_at: string;
          unsubscribe_token: string;
          unsubscribed_at: string | null;
        };
        Insert: {
          confirm_token?: string;
          confirmed_at?: string | null;
          consent_recorded_at?: string | null;
          consent_source?: string | null;
          consent_version?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          interests?: string[] | null;
          locale?: string;
          name?: string | null;
          subscribed_at?: string;
          unsubscribe_token?: string;
          unsubscribed_at?: string | null;
        };
        Update: {
          confirm_token?: string;
          confirmed_at?: string | null;
          consent_recorded_at?: string | null;
          consent_source?: string | null;
          consent_version?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          interests?: string[] | null;
          locale?: string;
          name?: string | null;
          subscribed_at?: string;
          unsubscribe_token?: string;
          unsubscribed_at?: string | null;
        };
        Relationships: [];
      };
      origin_evidence: {
        Row: {
          brand_id: string;
          created_at: string;
          id: string;
          notes: string;
          photo_paths: string[];
          product_name: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          reviewer_notes: string | null;
          source_type: string;
          stance: string;
          status: string;
          user_id: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          id?: string;
          notes: string;
          photo_paths?: string[];
          product_name?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewer_notes?: string | null;
          source_type: string;
          stance: string;
          status?: string;
          user_id: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          id?: string;
          notes?: string;
          photo_paths?: string[];
          product_name?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewer_notes?: string | null;
          source_type?: string;
          stance?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "origin_evidence_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      owner_email_preferences: {
        Row: {
          consent_source: string | null;
          consent_version: string | null;
          created_at: string;
          lifecycle_opted_in_at: string | null;
          unsubscribe_token: string;
          unsubscribed_at: string | null;
          user_id: string;
        };
        Insert: {
          consent_source?: string | null;
          consent_version?: string | null;
          created_at?: string;
          lifecycle_opted_in_at?: string | null;
          unsubscribe_token?: string;
          unsubscribed_at?: string | null;
          user_id: string;
        };
        Update: {
          consent_source?: string | null;
          consent_version?: string | null;
          created_at?: string;
          lifecycle_opted_in_at?: string | null;
          unsubscribe_token?: string;
          unsubscribed_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      ownership_revocations: {
        Row: {
          brand_id: string;
          id: string;
          reason: string;
          revoked_at: string;
          revoked_by: string;
          revoked_user_email: string;
          revoked_user_id: string | null;
        };
        Insert: {
          brand_id: string;
          id?: string;
          reason: string;
          revoked_at?: string;
          revoked_by: string;
          revoked_user_email: string;
          revoked_user_id?: string | null;
        };
        Update: {
          brand_id?: string;
          id?: string;
          reason?: string;
          revoked_at?: string;
          revoked_by?: string;
          revoked_user_email?: string;
          revoked_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ownership_revocations_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      pending_brand_edits: {
        Row: {
          brand_id: string;
          created_at: string;
          id: string;
          proposed_data: Json;
          reviewed_at: string | null;
          reviewed_by: string | null;
          reviewer_notes: string | null;
          status: string;
          submitted_by: string;
          updated_at: string;
        };
        Insert: {
          brand_id: string;
          created_at?: string;
          id?: string;
          proposed_data: Json;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewer_notes?: string | null;
          status?: string;
          submitted_by: string;
          updated_at?: string;
        };
        Update: {
          brand_id?: string;
          created_at?: string;
          id?: string;
          proposed_data?: Json;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewer_notes?: string | null;
          status?: string;
          submitted_by?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pending_brand_edits_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
        ];
      };
      product_tag_translations: {
        Row: {
          created_at: string | null;
          tag_en: string;
          tag_zh: string;
        };
        Insert: {
          created_at?: string | null;
          tag_en: string;
          tag_zh: string;
        };
        Update: {
          created_at?: string | null;
          tag_en?: string;
          tag_zh?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          locale_preference: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
          locale_preference?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          locale_preference?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      submission_images: {
        Row: {
          alt_en: string | null;
          alt_zh: string | null;
          created_at: string;
          dominant_color: string | null;
          height: number | null;
          id: string;
          origin_brand_image_id: string | null;
          phash: string | null;
          score: number | null;
          sort_order: number;
          source: string;
          source_url: string | null;
          status: string;
          storage_path: string | null;
          submission_id: string;
          tags: string[] | null;
          url: string;
          width: number | null;
        };
        Insert: {
          alt_en?: string | null;
          alt_zh?: string | null;
          created_at?: string;
          dominant_color?: string | null;
          height?: number | null;
          id?: string;
          origin_brand_image_id?: string | null;
          phash?: string | null;
          score?: number | null;
          sort_order?: number;
          source: string;
          source_url?: string | null;
          status?: string;
          storage_path?: string | null;
          submission_id: string;
          tags?: string[] | null;
          url: string;
          width?: number | null;
        };
        Update: {
          alt_en?: string | null;
          alt_zh?: string | null;
          created_at?: string;
          dominant_color?: string | null;
          height?: number | null;
          id?: string;
          origin_brand_image_id?: string | null;
          phash?: string | null;
          score?: number | null;
          sort_order?: number;
          source?: string;
          source_url?: string | null;
          status?: string;
          storage_path?: string | null;
          submission_id?: string;
          tags?: string[] | null;
          url?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "submission_images_origin_brand_image_id_fkey";
            columns: ["origin_brand_image_id"];
            isOneToOne: false;
            referencedRelation: "brand_images";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submission_images_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "brand_submissions";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_export_newsletter_subscribers: {
        Args: { p_interest?: string; p_query?: string; p_status?: string };
        Returns: Json;
      };
      admin_list_newsletter_subscribers: {
        Args: {
          p_cursor_at?: string;
          p_cursor_id?: string;
          p_direction?: string;
          p_interest?: string;
          p_limit?: number;
          p_query?: string;
          p_status?: string;
        };
        Returns: {
          confirmed_at: string;
          consent_recorded_at: string;
          consent_source: string;
          consent_version: string;
          email: string;
          id: string;
          interests: string[];
          locale: string;
          name: string;
          subscribed_at: string;
          subscriber_status: string;
          total_count: number;
          unsubscribed_at: string;
        }[];
      };
      apply_brand_patch: {
        Args: {
          p_actor: string;
          p_brand_id: string;
          p_job_id: string;
          p_patch: Json;
          p_source: string;
        };
        Returns: undefined;
      };
      apply_brand_refresh: {
        Args: { p_reviewer_id: string; p_submission_id: string };
        Returns: string[];
      };
      apply_submission_enrichment_result: {
        Args: {
          p_enriched_data: Json;
          p_job_id: string;
          p_submission_id: string;
        };
        Returns: boolean;
      };
      approve_claim_request: {
        Args: { p_claim_id: string; p_reviewer_id: string };
        Returns: undefined;
      };
      approve_submission: {
        Args: {
          p_brand_data: Json;
          p_reviewer_id: string;
          p_submission_id: string;
        };
        Returns: {
          brand_id: string;
          brand_name: string;
          is_brand_owner: boolean;
          submitter_email: string;
          submitter_name: string;
          suggested_tags: Json;
        }[];
      };
      approve_submission_with_romanized_name: {
        Args: {
          p_brand_data: Json;
          p_reviewer_id: string;
          p_submission_id: string;
        };
        Returns: {
          brand_id: string;
          brand_name: string;
          is_brand_owner: boolean;
          submitter_email: string;
          submitter_name: string;
          suggested_tags: Json;
        }[];
      };
      cancel_curation_job: {
        Args: { p_job_id: string; p_reason: string };
        Returns: {
          attempt: number;
          cancelled_count: number;
          completed_at: string | null;
          created_at: string | null;
          current_phase: string | null;
          current_target_id: string | null;
          dedupe_key: string | null;
          dispatch_error: string | null;
          dispatch_status: string;
          dispatched_at: string | null;
          dry_run: boolean;
          failed_count: number;
          heartbeat_at: string | null;
          id: string;
          job_error: string | null;
          operation: string;
          params: Json | null;
          parent_job_id: string | null;
          progress: Json | null;
          result: Json | null;
          run_after: string;
          scheduled_for: string | null;
          skipped_count: number;
          started_at: string | null;
          started_by: string;
          status: string;
          succeeded_count: number;
          target_total: number;
          trigger: string;
          worker_token: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "curation_jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      check_brand_duplicates: {
        Args: { p_name: string; p_ubn?: string };
        Returns: Json;
      };
      claim_curation_job: {
        Args: { p_job_id: string; p_worker_token: string };
        Returns: {
          attempt: number;
          cancelled_count: number;
          completed_at: string | null;
          created_at: string | null;
          current_phase: string | null;
          current_target_id: string | null;
          dedupe_key: string | null;
          dispatch_error: string | null;
          dispatch_status: string;
          dispatched_at: string | null;
          dry_run: boolean;
          failed_count: number;
          heartbeat_at: string | null;
          id: string;
          job_error: string | null;
          operation: string;
          params: Json | null;
          parent_job_id: string | null;
          progress: Json | null;
          result: Json | null;
          run_after: string;
          scheduled_for: string | null;
          skipped_count: number;
          started_at: string | null;
          started_by: string;
          status: string;
          succeeded_count: number;
          target_total: number;
          trigger: string;
          worker_token: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "curation_jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_health_agent_run: {
        Args: {
          p_dry_run?: boolean;
          p_logical_date: string;
          p_requested_run_id: string;
          p_routine: string;
          p_workflow_attempt: number;
        };
        Returns: Json;
      };
      claim_health_fixes: {
        Args: {
          p_lease_duration?: unknown;
          p_lease_owner: string;
          p_merge_policy: string;
        };
        Returns: {
          attempt_count: number;
          attempted_at: string | null;
          confirmation_data: Json | null;
          created_at: string;
          deployed_at: string | null;
          evidence: Json;
          fingerprint: string;
          fixed_at: string | null;
          id: string;
          key_frames: Json | null;
          last_error: string | null;
          lease_expires_at: string | null;
          lease_owner: string | null;
          merge_policy: string;
          merge_sha: string | null;
          next_attempt_at: string | null;
          pr_number: number | null;
          pr_url: string | null;
          recommended_action: string | null;
          seer_root_cause: string | null;
          sentry_issue_id: string | null;
          source: string;
          status: string;
          title: string;
          updated_at: string;
          url: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "health_fix_queue";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_next_curation_job: {
        Args: { p_worker_token: string };
        Returns: {
          attempt: number;
          cancelled_count: number;
          completed_at: string | null;
          created_at: string | null;
          current_phase: string | null;
          current_target_id: string | null;
          dedupe_key: string | null;
          dispatch_error: string | null;
          dispatch_status: string;
          dispatched_at: string | null;
          dry_run: boolean;
          failed_count: number;
          heartbeat_at: string | null;
          id: string;
          job_error: string | null;
          operation: string;
          params: Json | null;
          parent_job_id: string | null;
          progress: Json | null;
          result: Json | null;
          run_after: string;
          scheduled_for: string | null;
          skipped_count: number;
          started_at: string | null;
          started_by: string;
          status: string;
          succeeded_count: number;
          target_total: number;
          trigger: string;
          worker_token: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "curation_jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      complete_health_agent_run: {
        Args: {
          p_logical_date: string;
          p_requested_run_id: string;
          p_result: Json;
          p_routine: string;
          p_workflow_attempt: number;
        };
        Returns: boolean;
      };
      enqueue_curation_job: {
        Args: {
          p_attempt: number;
          p_dedupe_key: string;
          p_dry_run: boolean;
          p_operation: string;
          p_params: Json;
          p_parent_job_id: string | null;
          p_run_after: string;
          p_scheduled_for: string | null;
          p_started_by: string;
          p_targets: Json;
          p_trigger: string;
        };
        Returns: string;
      };
      enqueue_health_fix: {
        Args: {
          p_evidence: Json;
          p_fingerprint: string;
          p_merge_policy: string;
          p_sentry_issue_id?: string;
          p_source: string;
          p_title: string;
          p_url?: string;
        };
        Returns: string;
      };
      fail_health_agent_run: {
        Args: {
          p_error: string;
          p_logical_date: string;
          p_requested_run_id: string;
          p_result?: Json;
          p_routine: string;
          p_workflow_attempt: number;
        };
        Returns: boolean;
      };
      find_similar_brands: {
        Args: { p_names: string[]; p_threshold?: number };
        Returns: {
          brand_name: string;
          brand_slug: string;
          input_name: string;
          similarity_score: number;
        }[];
      };
      get_brand_quality_metrics: {
        Args: never;
        Returns: {
          avg_description_length: number;
          completeness_excellent: number;
          completeness_fair: number;
          completeness_good: number;
          completeness_poor: number;
          description_count: number;
          hero_image_count: number;
          purchase_pinkoi_count: number;
          purchase_shopee_count: number;
          purchase_website_count: number;
          social_facebook_count: number;
          social_instagram_count: number;
          social_threads_count: number;
          total_brands: number;
        }[];
      };
      mark_unreported_curation_job_targets_skipped: {
        Args: { p_job_id: string; p_worker_token: string };
        Returns: boolean;
      };
      persist_curation_job_target_progress: {
        Args: {
          p_current_phase?: string;
          p_current_target_id?: string;
          p_job_id: string;
          p_updates: Json;
          p_worker_token: string;
        };
        Returns: boolean;
      };
      record_health_snapshot: {
        Args: { p_metrics: Json; p_snapshot_date: string };
        Returns: {
          created_at: string;
          id: string;
          metrics: Json;
          snapshot_date: string;
          updated_at: string;
        };
      };
      record_link_health_result: {
        Args: {
          p_brand_id: string;
          p_checked_at?: string;
          p_field: string;
          p_status_code: number;
          p_url: string;
        };
        Returns: {
          auto_nulled_at: string | null;
          brand_id: string;
          cleanup_required: boolean;
          cleanup_required_at: string | null;
          consecutive_failures: number;
          created_at: string;
          distinct_failure_days: number;
          failure_dates: string[];
          field: string;
          id: string;
          last_checked_at: string | null;
          last_ok_at: string | null;
          last_status_code: number | null;
          updated_at: string;
          url: string;
        };
      };
      recover_stale_curation_jobs: {
        Args: { p_stale_before: string };
        Returns: {
          attempt: number;
          cancelled_count: number;
          completed_at: string | null;
          created_at: string | null;
          current_phase: string | null;
          current_target_id: string | null;
          dedupe_key: string | null;
          dispatch_error: string | null;
          dispatch_status: string;
          dispatched_at: string | null;
          dry_run: boolean;
          failed_count: number;
          heartbeat_at: string | null;
          id: string;
          job_error: string | null;
          operation: string;
          params: Json | null;
          parent_job_id: string | null;
          progress: Json | null;
          result: Json | null;
          run_after: string;
          scheduled_for: string | null;
          skipped_count: number;
          started_at: string | null;
          started_by: string;
          status: string;
          succeeded_count: number;
          target_total: number;
          trigger: string;
          worker_token: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "curation_jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      reject_submission: {
        Args: {
          p_denial_reason: string;
          p_reviewer_id: string;
          p_reviewer_notes: string;
          p_submission_id: string;
        };
        Returns: string[];
      };
      request_brand_refresh: {
        Args: {
          p_brand_id: string;
          p_requested_by: string;
          p_requester_email: string;
        };
        Returns: string;
      };
      revoke_brand_ownership: {
        Args: { p_brand_id: string; p_reason: string; p_revoked_by: string };
        Returns: {
          revoked_user_email: string;
          revoked_user_id: string;
        }[];
      };
      save_submission_review: {
        Args: { p_images: Json; p_review_data: Json; p_submission_id: string };
        Returns: undefined;
      };
      search_brands: {
        Args: {
          filter_categories?: string[];
          filter_status?: string;
          filter_tags?: string[];
          filter_verification?: string;
          include_test_brands?: boolean;
          prefix_mode?: boolean;
          result_limit?: number;
          search_query: string;
        };
        Returns: {
          hero_image_url: string;
          id: string;
          name: string;
          primary_category_name: string;
          rank_score: number;
          search_source: string;
          slug: string;
        }[];
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
      transition_health_fix: {
        Args: {
          p_confirmation_data?: Json;
          p_deployed_at?: string;
          p_expected_status: string;
          p_id: string;
          p_last_error?: string;
          p_lease_owner?: string;
          p_merge_sha?: string;
          p_new_status: string;
          p_next_attempt_at?: string;
          p_pr_number?: number;
          p_pr_url?: string;
        };
        Returns: {
          attempt_count: number;
          attempted_at: string | null;
          confirmation_data: Json | null;
          created_at: string;
          deployed_at: string | null;
          evidence: Json;
          fingerprint: string;
          fixed_at: string | null;
          id: string;
          key_frames: Json | null;
          last_error: string | null;
          lease_expires_at: string | null;
          lease_owner: string | null;
          merge_policy: string;
          merge_sha: string | null;
          next_attempt_at: string | null;
          pr_number: number | null;
          pr_url: string | null;
          recommended_action: string | null;
          seer_root_cause: string | null;
          sentry_issue_id: string | null;
          source: string;
          status: string;
          title: string;
          updated_at: string;
          url: string | null;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
