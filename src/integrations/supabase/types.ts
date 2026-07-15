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
          enforce_location: boolean
          id: number
          radius_meters: number
          secret: string
          updated_at: string
          workshop_lat: number | null
          workshop_lng: number | null
        }
        Insert: {
          enforce_location?: boolean
          id?: number
          radius_meters?: number
          secret?: string
          updated_at?: string
          workshop_lat?: number | null
          workshop_lng?: number | null
        }
        Update: {
          enforce_location?: boolean
          id?: number
          radius_meters?: number
          secret?: string
          updated_at?: string
          workshop_lat?: number | null
          workshop_lng?: number | null
        }
        Relationships: []
      }
      attendances: {
        Row: {
          break_end: string | null
          break_start: string | null
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
          break_end?: string | null
          break_start?: string | null
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
          break_end?: string | null
          break_start?: string | null
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
      cashbon: {
        Row: {
          amount: number
          created_at: string
          decided_at: string | null
          decided_by: string | null
          employee_id: string
          id: string
          note: string | null
          paid_at: string | null
          request_date: string
          status: Database["public"]["Enums"]["cashbon_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          employee_id: string
          id?: string
          note?: string | null
          paid_at?: string | null
          request_date?: string
          status?: Database["public"]["Enums"]["cashbon_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          employee_id?: string
          id?: string
          note?: string | null
          paid_at?: string | null
          request_date?: string
          status?: Database["public"]["Enums"]["cashbon_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cashbon_employee_id_fkey"
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
      employee_consumption: {
        Row: {
          allowance_applied: number
          amount: number
          cashbon_id: string | null
          company_covered: number
          consumption_date: string
          created_at: string
          created_by: string | null
          deducted: boolean
          employee_charge: number
          employee_id: string
          expense_id: string | null
          id: string
          note: string | null
          payment_method: string
          payroll_id: string | null
          updated_at: string
        }
        Insert: {
          allowance_applied?: number
          amount: number
          cashbon_id?: string | null
          company_covered?: number
          consumption_date?: string
          created_at?: string
          created_by?: string | null
          deducted?: boolean
          employee_charge?: number
          employee_id: string
          expense_id?: string | null
          id?: string
          note?: string | null
          payment_method?: string
          payroll_id?: string | null
          updated_at?: string
        }
        Update: {
          allowance_applied?: number
          amount?: number
          cashbon_id?: string | null
          company_covered?: number
          consumption_date?: string
          created_at?: string
          created_by?: string | null
          deducted?: boolean
          employee_charge?: number
          employee_id?: string
          expense_id?: string | null
          id?: string
          note?: string | null
          payment_method?: string
          payroll_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_consumption_cashbon_id_fkey"
            columns: ["cashbon_id"]
            isOneToOne: false
            referencedRelation: "cashbon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_consumption_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_consumption_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_consumption_payroll_id_fkey"
            columns: ["payroll_id"]
            isOneToOne: false
            referencedRelation: "payrolls"
            referencedColumns: ["id"]
          },
        ]
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
      expenses: {
        Row: {
          affects_pnl: boolean
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by: string | null
          description: string
          expense_date: string
          id: string
          note: string | null
          payment_status: string
          updated_at: string
          vendor: string | null
        }
        Insert: {
          affects_pnl?: boolean
          amount: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description: string
          expense_date?: string
          id?: string
          note?: string | null
          payment_status?: string
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          affects_pnl?: boolean
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description?: string
          expense_date?: string
          id?: string
          note?: string | null
          payment_status?: string
          updated_at?: string
          vendor?: string | null
        }
        Relationships: []
      }
      job_logs: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_id: string
          id: string
          is_repair: boolean
          log_date: string
          note: string | null
          photo_url: string | null
          project_id: string | null
          qty: number
          rate_id: string
          repair_reason: string | null
          source_order_id: string | null
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
          is_repair?: boolean
          log_date?: string
          note?: string | null
          photo_url?: string | null
          project_id?: string | null
          qty: number
          rate_id: string
          repair_reason?: string | null
          source_order_id?: string | null
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
          is_repair?: boolean
          log_date?: string
          note?: string | null
          photo_url?: string | null
          project_id?: string | null
          qty?: number
          rate_id?: string
          repair_reason?: string | null
          source_order_id?: string | null
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
          {
            foreignKeyName: "job_logs_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      job_rates: {
        Row: {
          active: boolean
          created_at: string
          id: string
          min_amount: number
          name: string
          note: string | null
          pricing_mode: string
          rate_per_unit: number
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          min_amount?: number
          name: string
          note?: string | null
          pricing_mode?: string
          rate_per_unit: number
          unit?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          min_amount?: number
          name?: string
          note?: string | null
          pricing_mode?: string
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
      order_items: {
        Row: {
          adaptor: number
          adaptor_type: string | null
          akrilik_cost: number
          akrilik_l: number
          akrilik_p: number
          baut_fischer: number
          biaya_lainnya: number
          created_at: string
          id: string
          item_hpp: number
          kabel_cost: number
          kabel_meter: number | null
          kabel_socket_cost: number
          kabel_socket_meter: number
          kind: Database["public"]["Enums"]["order_item_kind"]
          led_cost: number
          led_meter: number
          manual_hpp: number
          manual_name: string | null
          manual_price: number
          modul: number
          notes: string | null
          order_id: string
          outdoor_cost: number | null
          position: number
          project_id: string | null
          socket_dc: number
          solder_cost: number
          source_draft_order_id: string | null
          source_ready_stock_order_id: string | null
          tempel_cost: number
          text_neon: string | null
          titik: number
          updated_at: string
        }
        Insert: {
          adaptor?: number
          adaptor_type?: string | null
          akrilik_cost?: number
          akrilik_l?: number
          akrilik_p?: number
          baut_fischer?: number
          biaya_lainnya?: number
          created_at?: string
          id?: string
          item_hpp?: number
          kabel_cost?: number
          kabel_meter?: number | null
          kabel_socket_cost?: number
          kabel_socket_meter?: number
          kind?: Database["public"]["Enums"]["order_item_kind"]
          led_cost?: number
          led_meter?: number
          manual_hpp?: number
          manual_name?: string | null
          manual_price?: number
          modul?: number
          notes?: string | null
          order_id: string
          outdoor_cost?: number | null
          position?: number
          project_id?: string | null
          socket_dc?: number
          solder_cost?: number
          source_draft_order_id?: string | null
          source_ready_stock_order_id?: string | null
          tempel_cost?: number
          text_neon?: string | null
          titik?: number
          updated_at?: string
        }
        Update: {
          adaptor?: number
          adaptor_type?: string | null
          akrilik_cost?: number
          akrilik_l?: number
          akrilik_p?: number
          baut_fischer?: number
          biaya_lainnya?: number
          created_at?: string
          id?: string
          item_hpp?: number
          kabel_cost?: number
          kabel_meter?: number | null
          kabel_socket_cost?: number
          kabel_socket_meter?: number
          kind?: Database["public"]["Enums"]["order_item_kind"]
          led_cost?: number
          led_meter?: number
          manual_hpp?: number
          manual_name?: string | null
          manual_price?: number
          modul?: number
          notes?: string | null
          order_id?: string
          outdoor_cost?: number | null
          position?: number
          project_id?: string | null
          socket_dc?: number
          solder_cost?: number
          source_draft_order_id?: string | null
          source_ready_stock_order_id?: string | null
          tempel_cost?: number
          text_neon?: string | null
          titik?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_source_draft_order_id_fkey"
            columns: ["source_draft_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_source_ready_stock_order_id_fkey"
            columns: ["source_ready_stock_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          adaptor: number
          adaptor_type: string | null
          akrilik_cost: number
          akrilik_l: number
          akrilik_p: number
          baut_fischer: number
          biaya_lainnya: number
          co_date: string | null
          created_at: string
          created_by: string | null
          dp: number
          ekspedisi: string | null
          hpp: number
          id: string
          kabel_cost: number
          kabel_meter: number | null
          kabel_socket_cost: number
          kabel_socket_meter: number
          kota: string | null
          led_cost: number
          led_meter: number
          modul: number
          no_resi: string | null
          notes: string | null
          order_no: string
          outdoor_cost: number | null
          paket: string | null
          payment: number
          picked_up_at: string | null
          picked_up_by: string | null
          profit: number
          project_id: string | null
          ready_pickup_at: string | null
          repair_cost: number
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
          biaya_lainnya?: number
          co_date?: string | null
          created_at?: string
          created_by?: string | null
          dp?: number
          ekspedisi?: string | null
          hpp?: number
          id?: string
          kabel_cost?: number
          kabel_meter?: number | null
          kabel_socket_cost?: number
          kabel_socket_meter?: number
          kota?: string | null
          led_cost?: number
          led_meter?: number
          modul?: number
          no_resi?: string | null
          notes?: string | null
          order_no: string
          outdoor_cost?: number | null
          paket?: string | null
          payment?: number
          picked_up_at?: string | null
          picked_up_by?: string | null
          profit?: number
          project_id?: string | null
          ready_pickup_at?: string | null
          repair_cost?: number
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
          biaya_lainnya?: number
          co_date?: string | null
          created_at?: string
          created_by?: string | null
          dp?: number
          ekspedisi?: string | null
          hpp?: number
          id?: string
          kabel_cost?: number
          kabel_meter?: number | null
          kabel_socket_cost?: number
          kabel_socket_meter?: number
          kota?: string | null
          led_cost?: number
          led_meter?: number
          modul?: number
          no_resi?: string | null
          notes?: string | null
          order_no?: string
          outdoor_cost?: number | null
          paket?: string | null
          payment?: number
          picked_up_at?: string | null
          picked_up_by?: string | null
          profit?: number
          project_id?: string | null
          ready_pickup_at?: string | null
          repair_cost?: number
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
            foreignKeyName: "orders_picked_up_by_fkey"
            columns: ["picked_up_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          consumption_deduction: number
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
          consumption_deduction?: number
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
          consumption_deduction?: number
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
          parent_order_id: string | null
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
          parent_order_id?: string | null
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
          parent_order_id?: string | null
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
          {
            foreignKeyName: "projects_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event: string
          id: string
          note: string | null
          order_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event: string
          id?: string
          note?: string | null
          order_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event?: string
          id?: string
          note?: string | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_carriers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
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
      approve_job_log: {
        Args: { _amount?: number; _id: string; _qty?: number; _status: string }
        Returns: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_id: string
          id: string
          is_repair: boolean
          log_date: string
          note: string | null
          photo_url: string | null
          project_id: string | null
          qty: number
          rate_id: string
          repair_reason: string | null
          source_order_id: string | null
          status: Database["public"]["Enums"]["job_log_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "job_logs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_check_in: {
        Args: { _lat?: number; _lng?: number; _token: string }
        Returns: Json
      }
      close_projects_after_pickup_delay: { Args: never; Returns: undefined }
      close_projects_for_order: {
        Args: { _order_id: string }
        Returns: undefined
      }
      courier_pickup: {
        Args: { _no_resi: string; _note?: string }
        Returns: Json
      }
      get_active_pipeline: {
        Args: never
        Returns: {
          co_date: string
          current_step: string
          customer_name: string
          cut_qty: number
          deadline: string
          ekspedisi: string
          has_cut: boolean
          has_kabel: boolean
          has_potong: boolean
          has_solder: boolean
          has_tempel: boolean
          kabel_qty: number
          no_resi: string
          order_id: string
          order_no: string
          order_status: string
          picked_up_at: string
          potong_qty: number
          project_code: string
          project_id: string
          project_title: string
          ready_pickup_at: string
          solder_qty: number
          tempel_qty: number
          total_points: number
        }[]
      }
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
      get_permanent_attendance_token: { Args: never; Returns: string }
      get_project_detail_for_worker: {
        Args: { _project_id: string }
        Returns: Json
      }
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
      get_repairable_orders: {
        Args: never
        Returns: {
          id: string
          kota: string
          order_no: string
          project_id: string
          status: string
          text_neon: string
          username: string
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
      mark_ready_pickup: { Args: { _order_id: string }; Returns: undefined }
      mark_ready_pickup_by_resi: { Args: { _no_resi: string }; Returns: Json }
      refresh_order_from_items: { Args: { _oid: string }; Returns: undefined }
      rotate_attendance_secret: { Args: never; Returns: string }
      set_attendance_note: {
        Args: { _attendance_id: string; _note: string }
        Returns: undefined
      }
      update_attendance_location: {
        Args: { _enforce: boolean; _lat: number; _lng: number; _radius: number }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "karyawan" | "kurir"
      attendance_status: "hadir" | "izin" | "sakit" | "alpa"
      cashbon_status: "pending" | "approved" | "rejected" | "paid"
      employee_type: "borongan" | "harian"
      expense_category:
        | "iklan"
        | "bahan_pokok"
        | "bahan_penunjang"
        | "operasional"
        | "gaji"
        | "utilitas"
        | "transportasi"
        | "lainnya"
        | "packing"
      job_log_status: "pending" | "approved" | "rejected"
      order_item_kind:
        | "custom"
        | "ready_stock_ref"
        | "ready_stock_manual"
        | "draft_ref"
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
      app_role: ["owner", "admin", "karyawan", "kurir"],
      attendance_status: ["hadir", "izin", "sakit", "alpa"],
      cashbon_status: ["pending", "approved", "rejected", "paid"],
      employee_type: ["borongan", "harian"],
      expense_category: [
        "iklan",
        "bahan_pokok",
        "bahan_penunjang",
        "operasional",
        "gaji",
        "utilitas",
        "transportasi",
        "lainnya",
        "packing",
      ],
      job_log_status: ["pending", "approved", "rejected"],
      order_item_kind: [
        "custom",
        "ready_stock_ref",
        "ready_stock_manual",
        "draft_ref",
      ],
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
