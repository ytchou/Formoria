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
          brand_id: string | null
          confidence: string | null
          config: Json | null
          created_at: string
          description: string | null
          id: string
          input: Json | null
          is_non_brand: boolean | null
          job_id: string | null
          model: string
          non_brand_reason: string | null
          phase: string
          price_range: number | null
          product_tags: string[] | null
          product_type: string | null
          raw_response: Json | null
          slug_generated: string | null
          submission_id: string | null
          latency_ms: number | null
        }
        Insert: {
          attempt?: number | null
          brand_id?: string | null
          confidence?: string | null
          config?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          input?: Json | null
          is_non_brand?: boolean | null
          job_id?: string | null
          model: string
          non_brand_reason?: string | null
          phase: string
          price_range?: number | null
          product_tags?: string[] | null
          product_type?: string | null
          raw_response?: Json | null
          slug_generated?: string | null
          submission_id?: string | null
          latency_ms?: number | null
        }
        Update: {
          attempt?: number | null
          brand_id?: string | null
          confidence?: string | null
          config?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          input?: Json | null
          is_non_brand?: boolean | null
          job_id?: string | null
          model?: string
          non_brand_reason?: string | null
          phase?: string
          price_range?: number | null
          product_tags?: string[] | null
          product_type?: string | null
          raw_response?: Json | null
          slug_generated?: string | null
          submission_id?: string | null
          latency_ms?: number | null
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
      brand_analytics: {
        Row: {
          brand_id: string
          clicks: number
          created_at: string
          date: string
          id: string
          source: string
          views: number
        }
        Insert: {
          brand_id: string
          clicks?: number
          created_at?: string
          date?: string
          id?: string
          source?: string
          views?: number
        }
        Update: {
          brand_id?: string
          clicks?: number
          created_at?: string
          date?: string
          id?: string
          source?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "brand_analytics_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_link_clicks: {
        Row: {
          brand_id: string
          clicks: number
          created_at: string
          date: string
          destination: string
          id: string
        }
        Insert: {
          brand_id: string
          clicks?: number
          created_at?: string
          date?: string
          destination: string
          id?: string
        }
        Update: {
          brand_id?: string
          clicks?: number
          created_at?: string
          date?: string
          destination?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_link_clicks_brand_id_fkey"
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
      brand_reports: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          notes: string | null
          reason: string
          reviewed_at: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          notes?: string | null
          reason: string
          reviewed_at?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          reason?: string
          reviewed_at?: string | null
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
          brand_id: string | null
          config: Json | null
          created_at: string
          id: string
          job_id: string | null
          latency_ms: number | null
          query: string
          raw_response: Json | null
          search_type: string
          snippets: string[]
          submission_id: string | null
          urls: string[]
        }
        Insert: {
          brand_id?: string | null
          config?: Json | null
          created_at?: string
          id?: string
          job_id?: string | null
          latency_ms?: number | null
          query: string
          raw_response?: Json | null
          search_type: string
          snippets?: string[]
          submission_id?: string | null
          urls?: string[]
        }
        Update: {
          brand_id?: string | null
          config?: Json | null
          created_at?: string
          id?: string
          job_id?: string | null
          latency_ms?: number | null
          query?: string
          raw_response?: Json | null
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
            referencedRelation: "brands"
            referencedColumns: ["slug"]
          },
        ]
      }
      brand_submissions: {
        Row: {
          brand_id: string | null
          brand_name: string
          denial_reason: string | null
          description: string | null
          enriched_data: Json | null
          hero_image_url: string | null
          id: string
          intent: string
          is_brand_owner: boolean | null
          notified_at: string | null
          other_urls: Json
          pdpa_consent_at: string | null
          product_type_note: string | null
          purchase_pinkoi: string | null
          purchase_shopee: string | null
          purchase_website: string | null
          romanized_name: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
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
          brand_id?: string | null
          brand_name: string
          denial_reason?: string | null
          description?: string | null
          enriched_data?: Json | null
          hero_image_url?: string | null
          id?: string
          intent?: string
          is_brand_owner?: boolean | null
          notified_at?: string | null
          other_urls?: Json
          pdpa_consent_at?: string | null
          product_type_note?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
          romanized_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
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
          brand_id?: string | null
          brand_name?: string
          denial_reason?: string | null
          description?: string | null
          enriched_data?: Json | null
          hero_image_url?: string | null
          id?: string
          intent?: string
          is_brand_owner?: boolean | null
          notified_at?: string | null
          other_urls?: Json
          pdpa_consent_at?: string | null
          product_type_note?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
          romanized_name?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
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
      submission_images: {
        Row: {
          alt_en: string | null
          alt_zh: string | null
          created_at: string
          dominant_color: string | null
          height: number | null
          id: string
          phash: string | null
          score: number | null
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
          alt_en?: string | null
          alt_zh?: string | null
          created_at?: string
          dominant_color?: string | null
          height?: number | null
          id?: string
          phash?: string | null
          score?: number | null
          sort_order?: number
          source: string
          source_url?: string | null
          status?: string
          storage_path?: string | null
          submission_id: string
          tags?: string[] | null
          url: string
          width?: number | null
        }
        Update: {
          alt_en?: string | null
          alt_zh?: string | null
          created_at?: string
          dominant_color?: string | null
          height?: number | null
          id?: string
          phash?: string | null
          score?: number | null
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
            foreignKeyName: "submission_images_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "brand_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          approved_at: string | null
          brand_enriched_at: string | null
          category_attributes: Json | null
          city: string | null
          blurb: string | null
          blurb_en: string | null
          contact_email: string | null
          created_at: string | null
          description: string | null
          description_en: string | null
          draft_data: Json | null
          draft_updated_at: string | null
          founding_year: number | null
          hero_image_url: string | null
          id: string
          is_demo: boolean
          mit_evidence: Json | null
          mit_status: string
          mit_story: string | null
          mit_verified_at: string | null
          name: string
          other_urls: Json
          price_range: number | null
          product_tags: string[] | null
          product_tags_en: string[] | null
          product_type: string | null
          purchase_pinkoi: string | null
          purchase_shopee: string | null
          purchase_website: string | null
          reputation_summary: Json | null
          retail_locations: Json | null
          romanized_name: string | null
          search_vector: unknown
          site_content: Json | null
          slug: string
          social_facebook: string | null
          social_instagram: string | null
          social_threads: string | null
          source: string | null
          status: string
          submitted_at: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          brand_enriched_at?: string | null
          category_attributes?: Json | null
          city?: string | null
          blurb?: string | null
          blurb_en?: string | null
          contact_email?: string | null
          created_at?: string | null
          description?: string | null
          description_en?: string | null
          draft_data?: Json | null
          draft_updated_at?: string | null
          founding_year?: number | null
          hero_image_url?: string | null
          id?: string
          is_demo?: boolean
          mit_evidence?: Json | null
          mit_status?: string
          mit_story?: string | null
          mit_verified_at?: string | null
          name: string
          other_urls?: Json
          price_range?: number | null
          product_tags?: string[] | null
          product_tags_en?: string[] | null
          product_type?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
          reputation_summary?: Json | null
          retail_locations?: Json | null
          romanized_name?: string | null
          search_vector?: unknown
          site_content?: Json | null
          slug: string
          social_facebook?: string | null
          social_instagram?: string | null
          social_threads?: string | null
          source?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          brand_enriched_at?: string | null
          category_attributes?: Json | null
          city?: string | null
          blurb?: string | null
          blurb_en?: string | null
          contact_email?: string | null
          created_at?: string | null
          description?: string | null
          description_en?: string | null
          draft_data?: Json | null
          draft_updated_at?: string | null
          founding_year?: number | null
          hero_image_url?: string | null
          id?: string
          is_demo?: boolean
          mit_evidence?: Json | null
          mit_status?: string
          mit_story?: string | null
          mit_verified_at?: string | null
          name?: string
          other_urls?: Json
          price_range?: number | null
          product_tags?: string[] | null
          product_tags_en?: string[] | null
          product_type?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
          reputation_summary?: Json | null
          retail_locations?: Json | null
          romanized_name?: string | null
          search_vector?: unknown
          site_content?: Json | null
          slug?: string
          social_facebook?: string | null
          social_instagram?: string | null
          social_threads?: string | null
          source?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
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
      curation_jobs: {
        Row: {
          attempt: number
          completed_at: string | null
          created_at: string | null
          dispatch_error: string | null
          dispatch_status: string
          dispatched_at: string | null
          current_phase: string | null
          current_target_id: string | null
          dedupe_key: string | null
          dry_run: boolean
          failed_count: number
          heartbeat_at: string | null
          id: string
          job_error: string | null
          operation: string
          parent_job_id: string | null
          params: Json | null
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
          completed_at?: string | null
          created_at?: string | null
          dispatch_error?: string | null
          dispatch_status?: string
          dispatched_at?: string | null
          current_phase?: string | null
          current_target_id?: string | null
          dedupe_key?: string | null
          dry_run?: boolean
          failed_count?: number
          heartbeat_at?: string | null
          id?: string
          job_error?: string | null
          operation: string
          parent_job_id?: string | null
          params?: Json | null
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
          completed_at?: string | null
          created_at?: string | null
          dispatch_error?: string | null
          dispatch_status?: string
          dispatched_at?: string | null
          current_phase?: string | null
          current_target_id?: string | null
          dedupe_key?: string | null
          dry_run?: boolean
          failed_count?: number
          heartbeat_at?: string | null
          id?: string
          job_error?: string | null
          operation?: string
          parent_job_id?: string | null
          params?: Json | null
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
      feedback: {
        Row: {
          body: string | null
          created_at: string
          id: string
          metadata: Json | null
          reviewed_at: string | null
          sentry_event_id: string | null
          sentry_feedback_id: string | null
          source: string
          status: string
          tally_response_id: string | null
          title: string | null
          type: string
          url: string | null
          user_email: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          reviewed_at?: string | null
          sentry_event_id?: string | null
          sentry_feedback_id?: string | null
          source: string
          status?: string
          tally_response_id?: string | null
          title?: string | null
          type: string
          url?: string | null
          user_email?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          reviewed_at?: string | null
          sentry_event_id?: string | null
          sentry_feedback_id?: string | null
          source?: string
          status?: string
          tally_response_id?: string | null
          title?: string | null
          type?: string
          url?: string | null
          user_email?: string | null
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
          product_model: string | null
          product_name: string | null
          synced_at: string
          valid_until: string | null
        }
        Insert: {
          brand_name?: string | null
          cert_number: string
          company_name?: string | null
          id?: number
          industry_type?: string | null
          product_model?: string | null
          product_name?: string | null
          synced_at?: string
          valid_until?: string | null
        }
        Update: {
          brand_name?: string | null
          cert_number?: string
          company_name?: string | null
          id?: number
          industry_type?: string | null
          product_model?: string | null
          product_name?: string | null
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
          status: string
          tier: string
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
          status?: string
          tier: string
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
          status?: string
          tier?: string
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
          consent_recorded_at: string | null
          consent_source: string | null
          consent_version: string | null
          confirm_token: string
          confirmed_at: string | null
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
          consent_recorded_at?: string | null
          consent_source?: string | null
          consent_version?: string | null
          confirm_token?: string
          confirmed_at?: string | null
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
          consent_recorded_at?: string | null
          consent_source?: string | null
          consent_version?: string | null
          confirm_token?: string
          confirmed_at?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
          suggested_tags: Json | null
          submitter_email: string
          submitter_name: string | null
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
          suggested_tags: Json | null
          submitter_email: string
          submitter_name: string | null
        }[]
      }
      approve_claim_request: {
        Args: { p_claim_id: string; p_reviewer_id: string }
        Returns: undefined
      }
      claim_next_curation_job: {
        Args: { p_worker_token: string }
        Returns: Database["public"]["Tables"]["curation_jobs"]["Row"][]
      }
      claim_curation_job: {
        Args: { p_job_id: string; p_worker_token: string }
        Returns: Database["public"]["Tables"]["curation_jobs"]["Row"][]
      }
      check_brand_duplicates: {
        Args: { p_name: string; p_ubn?: string }
        Returns: Json
      }
      enqueue_curation_job: {
        Args: {
          p_attempt: number
          p_dedupe_key: string | null
          p_dry_run: boolean
          p_operation: string
          p_params: Json
          p_parent_job_id: string | null
          p_run_after: string
          p_scheduled_for: string | null
          p_started_by: string
          p_targets: Json
          p_trigger: string
        }
        Returns: string
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
      increment_brand_click: {
        Args: { p_brand_id: string }
        Returns: undefined
      }
      increment_brand_link_click: {
        Args: { p_brand_id: string; p_destination: string }
        Returns: undefined
      }
      increment_brand_view: {
        Args: { p_brand_id: string; p_source?: string }
        Returns: undefined
      }
      mark_unreported_curation_job_targets_skipped: {
        Args: { p_job_id: string; p_worker_token: string }
        Returns: boolean
      }
      persist_curation_job_target_progress: {
        Args: {
          p_current_phase?: string | null
          p_current_target_id?: string | null
          p_job_id: string
          p_updates: Json
          p_worker_token: string
        }
        Returns: boolean
      }
      recover_stale_curation_jobs: {
        Args: { p_stale_before: string }
        Returns: Database["public"]["Tables"]["curation_jobs"]["Row"][]
      }
      reject_submission: {
        Args: {
          p_denial_reason: string
          p_reviewer_id: string
          p_reviewer_notes: string | null
          p_submission_id: string
        }
        Returns: string[]
      }
      revoke_brand_ownership: {
        Args: {
          p_brand_id: string
          p_revoked_by: string
          p_reason: string
        }
        Returns: {
          revoked_user_id: string
          revoked_user_email: string
        }[]
      }
      search_brands: {
        Args: {
          filter_categories?: string[]
          filter_status?: string
          filter_tags?: string[]
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
