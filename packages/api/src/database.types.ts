
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "api": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            "my_entitlement": {
                  Row: {
                    "active_pets": number | null,"pet_limit": number | null,"tier": "free"|"pro"|"max" | null
                  }
                  ComputedFields: never
                  Insert: {
                           "active_pets"?: never,"pet_limit"?: never,"tier"?: "free"|"pro"|"max" | null
                         }
                        Update: {
                           "active_pets"?: never,"pet_limit"?: never,"tier"?: "free"|"pro"|"max" | null
                         }
                        Relationships: [
                    
                  ]
                },"my_profile": {
                  Row: {
                    "display_name": string | null,"id": string | null,"onboarding_completed_at": string | null,"onboarding_path": "owner"|"finder" | null
                  }
                  ComputedFields: never
                  Insert: {
                           "display_name"?: string | null,"id"?: string | null,"onboarding_completed_at"?: string | null,"onboarding_path"?: "owner"|"finder" | null
                         }
                        Update: {
                           "display_name"?: string | null,"id"?: string | null,"onboarding_completed_at"?: string | null,"onboarding_path"?: "owner"|"finder" | null
                         }
                        Relationships: [
                    
                  ]
                },"pet_photos": {
                  Row: {
                    "confirmed_at": string | null,"created_at": string | null,"height": number | null,"id": string | null,"pet_id": string | null,"status": "pending"|"ready"|"rejected" | null,"storage_path": string | null,"view": "front"|"side"|"markings"|"extra" | null,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                           "confirmed_at"?: string | null,"created_at"?: string | null,"height"?: number | null,"id"?: string | null,"pet_id"?: string | null,"status"?: "pending"|"ready"|"rejected" | null,"storage_path"?: string | null,"view"?: "front"|"side"|"markings"|"extra" | null,"width"?: number | null
                         }
                        Update: {
                           "confirmed_at"?: string | null,"created_at"?: string | null,"height"?: number | null,"id"?: string | null,"pet_id"?: string | null,"status"?: "pending"|"ready"|"rejected" | null,"storage_path"?: string | null,"view"?: "front"|"side"|"markings"|"extra" | null,"width"?: number | null
                         }
                        Relationships: [
                    
                  ]
                },"pets": {
                  Row: {
                    "age_months": number | null,"breed": string | null,"created_at": string | null,"discovery_enabled": boolean | null,"id": string | null,"name": string | null,"registration_state": "private"|"archived" | null,"species": "dog"|"cat" | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                           "age_months"?: number | null,"breed"?: string | null,"created_at"?: string | null,"discovery_enabled"?: boolean | null,"id"?: string | null,"name"?: string | null,"registration_state"?: "private"|"archived" | null,"species"?: "dog"|"cat" | null,"updated_at"?: string | null
                         }
                        Update: {
                           "age_months"?: number | null,"breed"?: string | null,"created_at"?: string | null,"discovery_enabled"?: boolean | null,"id"?: string | null,"name"?: string | null,"registration_state"?: "private"|"archived" | null,"species"?: "dog"|"cat" | null,"updated_at"?: string | null
                         }
                        Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "claim_storage_deletions":
{ Args: { "max": number }; Returns: {
              "id": number,"storage_path": string
            }[]
                           },
"complete_onboarding":
{ Args: { "path": "owner"|"finder" }; Returns: undefined
                           },
"complete_storage_deletions":
{ Args: { "done": (number)[],"failed": Json }; Returns: undefined
                           },
"confirm_photo":
{ Args: { "blur_score": number,"brightness": number,"height": number,"id": string,"width": number }; Returns: Database["api"]['Views']["pet_photos"]['Row']
                          SetofOptions: {
        from: "*"
        to: "pet_photos"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_pet":
{ Args: { "age_months": number,"breed": string,"id": string,"name": string,"species": "dog"|"cat" }; Returns: Database["api"]['Views']["pets"]['Row']
                          SetofOptions: {
        from: "*"
        to: "pets"
        isOneToOne: true
        isSetofReturn: false
      } },
"delete_pet":
{ Args: { "id": string }; Returns: undefined
                           },
"delete_photo":
{ Args: { "id": string }; Returns: undefined
                           },
"enqueue_stale_photos":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"pet_limit":
{ Args: { "tier": "free"|"pro"|"max" }; Returns: number
                           },
"record_account_deleted":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"request_photo_upload":
{ Args: { "bytes": number,"content_type": string,"id": string,"pet_id": string,"view": "front"|"side"|"markings"|"extra" }; Returns: string
                           },
"update_pet":
{ Args: { "age_months"?: number,"breed"?: string,"clear_age"?: boolean,"clear_breed"?: boolean,"id": string,"name"?: string,"species"?: "dog"|"cat" }; Returns: Database["api"]['Views']["pets"]['Row']
                          SetofOptions: {
        from: "*"
        to: "pets"
        isOneToOne: true
        isSetofReturn: false
      } },
"update_profile":
{ Args: { "display_name": string }; Returns: undefined
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "api": {
          Enums: {
            
          }
        }
} as const
