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
          brand_id: string
          confidence: string | null
          created_at: string
          description: string | null
          id: string
          is_non_brand: boolean | null
          model: string
          non_brand_reason: string | null
          phase: string
          product_type: string | null
          raw_response: Json | null
          slug_generated: string | null
          value_tags: string[]
        }
        Insert: {
          brand_id: string
          confidence?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_non_brand?: boolean | null
          model: string
          non_brand_reason?: string | null
          phase: string
          product_type?: string | null
          raw_response?: Json | null
          slug_generated?: string | null
          value_tags?: string[]
        }
        Update: {
          brand_id?: string
          confidence?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_non_brand?: boolean | null
          model?: string
          non_brand_reason?: string | null
          phase?: string
          product_type?: string | null
          raw_response?: Json | null
          slug_generated?: string | null
          value_tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "brand_ai_results_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
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
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          notes?: string | null
          reason: string
          reviewed_at?: string | null
          status?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          reason?: string
          reviewed_at?: string | null
          status?: string
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
          brand_id: string
          created_at: string
          id: string
          query: string
          raw_response: Json | null
          search_type: string
          snippets: string[]
          urls: string[]
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          query: string
          raw_response?: Json | null
          search_type: string
          snippets?: string[]
          urls?: string[]
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          query?: string
          raw_response?: Json | null
          search_type?: string
          snippets?: string[]
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
          is_brand_owner: boolean | null
          notified_at: string | null
          other_urls: Json
          pdpa_consent_at: string | null
          product_photos: Json | null
          product_type_note: string | null
          purchase_pinkoi: string | null
          purchase_shopee: string | null
          purchase_website: string | null
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
          unified_business_number: string | null
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
          is_brand_owner?: boolean | null
          notified_at?: string | null
          other_urls?: Json
          pdpa_consent_at?: string | null
          product_photos?: Json | null
          product_type_note?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
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
          unified_business_number?: string | null
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
          is_brand_owner?: boolean | null
          notified_at?: string | null
          other_urls?: Json
          pdpa_consent_at?: string | null
          product_photos?: Json | null
          product_type_note?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
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
          unified_business_number?: string | null
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
        Relationships: [
          {
            foreignKeyName: "brand_taxonomy_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_taxonomy_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "taxonomy_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          approved_at: string | null
          brand_enriched_at: string | null
          contact_email: string | null
          customer_voices: Json | null
          created_at: string | null
          description: string | null
          draft_data: Json | null
          draft_updated_at: string | null
          founding_year: number | null
          hero_image_url: string | null
          id: string
          images_enriched_at: string | null
          is_demo: boolean
          mit_claimed_at: string | null
          mit_evidence: Json | null
          mit_status: string
          mit_verified_at: string | null
          name: string
          other_urls: Json
          price_range: number | null
          product_photos: Json | null
          product_tags: string[] | null
          product_type: string | null
          purchase_pinkoi: string | null
          purchase_shopee: string | null
          purchase_website: string | null
          retail_locations: Json | null
          search_vector: unknown
          serp_enriched_at: string | null
          site_content: Json | null
          slug: string
          social_facebook: string | null
          social_instagram: string | null
          social_threads: string | null
          source: string | null
          status: string
          submitted_at: string | null
          tag_slugs: string[]
          unified_business_number: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          brand_enriched_at?: string | null
          contact_email?: string | null
          customer_voices?: Json | null
          created_at?: string | null
          description?: string | null
          draft_data?: Json | null
          draft_updated_at?: string | null
          founding_year?: number | null
          hero_image_url?: string | null
          id?: string
          images_enriched_at?: string | null
          is_demo?: boolean
          mit_claimed_at?: string | null
          mit_evidence?: Json | null
          mit_status?: string
          mit_verified_at?: string | null
          name: string
          other_urls?: Json
          price_range?: number | null
          product_photos?: Json | null
          product_tags?: string[] | null
          product_type?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
          retail_locations?: Json | null
          search_vector?: unknown
          serp_enriched_at?: string | null
          site_content?: Json | null
          slug: string
          social_facebook?: string | null
          social_instagram?: string | null
          social_threads?: string | null
          source?: string | null
          status?: string
          submitted_at?: string | null
          tag_slugs?: string[]
          unified_business_number?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          brand_enriched_at?: string | null
          contact_email?: string | null
          customer_voices?: Json | null
          created_at?: string | null
          description?: string | null
          draft_data?: Json | null
          draft_updated_at?: string | null
          founding_year?: number | null
          hero_image_url?: string | null
          id?: string
          images_enriched_at?: string | null
          is_demo?: boolean
          mit_claimed_at?: string | null
          mit_evidence?: Json | null
          mit_status?: string
          mit_verified_at?: string | null
          name?: string
          other_urls?: Json
          price_range?: number | null
          product_photos?: Json | null
          product_tags?: string[] | null
          product_type?: string | null
          purchase_pinkoi?: string | null
          purchase_shopee?: string | null
          purchase_website?: string | null
          retail_locations?: Json | null
          search_vector?: unknown
          serp_enriched_at?: string | null
          site_content?: Json | null
          slug?: string
          social_facebook?: string | null
          social_instagram?: string | null
          social_threads?: string | null
          source?: string | null
          status?: string
          submitted_at?: string | null
          tag_slugs?: string[]
          unified_business_number?: string | null
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
          completed_at: string | null
          created_at: string | null
          dry_run: boolean
          id: string
          operation: string
          params: Json | null
          progress: Json | null
          result: Json | null
          started_at: string | null
          started_by: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          dry_run?: boolean
          id?: string
          operation: string
          params?: Json | null
          progress?: Json | null
          result?: Json | null
          started_at?: string | null
          started_by: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          dry_run?: boolean
          id?: string
          operation?: string
          params?: Json | null
          progress?: Json | null
          result?: Json | null
          started_at?: string | null
          started_by?: string
          status?: string
        }
        Relationships: []
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
          created_at: string
          unsubscribe_token: string
          unsubscribed_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          user_id?: string
        }
        Relationships: []
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
          email_notifications: boolean
          id: string
          locale_preference: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email_notifications?: boolean
          id: string
          locale_preference?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email_notifications?: boolean
          id?: string
          locale_preference?: string
          updated_at?: string
        }
        Relationships: []
      }
      taxonomy_tags: {
        Row: {
          category: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          name_zh: string | null
          slug: string
          suggested_by: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_zh?: string | null
          slug: string
          suggested_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_zh?: string | null
          slug?: string
          suggested_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_taxonomy_tags_suggested_by"
            columns: ["suggested_by"]
            isOneToOne: false
            referencedRelation: "brand_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_claim_request: {
        Args: { p_claim_id: string; p_reviewer_id: string }
        Returns: undefined
      }
      check_brand_duplicates: {
        Args: { p_name: string; p_ubn?: string }
        Returns: Json
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
      profile_completeness: { Args: { p_brand_id: string }; Returns: number }
      refresh_brand_tag_slugs: {
        Args: { p_brand_id: string }
        Returns: undefined
      }
      search_brands: {
        Args: { result_limit?: number; search_query: string }
        Returns: {
          hero_image_url: string
          id: string
          name: string
          primary_category_name: string
          similarity_score: number
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
