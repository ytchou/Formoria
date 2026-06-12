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
      brand_submissions: {
        Row: {
          brand_id: string | null
          brand_name: string
          description: string | null
          id: string
          is_brand_owner: boolean | null
          notified_at: string | null
          pdpa_consent_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          social_links: Json | null
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
          description?: string | null
          id?: string
          is_brand_owner?: boolean | null
          notified_at?: string | null
          pdpa_consent_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          social_links?: Json | null
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
          description?: string | null
          id?: string
          is_brand_owner?: boolean | null
          notified_at?: string | null
          pdpa_consent_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          social_links?: Json | null
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
          brand_highlights: string | null
          category: string | null
          contact_email: string | null
          created_at: string | null
          description: string | null
          draft_data: Json | null
          draft_updated_at: string | null
          founder: Json | null
          founding_year: number | null
          hero_image_url: string | null
          id: string
          is_demo: boolean
          logo_url: string | null
          mit_claimed_at: string | null
          mit_evidence: Json | null
          mit_status: string
          mit_verified_at: string | null
          name: string
          product_photos: Json | null
          purchase_links: Json | null
          retail_locations: Json | null
          site_content: Json | null
          slug: string
          social_links: Json | null
          source: string | null
          status: string
          submitted_at: string | null
          tag_slugs: string[]
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          brand_highlights?: string | null
          category?: string | null
          contact_email?: string | null
          created_at?: string | null
          description?: string | null
          draft_data?: Json | null
          draft_updated_at?: string | null
          founder?: Json | null
          founding_year?: number | null
          hero_image_url?: string | null
          id?: string
          is_demo?: boolean
          logo_url?: string | null
          mit_claimed_at?: string | null
          mit_evidence?: Json | null
          mit_status?: string
          mit_verified_at?: string | null
          name: string
          product_photos?: Json | null
          purchase_links?: Json | null
          retail_locations?: Json | null
          site_content?: Json | null
          slug: string
          social_links?: Json | null
          source?: string | null
          status?: string
          submitted_at?: string | null
          tag_slugs?: string[]
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          brand_highlights?: string | null
          category?: string | null
          contact_email?: string | null
          created_at?: string | null
          description?: string | null
          draft_data?: Json | null
          draft_updated_at?: string | null
          founder?: Json | null
          founding_year?: number | null
          hero_image_url?: string | null
          id?: string
          is_demo?: boolean
          logo_url?: string | null
          mit_claimed_at?: string | null
          mit_evidence?: Json | null
          mit_status?: string
          mit_verified_at?: string | null
          name?: string
          product_photos?: Json | null
          purchase_links?: Json | null
          retail_locations?: Json | null
          site_content?: Json | null
          slug?: string
          social_links?: Json | null
          source?: string | null
          status?: string
          submitted_at?: string | null
          tag_slugs?: string[]
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
          id: string
          logo_url: string
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
