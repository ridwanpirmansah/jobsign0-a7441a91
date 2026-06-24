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
      attendance_settings: {
        Row: {
          id: number
          secret: string
          updated_at: string
        }
        Insert: {
          id?: number
          secret?: string
          updated_at?: string
        }
        Update: {
          id?: number
          secret?: string
          updated_at?: string
        }
        Relationships: []
      }
      attendances: {
        Row: {
          check_in: string | null
          check_out: string | null
          created_at: string
          date: string
          employee_id: string
          id: string
          note: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at: string
        }
        Insert: {
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          date?: string
          employee_id: string
          id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
        }
        Update: {
          check_in?: string | null
          check_out?: string | null
          created_at?: string
          date?: string
          employee_id?: string
          id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          note: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          note?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          note?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          active: boolean
          created_at: string
          daily_wage: number
          employee_code: string
          full_name: string
          hourly_rate: number
          id: string
          pay_unit: string
          phone: string | null
          profile_id: string | null
          type: Database["public"]["Enums"]["employee_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          daily_wage?: number
          employee_code: string
          full_name: string
          hourly_rate?: number
          id?: string
          pay_unit?: string
          phone?: string | null
          profile_id?: string | null
          type?: Database["public"]["Enums"]["employee_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          daily_wage?: number
          employee_code?: string
          full_name?: string
          hourly_rate?: number
          id?: string
          pay_unit?: string
          phone?: string | null
          profile_id?: string | null
          type?: Database["public"]["Enums"]["employee_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_logs: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_id: string
          id: string
          log_date: string
          note: string | null
          photo_url: string | null
          project_id: string | null
          qty: number
          rate_id: string
          status: Database["public"]["Enums"]["job_log_status"]
          updated_at: string
        }
        Insert: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_id: string
          id?: string
          log_date?: string
          note?: string | null
          photo_url?: string | null
          project_id?: string | null
          qty: number
          rate_id: string
          status?: Database["public"]["Enums"]["job_log_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          log_date?: string
          note?: string | null
          photo_url?: string | null
          project_id?: string | null
          qty?: number
          rate_id?: string
          status?: Database["public"]["Enums"]["job_log_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_logs_rate_id_fkey"
            columns: ["rate_id"]
            isOneToOne: false
            referencedRelation: "job_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      job_rates: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          note: string | null
          rate_per_unit: number
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          note?: string | null
          rate_per_unit: number
          unit?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          note?: string | null
          rate_per_unit?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      material_prices: {
        Row: {
          key: string
          label: string
          unit: string | null
          updated_at: string
          value: number
        }
        Insert: {
          key: string
          label: string
          unit?: string | null
          updated_at?: string
          value?: number
        }
        Update: {
          key?: string
          label?: string
          unit?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      orders: {
        Row: {
          adaptor: number
          adaptor_type: string | null
          akrilik_cost: number
          akrilik_l: number
          akrilik_p: number
          baut_fischer: number
          co_date: string | null
          created_at: string
          created_by: string | null
          dp: number
          hpp: number
          id: string
          kabel_cost: number
          kabel_meter: number
          kabel_socket_cost: number
          kabel_socket_meter: number
          karet_seal: number
          kota: string | null
          led_cost: number
          led_meter: number
          modul: number
          notes: string | null
          order_no: string
          outdoor_cost: number
          paket: string | null
          payment: number
          print_cost: number
          profit: number
          project_id: string | null
          socket_dc: number
          solder_cost: number
          source: Database["public"]["Enums"]["order_source"]
          split: number
          status: string
          tempel_cost: number
          text_neon: string
          titik: number
          updated_at: string
          username: string | null
        }
        Insert: {
          adaptor?: number
          adaptor_type?: string | null
          akrilik_cost?: number
          akrilik_l?: number
          akrilik_p?: number
          baut_fischer?: number
          co_date?: string | null
          created_at?: string
          created_by?: string | null
          dp?: number
          hpp?: number
          id?: string
          kabel_cost?: number
          kabel_meter?: number
          kabel_socket_cost?: number
          kabel_socket_meter?: number
          karet_seal?: number
          kota?: string | null
          led_cost?: number
          led_meter?: number
          modul?: number
          notes?: string | null
          order_no: string
          outdoor_cost?: number
          paket?: string | null
          payment?: number
          print_cost?: number
          profit?: number
          project_id?: string | null
          socket_dc?: number
          solder_cost?: number
          source?: Database["public"]["Enums"]["order_source"]
          split?: number
          status?: string
          tempel_cost?: number
          text_neon: string
          titik?: number
          updated_at?: string
          username?: string | null
        }
        Update: {
          adaptor?: number
          adaptor_type?: string | null
          akrilik_cost?: number
          akrilik_l?: number
          akrilik_p?: number
          baut_fischer?: number
          co_date?: string | null
          created_at?: string
          created_by?: string | null
          dp?: number
          hpp?: number
          id?: string
          kabel_cost?: number
          kabel_meter?: number
          kabel_socket_cost?: number
          kabel_socket_meter?: number
          karet_seal?: number
          kota?: string | null
          led_cost?: number
          led_meter?: number
          modul?: number
          notes?: string | null
          order_no?: string
          outdoor_cost?: number
          paket?: string | null
          payment?: number
          print_cost?: number
          profit?: number
          project_id?: string | null
          socket_dc?: number
          solder_cost?: number
          source?: Database["public"]["Enums"]["order_source"]
          split?: number
          status?: string
          tempel_cost?: number
          text_neon?: string
          titik?: number
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      payrolls: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          base: number
          bonus: number
          created_at: string
          deductions: number
          employee_id: string
          id: string
          note: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["payroll_status"]
          total: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          base?: number
          bonus?: number
          created_at?: string
          deductions?: number
          employee_id: string
          id?: string
          note?: string | null
          period_end: string
          period_start: string
          status?: Database["public"]["Enums"]["payroll_status"]
          total?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          base?: number
          bonus?: number
          created_at?: string
          deductions?: number
          employee_id?: string
          id?: string
          note?: string | null
          period_end?: string
          period_start?: string
          status?: Database["public"]["Enums"]["payroll_status"]
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payrolls_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_assignments: {
        Row: {
          assigned_at: string
          employee_id: string
          id: string
          project_id: string
        }
        Insert: {
          assigned_at?: string
          employee_id: string
          id?: string
          project_id: string
        }
        Update: {
          assigned_at?: string
          employee_id?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          code: string
          contract_value: number
          created_at: string
          customer_id: string | null
          deadline: string | null
          description: string | null
          id: string
          status: Database["public"]["Enums"]["project_status"]
          title: string
          total_points: number
          updated_at: string
        }
        Insert: {
          code: string
          contract_value?: number
          created_at?: string
          customer_id?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          status?: Database["public"]["Enums"]["project_status"]
          title: string
          total_points?: number
          updated_at?: string
        }
        Update: {
          code?: string
          contract_value?: number
          created_at?: string
          customer_id?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          status?: Database["public"]["Enums"]["project_status"]
          title?: string
          total_points?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_settings: {
        Row: {
          created_at: string
          enabled: boolean
          header_row: number
          id: number
          last_sync_at: string | null
          last_sync_inserted: number | null
          last_sync_message: string | null
          last_sync_skipped: number | null
          last_sync_status: string | null
          last_sync_updated: number | null
          mapping: Json
          sheet_name: string | null
          spreadsheet_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          header_row?: number
          id?: number
          last_sync_at?: string | null
          last_sync_inserted?: number | null
          last_sync_message?: string | null
          last_sync_skipped?: number | null
          last_sync_status?: string | null
          last_sync_updated?: number | null
          mapping?: Json
          sheet_name?: string | null
          spreadsheet_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          header_row?: number
          id?: number
          last_sync_at?: string | null
          last_sync_inserted?: number | null
          last_sync_message?: string | null
          last_sync_skipped?: number | null
          last_sync_status?: string | null
          last_sync_updated?: number | null
          mapping?: Json
          sheet_name?: string | null
          spreadsheet_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      attendance_check_in: { Args: { _token: string }; Returns: Json }
      get_attendance_secret: { Args: never; Returns: string }
      get_available_projects: {
        Args: never
        Returns: {
          claimed_points: number
          code: string
          id: string
          remaining_points: number
          status: Database["public"]["Enums"]["project_status"]
          title: string
          total_points: number
        }[]
      }
      get_daily_attendance_token: { Args: { _date?: string }; Returns: string }
      get_project_rate_availability: {
        Args: { _project_id: string }
        Returns: {
          claimed_points: number
          rate_id: string
          rate_name: string
          rate_per_unit: number
          remaining_points: number
          total_points: number
          unit: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_owner: { Args: { _user_id: string }; Returns: boolean }
      rotate_attendance_secret: { Args: never; Returns: string }
      set_attendance_note: {
        Args: { _attendance_id: string; _note: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "karyawan"
      attendance_status: "hadir" | "izin" | "sakit" | "alpa"
      employee_type: "borongan" | "harian"
      job_log_status: "pending" | "approved" | "rejected"
      order_source:
        | "shopee"
        | "tiktok"
        | "tokopedia"
        | "lazada"
        | "direct"
        | "lainnya"
      payroll_status: "draft" | "approved" | "paid"
      project_status: "draft" | "active" | "done" | "cancelled"
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
    Enums: {
      app_role: ["owner", "admin", "karyawan"],
      attendance_status: ["hadir", "izin", "sakit", "alpa"],
      employee_type: ["borongan", "harian"],
      job_log_status: ["pending", "approved", "rejected"],
      order_source: [
        "shopee",
        "tiktok",
        "tokopedia",
        "lazada",
        "direct",
        "lainnya",
      ],
      payroll_status: ["draft", "approved", "paid"],
      project_status: ["draft", "active", "done", "cancelled"],
    },
  },
} as const
