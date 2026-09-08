-- =====================================================================
-- SNAPSHOT STRUKTUR DATABASE (schema.sql)
-- Dibuat otomatis dari kondisi database yang sedang berjalan.
--
-- CARA PAKAI:
--   1. Gunakan project Supabase BARU / KOSONG.
--   2. Salin SELURUH isi berkas ini ke SQL Editor, klik Run SEKALI.
--
-- Jangan dijalankan di database yang sudah berisi tabel dari percobaan
-- sebelumnya. Kosongkan dulu dengan:
--   drop schema public cascade; create schema public;
--   grant usage on schema public to anon, authenticated, service_role;
--
-- Berkas ini menggantikan supabase/all_migrations.sql (riwayat migrasi
-- berurutan yang tidak bisa dijalankan sekaligus).
-- =====================================================================

--
-- PostgreSQL database dump
--


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'owner',
    'admin',
    'karyawan',
    'kurir'
);


--
-- Name: attendance_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attendance_status AS ENUM (
    'hadir',
    'izin',
    'sakit',
    'alpa'
);


--
-- Name: cashbon_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cashbon_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'paid'
);


--
-- Name: employee_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.employee_type AS ENUM (
    'borongan',
    'harian'
);


--
-- Name: expense_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.expense_category AS ENUM (
    'iklan',
    'bahan_pokok',
    'bahan_penunjang',
    'operasional',
    'gaji',
    'utilitas',
    'transportasi',
    'lainnya',
    'packing'
);


--
-- Name: job_log_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.job_log_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: order_item_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_item_kind AS ENUM (
    'custom',
    'ready_stock_ref',
    'ready_stock_manual',
    'draft_ref'
);


--
-- Name: order_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.order_source AS ENUM (
    'shopee',
    'tiktok',
    'tokopedia',
    'lazada',
    'direct',
    'lainnya'
);


--
-- Name: payroll_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payroll_status AS ENUM (
    'draft',
    'approved',
    'paid'
);


--
-- Name: project_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.project_status AS ENUM (
    'draft',
    'active',
    'done',
    'cancelled'
);


--
-- Name: absorb_referenced_draft(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.absorb_referenced_draft() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  parent RECORD;
  draft_ord RECORD;
  new_no text;
  max_dr int;
  released_id uuid;
BEGIN
  -- Handle DELETE or unlink on UPDATE: release old draft
  IF (TG_OP = 'DELETE') OR
     (TG_OP = 'UPDATE' AND (OLD.kind = 'draft_ref') AND
       (NEW.kind <> 'draft_ref' OR NEW.source_draft_order_id IS DISTINCT FROM OLD.source_draft_order_id))
  THEN
    released_id := OLD.source_draft_order_id;
    IF released_id IS NOT NULL THEN
      -- Only revert if this order really was the absorber
      IF EXISTS (SELECT 1 FROM public.orders WHERE id = released_id AND parent_order_id = OLD.order_id) THEN
        SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
          INTO max_dr
          FROM public.orders
          WHERE status = 'draft' AND order_no ~ '^DR-\d+$';
        UPDATE public.orders
          SET status = 'draft',
              order_no = 'DR-' || (max_dr + 1)::text,
              parent_order_id = NULL,
              updated_at = now()
          WHERE id = released_id;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Absorb on INSERT/UPDATE where kind=draft_ref
  IF NEW.kind = 'draft_ref' AND NEW.source_draft_order_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.orders WHERE id = NEW.order_id;
    IF parent.id IS NOT NULL AND parent.status IN ('active','return','ready_stock') THEN
      SELECT * INTO draft_ord FROM public.orders WHERE id = NEW.source_draft_order_id;
      IF draft_ord.id IS NOT NULL AND draft_ord.status = 'draft' THEN
        new_no := COALESCE(NULLIF(parent.order_no,''),'ORD') || '-D' || NEW.position::text;
        UPDATE public.orders
          SET status = parent.status,
              order_no = new_no,
              parent_order_id = parent.id,
              updated_at = now()
          WHERE id = draft_ord.id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $_$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: job_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    project_id uuid,
    rate_id uuid NOT NULL,
    log_date date DEFAULT CURRENT_DATE NOT NULL,
    qty numeric(10,2) NOT NULL,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    note text,
    photo_url text,
    status public.job_log_status DEFAULT 'pending'::public.job_log_status NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_repair boolean DEFAULT false NOT NULL,
    repair_reason text,
    source_order_id uuid,
    CONSTRAINT job_logs_qty_check CHECK ((qty > (0)::numeric))
);


--
-- Name: approve_job_log(uuid, text, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_job_log(_id uuid, _status text, _qty numeric DEFAULT NULL::numeric, _amount numeric DEFAULT NULL::numeric) RETURNS public.job_logs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE row public.job_logs;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya admin/owner';
  END IF;
  IF _status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Status tidak valid';
  END IF;

  -- Update qty dulu (trigger calc_job_log_amount akan hitung amount = qty * rate)
  IF _qty IS NOT NULL THEN
    IF _qty <= 0 THEN RAISE EXCEPTION 'Qty harus lebih dari 0'; END IF;
    UPDATE public.job_logs SET qty = _qty WHERE id = _id;
  END IF;

  -- Override amount jika diberikan
  IF _amount IS NOT NULL THEN
    IF _amount < 0 THEN RAISE EXCEPTION 'Nominal tidak boleh negatif'; END IF;
    UPDATE public.job_logs SET amount = _amount WHERE id = _id;
  END IF;

  UPDATE public.job_logs
     SET status = _status::job_log_status,
         approved_by = auth.uid(),
         approved_at = now()
   WHERE id = _id
   RETURNING * INTO row;

  RETURN row;
END $$;


--
-- Name: assign_order_no(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_order_no() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE max_no int; max_rs int; max_dr int; is_rs boolean; is_dr boolean;
BEGIN
  IF NEW.status = 'draft' THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' OR NOT (NEW.order_no ~* '^DR-\d+$') THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
        INTO max_dr
        FROM public.orders
        WHERE order_no ~ '^DR-\d+$'
          AND (TG_OP = 'INSERT' OR id <> NEW.id);
      NEW.order_no := 'DR-' || (max_dr + 1)::text;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'ready_stock' THEN
    IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
        INTO max_rs
        FROM public.orders
        WHERE order_no ~ '^RS-\d+$'
          AND (TG_OP = 'INSERT' OR id <> NEW.id);
      NEW.order_no := 'RS-' || (max_rs + 1)::text;
    END IF;
    RETURN NEW;
  END IF;

  -- active/return
  is_rs := NEW.order_no ~* '^RS-';
  is_dr := NEW.order_no ~* '^DR-';
  IF NEW.order_no IS NULL OR btrim(NEW.order_no) = '' OR btrim(NEW.order_no) = '0' OR is_rs OR is_dr THEN
    -- Cari nomor terbesar dari SEMUA order bernomor angka (tanpa memandang status),
    -- supaya tidak bentrok dengan ready stock/draft yang memakai nomor angka biasa.
    SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no, '\D', '', 'g'), '')::int), 0)
      INTO max_no
      FROM public.orders
      WHERE order_no !~* '^RS-'
        AND order_no !~* '^DR-'
        AND order_no !~ '-D\d+$'
        AND order_no ~ '^\d+$'
        AND (TG_OP = 'INSERT' OR id <> NEW.id);
    NEW.order_no := (max_no + 1)::text;
  END IF;
  RETURN NEW;
END $_$;


--
-- Name: attendance_check_in(text, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attendance_check_in(_token text, _lat double precision DEFAULT NULL::double precision, _lng double precision DEFAULT NULL::double precision) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  s text; win bigint; w bigint; expected text; is_valid boolean := false;
  emp_id uuid;
  now_ts timestamptz := now();
  today_date date := (now_ts AT TIME ZONE 'Asia/Jakarta')::date;
  rec record;
  action text;
  mins_since_last numeric;
  last_ts timestamptz;
  min_gap_min numeric := 10;
  daily_date text; daily_sig text; daily_expected text;
  perm_sig text; perm_expected text;
  ws_lat double precision; ws_lng double precision; ws_radius integer; ws_enforce boolean;
  d_meters double precision;
  rad_lat1 double precision; rad_lat2 double precision; rad_dlat double precision; rad_dlng double precision;
  a_h double precision;
BEGIN
  IF _token IS NULL OR length(_token) < 6 THEN RAISE EXCEPTION 'Token tidak valid'; END IF;
  SELECT secret, workshop_lat, workshop_lng, radius_meters, enforce_location
    INTO s, ws_lat, ws_lng, ws_radius, ws_enforce
    FROM public.attendance_settings WHERE id = 1;

  IF COALESCE(ws_enforce, false) THEN
    IF ws_lat IS NULL OR ws_lng IS NULL THEN
      RAISE EXCEPTION 'Lokasi workshop belum diatur oleh admin';
    END IF;
    IF _lat IS NULL OR _lng IS NULL THEN
      RAISE EXCEPTION 'Izinkan akses lokasi pada perangkat Anda untuk melakukan absensi';
    END IF;
    rad_lat1 := radians(ws_lat);
    rad_lat2 := radians(_lat);
    rad_dlat := radians(_lat - ws_lat);
    rad_dlng := radians(_lng - ws_lng);
    a_h := sin(rad_dlat/2)^2 + cos(rad_lat1) * cos(rad_lat2) * sin(rad_dlng/2)^2;
    d_meters := 6371000 * 2 * atan2(sqrt(a_h), sqrt(1 - a_h));
    IF d_meters > ws_radius THEN
      RAISE EXCEPTION 'Anda berada % meter dari workshop (maks % meter). Silakan mendekat ke lokasi.', round(d_meters)::int, ws_radius;
    END IF;
  END IF;

  IF _token LIKE 'PRM:%' THEN
    perm_sig := split_part(_token, ':', 2);
    perm_expected := substr(encode(extensions.hmac('PERMANENT', s, 'sha256'), 'hex'), 1, 24);
    IF perm_sig IS NOT NULL AND perm_sig = perm_expected THEN
      is_valid := true;
    ELSE
      RAISE EXCEPTION 'QR permanen tidak valid';
    END IF;
  ELSIF _token LIKE 'DLY:%' THEN
    daily_date := split_part(_token, ':', 2);
    daily_sig  := split_part(_token, ':', 3);
    IF daily_date IS NULL OR length(daily_date) <> 8 OR daily_sig IS NULL OR length(daily_sig) <> 16 THEN
      RAISE EXCEPTION 'QR harian tidak valid';
    END IF;
    IF daily_date <> to_char(today_date, 'YYYYMMDD') THEN
      RAISE EXCEPTION 'QR harian sudah kadaluarsa (hanya berlaku untuk tanggal %)', daily_date;
    END IF;
    daily_expected := substr(encode(extensions.hmac('DAILY:' || daily_date, s, 'sha256'), 'hex'), 1, 16);
    IF daily_expected = daily_sig THEN
      is_valid := true;
    ELSE
      RAISE EXCEPTION 'QR harian tidak valid';
    END IF;
  ELSE
    win := floor(extract(epoch FROM now_ts) / 10)::bigint;
    FOR w IN win-1..win+1 LOOP
      expected := substr(encode(extensions.hmac(w::text, s, 'sha256'), 'hex'), 1, 10);
      IF expected = _token THEN is_valid := true; EXIT; END IF;
    END LOOP;
    IF NOT is_valid THEN RAISE EXCEPTION 'QR kadaluarsa, silakan scan ulang'; END IF;
  END IF;

  SELECT id INTO emp_id FROM public.employees WHERE profile_id = auth.uid() AND active = true LIMIT 1;
  IF emp_id IS NULL THEN RAISE EXCEPTION 'Akun Anda belum terhubung ke data karyawan aktif'; END IF;

  SELECT * INTO rec FROM public.attendances WHERE employee_id = emp_id AND date = today_date;

  IF rec.id IS NULL THEN
    INSERT INTO public.attendances(employee_id, date, check_in, status)
      VALUES (emp_id, today_date, now_ts, 'hadir')
      RETURNING * INTO rec;
    action := 'check_in';
  ELSIF rec.check_out IS NULL AND rec.break_start IS NULL THEN
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - rec.check_in)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = rec.id;
    action := 'check_out';
  ELSIF rec.check_out IS NOT NULL AND rec.break_start IS NULL THEN
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - rec.check_out)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances
      SET break_start = rec.check_out,
          break_end   = now_ts,
          check_out   = NULL
      WHERE id = rec.id;
    action := 'break_end';
  ELSIF rec.break_end IS NOT NULL AND rec.check_out IS NULL THEN
    last_ts := COALESCE(rec.break_end, rec.check_in);
    mins_since_last := EXTRACT(EPOCH FROM (now_ts - last_ts)) / 60.0;
    IF mins_since_last < min_gap_min THEN
      RAISE EXCEPTION 'Tunggu minimal % menit sejak scan terakhir. Sisa: % menit', min_gap_min, CEIL(min_gap_min - mins_since_last);
    END IF;
    UPDATE public.attendances SET check_out = now_ts WHERE id = rec.id;
    action := 'check_out_final';
  ELSE
    RAISE EXCEPTION 'Anda sudah menyelesaikan absensi hari ini';
  END IF;

  RETURN jsonb_build_object('action', action, 'attendance_id', rec.id, 'time', now_ts);
END $$;


--
-- Name: calc_consumption_split(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calc_consumption_split() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE default_allowance numeric;
BEGIN
  IF NEW.allowance_applied IS NULL OR NEW.allowance_applied <= 0 THEN
    SELECT value INTO default_allowance FROM public.material_prices WHERE key='meal_allowance_per_person';
    NEW.allowance_applied := COALESCE(default_allowance, 0);
  END IF;
  NEW.company_covered := LEAST(NEW.amount, NEW.allowance_applied);
  IF NEW.payment_method = 'cash' THEN
    NEW.employee_charge := 0;
  ELSE
    NEW.employee_charge := GREATEST(NEW.amount - NEW.allowance_applied, 0);
  END IF;
  RETURN NEW;
END $$;


--
-- Name: calc_job_log_amount(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calc_job_log_amount() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  r numeric;
  m numeric;
  mode text;
  scope text;
  base numeric;
  area_qty numeric;
  parent_oid uuid;
BEGIN
  SELECT rate_per_unit, COALESCE(min_amount,0), COALESCE(pricing_mode,'per_unit'), COALESCE(area_scope,'project')
    INTO r, m, mode, scope
    FROM public.job_rates
    WHERE id = NEW.rate_id;

  IF mode = 'area' AND NEW.project_id IS NOT NULL AND COALESCE(NEW.is_repair, false) = false THEN
    IF scope = 'order' THEN
      SELECT p.parent_order_id INTO parent_oid FROM public.projects p WHERE p.id = NEW.project_id;
      IF parent_oid IS NULL THEN
        RAISE EXCEPTION 'Project belum terhubung ke order, tidak bisa menghitung total area order.';
      END IF;
      -- Sum area across all items with dimensions; fallback to order header
      SELECT COALESCE(SUM(COALESCE(NULLIF(oi.akrilik_p,0),0) * COALESCE(NULLIF(oi.akrilik_l,0),0)), 0)
        INTO area_qty
        FROM public.order_items oi
        WHERE oi.order_id = parent_oid;
      IF area_qty IS NULL OR area_qty <= 0 THEN
        SELECT COALESCE(o.akrilik_p,0) * COALESCE(o.akrilik_l,0) INTO area_qty
          FROM public.orders o WHERE o.id = parent_oid;
      END IF;
      IF area_qty IS NULL OR area_qty <= 0 THEN
        RAISE EXCEPTION 'Ukuran akrilik pada order belum diisi. Lengkapi Akrilik P dan L sebelum klaim garapan area.';
      END IF;
      NEW.qty := area_qty;
    ELSE
      SELECT COALESCE(NULLIF(o.akrilik_p, 0), NULLIF(oi.akrilik_p, 0), 0)
           * COALESCE(NULLIF(o.akrilik_l, 0), NULLIF(oi.akrilik_l, 0), 0)
        INTO area_qty
        FROM public.projects p
        LEFT JOIN public.orders o ON o.id = p.parent_order_id
        LEFT JOIN LATERAL (
          SELECT akrilik_p, akrilik_l
          FROM public.order_items
          WHERE order_id = p.parent_order_id
            AND COALESCE(akrilik_p, 0) > 0
            AND COALESCE(akrilik_l, 0) > 0
          ORDER BY position NULLS LAST, created_at ASC
          LIMIT 1
        ) oi ON true
        WHERE p.id = NEW.project_id;

      IF area_qty IS NULL OR area_qty <= 0 THEN
        RAISE EXCEPTION 'Ukuran akrilik pada order belum diisi. Lengkapi Akrilik P dan L sebelum klaim garapan area.';
      END IF;
      NEW.qty := area_qty;
    END IF;
  END IF;

  base := COALESCE(r,0) * COALESCE(NEW.qty,0);
  NEW.amount := CASE WHEN m > 0 THEN GREATEST(base, m) ELSE base END;
  RETURN NEW;
END;
$$;


--
-- Name: calc_order_costs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calc_order_costs() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  led_rate numeric; akr_rate numeric; sol_rate numeric;
  tem_rate numeric; kab_rate numeric; ksk_rate numeric;
  base_hpp numeric; item_count int := 0;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT COUNT(*) INTO item_count FROM public.order_items WHERE order_id = NEW.id;
  END IF;

  IF item_count > 0 THEN
    -- Items-driven: profit derived from existing hpp (aggregated) + repair
    NEW.hpp := (SELECT COALESCE(SUM(item_hpp),0) FROM public.order_items WHERE order_id = NEW.id)
               + COALESCE(NEW.repair_cost,0);
    NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Legacy path (order without items): original logic
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';
  SELECT value INTO ksk_rate FROM public.material_prices WHERE key='kabel_socket_per_meter';
  IF NEW.kabel_meter IS NULL THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;
  IF NEW.outdoor_cost IS NULL THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;
  IF NEW.kabel_socket_meter IS NULL THEN NEW.kabel_socket_meter := 1; END IF;
  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));
  NEW.kabel_socket_cost := ROUND(NEW.kabel_socket_meter * COALESCE(ksk_rate,0));
  base_hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.kabel_socket_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0)
           + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.biaya_lainnya := ROUND(base_hpp * 0.01);
  NEW.hpp := base_hpp + COALESCE(NEW.biaya_lainnya,0) + COALESCE(NEW.repair_cost,0);
  NEW.profit := COALESCE(NEW.payment,0) + COALESCE(NEW.split,0) - NEW.hpp;
  NEW.updated_at := now();
  RETURN NEW;
END $$;


--
-- Name: calc_order_item_costs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calc_order_item_costs() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  led_rate numeric; akr_rate numeric; sol_rate numeric;
  tem_rate numeric; kab_rate numeric; ksk_rate numeric;
  base_hpp numeric;
BEGIN
  IF NEW.kind = 'ready_stock_manual' THEN
    NEW.led_cost := 0; NEW.akrilik_cost := 0; NEW.solder_cost := 0;
    NEW.tempel_cost := 0; NEW.kabel_cost := 0; NEW.kabel_socket_cost := 0;
    NEW.biaya_lainnya := 0;
    NEW.item_hpp := COALESCE(NEW.manual_hpp, 0);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.kind = 'ready_stock_ref' THEN
    SELECT COALESCE(o.hpp, 0) INTO base_hpp
      FROM public.orders o WHERE o.id = NEW.source_ready_stock_order_id;
    NEW.led_cost := 0; NEW.akrilik_cost := 0; NEW.solder_cost := 0;
    NEW.tempel_cost := 0; NEW.kabel_cost := 0; NEW.kabel_socket_cost := 0;
    NEW.biaya_lainnya := 0;
    NEW.item_hpp := COALESCE(base_hpp, 0);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.kind = 'draft_ref' THEN
    SELECT COALESCE(o.hpp, 0) INTO base_hpp
      FROM public.orders o WHERE o.id = NEW.source_draft_order_id;
    NEW.led_cost := 0; NEW.akrilik_cost := 0; NEW.solder_cost := 0;
    NEW.tempel_cost := 0; NEW.kabel_cost := 0; NEW.kabel_socket_cost := 0;
    NEW.biaya_lainnya := 0;
    NEW.item_hpp := COALESCE(base_hpp, 0);
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- kind = custom
  SELECT value INTO led_rate FROM public.material_prices WHERE key='led_per_meter';
  SELECT value INTO akr_rate FROM public.material_prices WHERE key='akrilik_per_cm2';
  SELECT value INTO sol_rate FROM public.material_prices WHERE key='solder_per_titik';
  SELECT value INTO tem_rate FROM public.material_prices WHERE key='tempel_per_titik';
  SELECT value INTO kab_rate FROM public.material_prices WHERE key='kabel_per_meter';
  SELECT value INTO ksk_rate FROM public.material_prices WHERE key='kabel_socket_per_meter';

  IF NEW.kabel_meter IS NULL THEN
    NEW.kabel_meter := ROUND((((NEW.led_meter/4.0)*3) + 1.5 + ((NEW.titik*5.0)/100))::numeric, 2);
  END IF;
  IF NEW.outdoor_cost IS NULL THEN
    NEW.outdoor_cost := COALESCE(NEW.titik,0) * 2000;
  END IF;
  IF NEW.kabel_socket_meter IS NULL THEN NEW.kabel_socket_meter := 1; END IF;

  NEW.led_cost := ROUND(NEW.led_meter * COALESCE(led_rate,0));
  NEW.akrilik_cost := ROUND(NEW.akrilik_p * NEW.akrilik_l * COALESCE(akr_rate,0));
  NEW.solder_cost := ROUND(NEW.titik * COALESCE(sol_rate,0));
  NEW.tempel_cost := ROUND(NEW.titik * COALESCE(tem_rate,0));
  NEW.kabel_cost := ROUND(NEW.kabel_meter * COALESCE(kab_rate,0));
  NEW.kabel_socket_cost := ROUND(NEW.kabel_socket_meter * COALESCE(ksk_rate,0));

  base_hpp := COALESCE(NEW.led_cost,0) + COALESCE(NEW.akrilik_cost,0) + COALESCE(NEW.solder_cost,0)
           + COALESCE(NEW.tempel_cost,0) + COALESCE(NEW.kabel_cost,0)
           + COALESCE(NEW.kabel_socket_cost,0)
           + COALESCE(NEW.adaptor,0) + COALESCE(NEW.modul,0)
           + COALESCE(NEW.socket_dc,0) + COALESCE(NEW.baut_fischer,0)
           + COALESCE(NEW.outdoor_cost,0);
  NEW.biaya_lainnya := ROUND(base_hpp * 0.01);
  NEW.item_hpp := base_hpp + COALESCE(NEW.biaya_lainnya,0);
  NEW.updated_at := now();
  RETURN NEW;
END $$;


--
-- Name: close_projects_after_pickup_delay(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_projects_after_pickup_delay() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.projects p
    SET status = 'done', updated_at = now()
    WHERE p.status IN ('draft','active')
      AND p.id IN (
        SELECT o.project_id FROM public.orders o
          WHERE o.picked_up_at IS NOT NULL
            AND o.picked_up_at <= now() - interval '48 hours'
            AND o.project_id IS NOT NULL
            AND o.status::text NOT IN ('ready_stock','draft')
        UNION
        SELECT oi.project_id FROM public.order_items oi
          JOIN public.orders o ON o.id = oi.order_id
          WHERE o.picked_up_at IS NOT NULL
            AND o.picked_up_at <= now() - interval '48 hours'
            AND oi.project_id IS NOT NULL
            AND o.status::text NOT IN ('ready_stock','draft')
      );
END $$;


--
-- Name: close_projects_for_order(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_projects_for_order(_order_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.projects p
    SET status = 'done', updated_at = now()
    WHERE p.status IN ('draft','active')
      AND p.id IN (
        SELECT project_id FROM public.orders WHERE id = _order_id AND project_id IS NOT NULL
        UNION
        SELECT project_id FROM public.order_items WHERE order_id = _order_id AND project_id IS NOT NULL
      );
END $$;


--
-- Name: consume_stock_source(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_stock_source(_source_order_id uuid, _item_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  src_proj uuid;
  new_item RECORD;
  new_ord RECORD;
  new_proj uuid;
  hist text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO new_item FROM public.order_items WHERE id = _item_id;
  IF new_item.id IS NULL THEN RETURN; END IF;
  SELECT * INTO new_ord FROM public.orders WHERE id = new_item.order_id;

  SELECT oi.project_id INTO src_proj
    FROM public.order_items oi
    WHERE oi.order_id = _source_order_id AND oi.project_id IS NOT NULL
    ORDER BY oi.position LIMIT 1;
  IF src_proj IS NULL THEN
    SELECT id INTO src_proj FROM public.projects
      WHERE parent_order_id = _source_order_id ORDER BY created_at LIMIT 1;
  END IF;

  SELECT string_agg(COALESCE(NULLIF(oi.text_neon,''), NULLIF(oi.manual_name,''), 'Item'), ' | ' ORDER BY oi.position)
    INTO hist FROM public.order_items oi WHERE oi.order_id = _source_order_id;
  IF hist IS NULL OR hist = '' THEN
    SELECT text_neon INTO hist FROM public.orders WHERE id = _source_order_id;
  END IF;

  new_proj := new_item.project_id;

  IF src_proj IS NOT NULL THEN
    UPDATE public.order_items SET project_id = src_proj WHERE id = _item_id;

    IF new_proj IS NOT NULL AND new_proj <> src_proj THEN
      IF NOT EXISTS (SELECT 1 FROM public.job_logs WHERE project_id = new_proj) THEN
        UPDATE public.orders SET project_id = NULL WHERE project_id = new_proj;
        DELETE FROM public.projects WHERE id = new_proj;
      END IF;
    END IF;

    UPDATE public.projects
      SET title = COALESCE(NULLIF(new_item.text_neon,''), title),
          parent_order_id = new_ord.id,
          deadline = new_ord.deadline,
          status = CASE WHEN status = 'done' THEN 'active'::project_status ELSE status END,
          updated_at = now()
      WHERE id = src_proj;
  END IF;

  DELETE FROM public.order_items WHERE order_id = _source_order_id;

  UPDATE public.orders
    SET hpp = 0,
        titik = 0,
        led_meter = 0,
        akrilik_p = 0,
        akrilik_l = 0,
        repair_cost = 0,
        project_id = NULL,
        consumed_at = now(),
        text_neon = COALESCE(NULLIF(hist,''), 'Produk') || ' — dipindah ke ' || COALESCE(NULLIF(new_ord.order_no,''),'order baru'),
        profit = COALESCE(payment,0) + COALESCE(split,0),
        updated_at = now()
    WHERE id = _source_order_id;
END $$;


--
-- Name: courier_pickup(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.courier_pickup(_no_resi text, _note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE ord RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(),'kurir') AND NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: hanya kurir';
  END IF;
  IF _no_resi IS NULL OR btrim(_no_resi) = '' THEN
    RAISE EXCEPTION 'No Resi wajib diisi';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE no_resi = btrim(_no_resi) LIMIT 1;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'Resi tidak ditemukan'; END IF;
  IF ord.ready_pickup_at IS NULL THEN
    RAISE EXCEPTION 'Paket belum ditandai siap pickup oleh admin';
  END IF;
  IF ord.picked_up_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paket sudah diambil pada %', to_char(ord.picked_up_at,'DD Mon YYYY HH24:MI');
  END IF;
  UPDATE public.orders
    SET picked_up_at = now(), picked_up_by = auth.uid(), updated_at = now()
    WHERE id = ord.id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (ord.id, 'picked_up', auth.uid(), _note);
  RETURN jsonb_build_object('order_id', ord.id, 'order_no', ord.order_no, 'ekspedisi', ord.ekspedisi);
END $$;


--
-- Name: detach_project_from_order(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detach_project_from_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  pid uuid;
  oid uuid;
BEGIN
  pid := OLD.project_id; oid := OLD.order_id;

  IF TG_OP = 'UPDATE' AND pid IS NOT DISTINCT FROM NEW.project_id THEN
    RETURN NEW;
  END IF;

  IF pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.project_id = pid) THEN
    UPDATE public.orders SET project_id = NULL WHERE id = oid AND project_id = pid;
    UPDATE public.projects
      SET parent_order_id = NULL,
          status = CASE WHEN status = 'cancelled' THEN status ELSE 'active'::project_status END
      WHERE id = pid;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


--
-- Name: detach_projects_on_order_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detach_projects_on_order_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.projects
    SET parent_order_id = NULL,
        status = CASE WHEN status = 'cancelled' THEN status ELSE 'active'::project_status END
  WHERE parent_order_id = OLD.id;
  RETURN OLD;
END;
$$;


--
-- Name: enforce_project_point_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_project_point_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  total int;
  claimed numeric;
  mode text;
BEGIN
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(pricing_mode,'per_unit') INTO mode
  FROM public.job_rates
  WHERE id = NEW.rate_id;

  IF mode = 'area' THEN RETURN NEW; END IF;

  SELECT total_points INTO total FROM public.projects WHERE id = NEW.project_id;
  IF total IS NULL OR total <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(qty), 0) INTO claimed
  FROM public.job_logs
  WHERE project_id = NEW.project_id
    AND rate_id = NEW.rate_id
    AND status <> 'rejected'
    AND COALESCE(is_repair,false) = false
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF (claimed + NEW.qty) > total THEN
    RAISE EXCEPTION 'Sisa titik untuk tarif ini tidak cukup. Total: %, sudah diklaim: %, sisa: %', total, claimed, GREATEST(total - claimed, 0);
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_single_area_claim(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_single_area_claim() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  mode text;
  scope text;
  existing_emp uuid;
  existing_name text;
  parent_oid uuid;
BEGIN
  IF NEW.project_id IS NULL OR NEW.rate_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_repair, false) THEN RETURN NEW; END IF;

  SELECT COALESCE(pricing_mode,'per_unit'), COALESCE(area_scope,'project')
    INTO mode, scope
  FROM public.job_rates
  WHERE id = NEW.rate_id;

  IF mode <> 'area' THEN RETURN NEW; END IF;

  IF scope = 'order' THEN
    SELECT parent_order_id INTO parent_oid FROM public.projects WHERE id = NEW.project_id;
    IF parent_oid IS NOT NULL THEN
      SELECT jl.employee_id INTO existing_emp
      FROM public.job_logs jl
      JOIN public.projects p ON p.id = jl.project_id
      WHERE p.parent_order_id = parent_oid
        AND jl.rate_id = NEW.rate_id
        AND jl.status <> 'rejected'
        AND COALESCE(jl.is_repair,false) = false
        AND (TG_OP = 'INSERT' OR jl.id <> NEW.id)
      LIMIT 1;
    ELSE
      existing_emp := NULL;
    END IF;
  ELSE
    SELECT jl.employee_id INTO existing_emp
    FROM public.job_logs jl
    WHERE jl.project_id = NEW.project_id
      AND jl.rate_id = NEW.rate_id
      AND jl.status <> 'rejected'
      AND COALESCE(jl.is_repair,false) = false
      AND (TG_OP = 'INSERT' OR jl.id <> NEW.id)
    LIMIT 1;
  END IF;

  IF existing_emp IS NOT NULL THEN
    SELECT full_name INTO existing_name FROM public.employees WHERE id = existing_emp;
    RAISE EXCEPTION 'Jenis garapan ini sudah diklaim oleh % pada order ini. Hanya 1 karyawan yang boleh mengklaim.', COALESCE(existing_name, 'karyawan lain');
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: get_active_pipeline(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_pipeline() RETURNS TABLE(project_id uuid, project_code text, project_title text, customer_name text, total_points integer, deadline date, order_id uuid, order_no text, order_status text, co_date date, ekspedisi text, no_resi text, ready_pickup_at timestamp with time zone, picked_up_at timestamp with time zone, packing_kayu boolean, use_outdoor boolean, has_cut boolean, has_potong boolean, has_solder boolean, has_kabel boolean, has_tempel boolean, cut_qty numeric, potong_qty numeric, solder_qty numeric, kabel_qty numeric, tempel_qty numeric, current_step text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH claims AS (
    SELECT
      jl.project_id,
      lower(r.name) AS rname,
      COALESCE(r.pricing_mode,'per_unit') AS mode,
      COALESCE(SUM(jl.qty),0)::numeric AS qty
    FROM public.job_logs jl
    JOIN public.job_rates r ON r.id = jl.rate_id
    WHERE jl.status <> 'rejected' AND COALESCE(jl.is_repair,false) = false
    GROUP BY jl.project_id, r.name, r.pricing_mode
  ),
  order_outdoor AS (
    SELECT o.id AS order_id,
      COALESCE(BOOL_OR(COALESCE(o.outdoor_cost,0) > 0), false)
        OR COALESCE(BOOL_OR(COALESCE(oi.outdoor_cost,0) > 0), false) AS use_outdoor
    FROM public.orders o
    LEFT JOIN public.order_items oi ON oi.order_id = o.id
    GROUP BY o.id
  ),
  agg AS (
    SELECT
      p.id AS project_id, p.code AS project_code, p.title AS project_title,
      c.name AS customer_name, p.total_points, p.deadline,
      o.id AS order_id, o.order_no, o.status::text AS order_status,
      o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at,
      COALESCE(o.packing_kayu, false) AS packing_kayu,
      COALESCE(oo.use_outdoor, false) AS use_outdoor,
      COALESCE(BOOL_OR(cl.mode = 'area' AND cl.rname LIKE '%cut%akr%'), false) AS has_cut,
      COALESCE(BOOL_OR(cl.rname LIKE '%potong%'), false) AS has_potong,
      COALESCE(BOOL_OR(cl.rname LIKE '%solder%'), false) AS has_solder,
      COALESCE(BOOL_OR(cl.rname LIKE '%kabel%'), false) AS has_kabel,
      COALESCE(BOOL_OR(cl.rname LIKE '%tempel%'), false) AS has_tempel,
      COALESCE(SUM(CASE WHEN cl.mode='area' AND cl.rname LIKE '%cut%akr%' THEN cl.qty END),0) AS cut_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%potong%' THEN cl.qty END),0) AS potong_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%solder%' THEN cl.qty END),0) AS solder_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%kabel%' THEN cl.qty END),0) AS kabel_qty,
      COALESCE(SUM(CASE WHEN cl.rname LIKE '%tempel%' THEN cl.qty END),0) AS tempel_qty
    FROM public.projects p
    LEFT JOIN public.customers c ON c.id = p.customer_id
    JOIN public.orders o ON o.id = p.parent_order_id
    LEFT JOIN order_outdoor oo ON oo.order_id = o.id
    LEFT JOIN claims cl ON cl.project_id = p.id
    WHERE p.status IN ('draft','active')
      AND o.status::text NOT IN ('ready_stock','draft')
    GROUP BY p.id, p.code, p.title, c.name, p.total_points, p.deadline, o.id, o.order_no, o.status, o.co_date, o.ekspedisi, o.no_resi, o.ready_pickup_at, o.picked_up_at, o.packing_kayu, oo.use_outdoor
  )
  SELECT
    project_id, project_code, project_title, customer_name, total_points, deadline,
    order_id, order_no, order_status, co_date, ekspedisi, no_resi, ready_pickup_at, picked_up_at,
    packing_kayu, use_outdoor,
    has_cut, has_potong, has_solder, has_kabel, has_tempel,
    cut_qty, potong_qty, solder_qty, kabel_qty, tempel_qty,
    CASE
      WHEN picked_up_at IS NOT NULL THEN 'shipping'
      WHEN ready_pickup_at IS NOT NULL THEN 'packing'
      WHEN has_kabel THEN 'packing'
      WHEN has_tempel THEN 'kabel'
      WHEN has_solder THEN 'tempel'
      WHEN has_potong THEN 'solder'
      WHEN has_cut THEN 'potong'
      ELSE 'waiting'
    END AS current_step
  FROM agg
  ORDER BY
    CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
    deadline ASC,
    co_date DESC NULLS LAST,
    project_code DESC;
$$;


--
-- Name: get_attendance_secret(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_attendance_secret() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE s text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  RETURN s;
END $$;


--
-- Name: get_available_projects(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_available_projects() RETURNS TABLE(id uuid, code text, title text, status public.project_status, total_points integer, claimed_points numeric, remaining_points numeric, parent_order_id uuid, order_no text, order_status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH active_rates AS (
    SELECT id, COALESCE(pricing_mode,'per_unit') AS pricing_mode
    FROM public.job_rates WHERE active = true
  ), project_availability AS (
    SELECT
      p.id, p.code, p.title, p.status,
      COALESCE(SUM(CASE WHEN ar.pricing_mode = 'area' THEN 1 ELSE p.total_points END), 0)::integer AS total_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 1 ELSE 0 END
        ELSE LEAST(COALESCE(claimed.claimed_qty, 0), p.total_points)
      END), 0) AS claimed_points,
      COALESCE(SUM(CASE
        WHEN ar.pricing_mode = 'area' THEN CASE WHEN claimed.has_claim THEN 0 ELSE 1 END
        ELSE GREATEST(p.total_points - COALESCE(claimed.claimed_qty, 0), 0)
      END), 0) AS remaining_points,
      p.parent_order_id, o.order_no, o.status AS order_status, p.created_at
    FROM public.projects p
    JOIN public.orders o ON o.id = p.parent_order_id
    CROSS JOIN active_rates ar
    LEFT JOIN LATERAL (
      SELECT SUM(jl.qty) AS claimed_qty, COUNT(*) > 0 AS has_claim
      FROM public.job_logs jl
      WHERE jl.project_id = p.id AND jl.rate_id = ar.id
        AND jl.status <> 'rejected' AND COALESCE(jl.is_repair,false) = false
    ) claimed ON true
    WHERE p.status IN ('draft', 'active')
    GROUP BY p.id, p.code, p.title, p.status, p.parent_order_id, o.order_no, o.status, p.created_at
  )
  SELECT id, code, title, status, total_points, claimed_points, remaining_points, parent_order_id, order_no, order_status
  FROM project_availability
  ORDER BY created_at DESC;
$$;


--
-- Name: get_daily_attendance_token(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_daily_attendance_token(_date date DEFAULT NULL::date) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE s text; d date; ymd text; sig text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  d := COALESCE(_date, (now() AT TIME ZONE 'Asia/Jakarta')::date);
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  IF s IS NULL THEN RAISE EXCEPTION 'Secret belum diinisialisasi'; END IF;
  ymd := to_char(d, 'YYYYMMDD');
  sig := substr(encode(extensions.hmac('DAILY:' || ymd, s, 'sha256'), 'hex'), 1, 16);
  RETURN 'DLY:' || ymd || ':' || sig;
END $$;


--
-- Name: get_order_history(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_order_history(_limit integer DEFAULT 500) RETURNS TABLE(order_id uuid, order_no text, no_resi text, ekspedisi text, username text, kota text, text_neon text, co_date date, ready_pickup_at timestamp with time zone, picked_up_at timestamp with time zone, order_status text, projects jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_no,
    o.no_resi,
    o.ekspedisi,
    o.username,
    o.kota,
    o.text_neon,
    o.co_date,
    o.ready_pickup_at,
    o.picked_up_at,
    o.status,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id', p.id, 'code', p.code, 'title', p.title, 'status', p.status)
        ORDER BY p.code
      )
      FROM public.projects p
      WHERE p.parent_order_id = o.id
    ), '[]'::jsonb) AS projects
  FROM public.orders o
  WHERE o.picked_up_at IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.projects p2
       WHERE p2.parent_order_id = o.id AND p2.status = 'done'
     )
  ORDER BY COALESCE(o.picked_up_at, o.updated_at) DESC
  LIMIT _limit;
END;
$$;


--
-- Name: get_permanent_attendance_token(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_permanent_attendance_token() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE s text; sig text;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT secret INTO s FROM public.attendance_settings WHERE id = 1;
  IF s IS NULL THEN RAISE EXCEPTION 'Secret belum diinisialisasi'; END IF;
  sig := substr(encode(extensions.hmac('PERMANENT', s, 'sha256'), 'hex'), 1, 24);
  RETURN 'PRM:' || sig;
END $$;


--
-- Name: get_project_detail_for_worker(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_project_detail_for_worker(_project_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE result jsonb; is_priv boolean;
BEGIN
  is_priv := public.is_admin_or_owner(auth.uid());
  SELECT jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'code', p.code, 'title', p.title, 'status', p.status,
      'total_points', p.total_points, 'contract_value', p.contract_value,
      'deadline', p.deadline, 'description', p.description
    ),
    'customer', jsonb_build_object(
      'name', c.name,
      'phone', CASE WHEN is_priv THEN c.phone ELSE NULL END
    ),
    'order', CASE WHEN o.id IS NOT NULL THEN jsonb_build_object(
      'id', o.id, 'order_no', o.order_no, 'status', o.status,
      'co_date', o.co_date, 'text_neon', o.text_neon,
      'kota', o.kota, 'username', o.username,
      'ekspedisi', o.ekspedisi, 'no_resi', o.no_resi,
      'ready_pickup_at', o.ready_pickup_at,
      'picked_up_at', o.picked_up_at,
      'akrilik_p', COALESCE(NULLIF(oi.akrilik_p, 0), o.akrilik_p),
      'akrilik_l', COALESCE(NULLIF(oi.akrilik_l, 0), o.akrilik_l),
      'led_meter', COALESCE(NULLIF(oi.led_meter, 0), o.led_meter),
      'titik', COALESCE(NULLIF(oi.titik, 0), o.titik),
      'kabel_meter', COALESCE(NULLIF(oi.kabel_meter, 0), o.kabel_meter),
      'kabel_socket_meter', COALESCE(NULLIF(oi.kabel_socket_meter, 0), o.kabel_socket_meter),
      'notes', o.notes,
      'deadline', o.deadline,
      'packing_kayu', COALESCE(o.packing_kayu, false),
      'use_outdoor', (
        COALESCE(o.outdoor_cost,0) > 0
        OR EXISTS (SELECT 1 FROM public.order_items oi2 WHERE oi2.order_id = o.id AND COALESCE(oi2.outdoor_cost,0) > 0)
      )
    ) ELSE NULL END,
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rate_name', r.name, 'unit', r.unit,
        'qty', jl.qty, 'status', jl.status, 'is_repair', jl.is_repair,
        'employee_name', e.full_name,
        'log_date', jl.log_date
      ) ORDER BY jl.log_date DESC)
      FROM public.job_logs jl
      JOIN public.job_rates r ON r.id = jl.rate_id
      JOIN public.employees e ON e.id = jl.employee_id
      WHERE jl.project_id = p.id AND jl.status <> 'rejected'
    ), '[]'::jsonb)
  ) INTO result
  FROM public.projects p
  LEFT JOIN public.customers c ON c.id = p.customer_id
  LEFT JOIN public.orders o ON o.id = p.parent_order_id
  LEFT JOIN LATERAL (
    SELECT * FROM public.order_items x
    WHERE x.project_id = p.id AND x.order_id = o.id
    ORDER BY x.position LIMIT 1
  ) oi ON true
  WHERE p.id = _project_id;
  RETURN result;
END $$;


--
-- Name: get_project_rate_availability(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_project_rate_availability(_project_id uuid) RETURNS TABLE(rate_id uuid, rate_name text, unit text, rate_per_unit numeric, total_points integer, claimed_points numeric, remaining_points numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH proj AS (
    SELECT id, total_points, parent_order_id FROM public.projects WHERE id = _project_id
  )
  SELECT
    r.id,
    r.name,
    r.unit,
    r.rate_per_unit,
    CASE WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN 1 ELSE p.total_points END AS total_points,
    CASE
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' AND COALESCE(r.area_scope,'project') = 'order' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          JOIN public.projects p2 ON p2.id = jl.project_id
          WHERE p2.parent_order_id = p.parent_order_id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 1 ELSE 0 END
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          WHERE jl.project_id = p.id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 1 ELSE 0 END
      ELSE COALESCE((
        SELECT SUM(jl.qty) FROM public.job_logs jl
        WHERE jl.project_id = p.id
          AND jl.rate_id = r.id
          AND jl.status <> 'rejected'
          AND COALESCE(jl.is_repair,false) = false
      ), 0)
    END AS claimed_points,
    CASE
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' AND COALESCE(r.area_scope,'project') = 'order' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          JOIN public.projects p2 ON p2.id = jl.project_id
          WHERE p2.parent_order_id = p.parent_order_id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 0 ELSE 1 END
      WHEN COALESCE(r.pricing_mode,'per_unit') = 'area' THEN
        CASE WHEN EXISTS (
          SELECT 1 FROM public.job_logs jl
          WHERE jl.project_id = p.id
            AND jl.rate_id = r.id
            AND jl.status <> 'rejected'
            AND COALESCE(jl.is_repair,false) = false
        ) THEN 0 ELSE 1 END
      ELSE GREATEST(p.total_points - COALESCE((
        SELECT SUM(jl.qty) FROM public.job_logs jl
        WHERE jl.project_id = p.id
          AND jl.rate_id = r.id
          AND jl.status <> 'rejected'
          AND COALESCE(jl.is_repair,false) = false
      ), 0), 0)
    END AS remaining_points
  FROM proj p
  CROSS JOIN public.job_rates r
  WHERE r.active = true
  ORDER BY r.sort_order ASC, r.name ASC;
$$;


--
-- Name: get_repairable_orders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_repairable_orders() RETURNS TABLE(id uuid, order_no text, text_neon text, username text, kota text, status text, project_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT id, order_no, text_neon, username, kota, status, project_id
  FROM public.orders
  WHERE status IN ('active','return','ready_stock')
  ORDER BY created_at DESC
  LIMIT 500;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE user_count int;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  SELECT COUNT(*) INTO user_count FROM auth.users;
  IF user_count = 1 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'karyawan');
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;


--
-- Name: is_admin_or_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin_or_owner(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','owner'))
$$;


--
-- Name: link_project_to_order(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_project_to_order(_project_id uuid, _order_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  p record;
  it record;
  nextpos int;
begin
  if not public.is_admin_or_owner(auth.uid()) then
    raise exception 'Forbidden: hanya admin/owner';
  end if;

  select * into p from public.projects where id = _project_id;
  if not found then raise exception 'Project tidak ditemukan'; end if;

  select * into it from public.order_items where project_id = _project_id order by created_at limit 1;

  if _order_id is null then
    if found then
      delete from public.order_items where id = it.id;
    else
      update public.projects set parent_order_id = null where id = _project_id;
    end if;
    return;
  end if;

  select coalesce(max(position),0) + 1 into nextpos from public.order_items where order_id = _order_id;

  if it.id is not null then
    if it.order_id = _order_id then
      update public.projects set parent_order_id = _order_id where id = _project_id;
      return;
    end if;
    update public.order_items set order_id = _order_id, position = nextpos where id = it.id;
  else
    insert into public.order_items(order_id, position, kind, project_id, text_neon, titik)
    values (_order_id, nextpos, 'custom', _project_id,
            coalesce(nullif(p.title,''), p.code), greatest(coalesce(p.total_points,0),0));
  end if;

  update public.projects set parent_order_id = _order_id where id = _project_id;
end;
$$;


--
-- Name: lookup_order_by_resi(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lookup_order_by_resi(_query text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE ord RECORD; q text;
BEGIN
  q := btrim(COALESCE(_query,''));
  IF q = '' THEN RETURN NULL; END IF;
  SELECT o.*, p.id AS proj_id
    INTO ord
    FROM public.orders o
    LEFT JOIN public.projects p ON p.parent_order_id = o.id
    WHERE o.no_resi = q OR lower(o.no_resi) = lower(q) OR lower(o.order_no) = lower(q)
    ORDER BY o.created_at DESC
    LIMIT 1;
  IF ord.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'order_id', ord.id,
    'order_no', ord.order_no,
    'status', ord.status,
    'no_resi', ord.no_resi,
    'ekspedisi', ord.ekspedisi,
    'text_neon', ord.text_neon,
    'username', ord.username,
    'kota', ord.kota,
    'co_date', ord.co_date,
    'ready_pickup_at', ord.ready_pickup_at,
    'picked_up_at', ord.picked_up_at,
    'project_id', ord.proj_id
  );
END $$;


--
-- Name: mark_ready_pickup(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_ready_pickup(_order_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE ord RECORD;
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id = _order_id;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'Order tidak ditemukan'; END IF;
  IF COALESCE(ord.no_resi,'') = '' THEN RAISE EXCEPTION 'No Resi belum diisi'; END IF;
  UPDATE public.orders
    SET ready_pickup_at = COALESCE(ready_pickup_at, now()),
        updated_at = now()
    WHERE id = _order_id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (_order_id, 'ready_pickup', auth.uid(), NULL);
END $$;


--
-- Name: mark_ready_pickup_by_resi(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_ready_pickup_by_resi(_no_resi text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE ord RECORD; resi text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Harus login';
  END IF;
  resi := btrim(COALESCE(_no_resi,''));
  IF resi = '' THEN RAISE EXCEPTION 'No Resi wajib diisi'; END IF;
  SELECT * INTO ord FROM public.orders WHERE no_resi = resi LIMIT 1;
  IF ord.id IS NULL THEN
    RAISE EXCEPTION 'Resi % tidak ditemukan di data order', resi;
  END IF;
  IF ord.picked_up_at IS NOT NULL THEN
    RAISE EXCEPTION 'Paket sudah diambil kurir pada %', to_char(ord.picked_up_at,'DD Mon YYYY HH24:MI');
  END IF;
  UPDATE public.orders
    SET ready_pickup_at = COALESCE(ready_pickup_at, now()), updated_at = now()
    WHERE id = ord.id;
  INSERT INTO public.shipment_events(order_id, event, actor_id, note)
    VALUES (ord.id, 'ready_pickup', auth.uid(), NULL);
  RETURN jsonb_build_object(
    'order_id', ord.id, 'order_no', ord.order_no,
    'ekspedisi', ord.ekspedisi, 'no_resi', ord.no_resi,
    'already_ready', ord.ready_pickup_at IS NOT NULL
  );
END $$;


--
-- Name: next_project_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_project_code() RETURNS text
    LANGUAGE sql
    SET search_path TO 'public'
    AS $_$
  SELECT 'P-' || lpad((COALESCE(MAX(NULLIF(regexp_replace(code, '\D', '', 'g'), '')::bigint), 0) + 1)::text, 4, '0')
  FROM public.projects WHERE code ~ '^P-\d+$'
$_$;


--
-- Name: recalc_order_repair_cost(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalc_order_repair_cost() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE oid uuid; total numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    oid := OLD.source_order_id;
  ELSE
    oid := NEW.source_order_id;
  END IF;
  IF oid IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.source_order_id IS NOT NULL AND OLD.source_order_id IS DISTINCT FROM NEW.source_order_id THEN
      SELECT COALESCE(SUM(amount),0) INTO total FROM public.job_logs
        WHERE source_order_id = OLD.source_order_id AND is_repair = true AND status = 'approved';
      UPDATE public.orders SET repair_cost = total WHERE id = OLD.source_order_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO total FROM public.job_logs
    WHERE source_order_id = oid AND is_repair = true AND status = 'approved';
  UPDATE public.orders SET repair_cost = total WHERE id = oid;
  -- juga update order lama jika source_order_id berubah
  IF TG_OP = 'UPDATE' AND OLD.source_order_id IS NOT NULL AND OLD.source_order_id IS DISTINCT FROM NEW.source_order_id THEN
    SELECT COALESCE(SUM(amount),0) INTO total FROM public.job_logs
      WHERE source_order_id = OLD.source_order_id AND is_repair = true AND status = 'approved';
    UPDATE public.orders SET repair_cost = total WHERE id = OLD.source_order_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;


--
-- Name: refresh_order_from_items(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_order_from_items(_oid uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  cnt int; sum_hpp numeric; sum_titik int; sum_led numeric; combined text;
BEGIN
  SELECT
    COUNT(*),
    COALESCE(SUM(item_hpp), 0),
    COALESCE(SUM(titik), 0),
    COALESCE(SUM(led_meter), 0),
    string_agg(
      COALESCE(NULLIF(text_neon,''), NULLIF(manual_name,''), 'Item'),
      ' | ' ORDER BY position
    )
  INTO cnt, sum_hpp, sum_titik, sum_led, combined
  FROM public.order_items WHERE order_id = _oid;

  IF cnt = 0 THEN RETURN; END IF;

  UPDATE public.orders
    SET hpp = sum_hpp + COALESCE(repair_cost,0),
        titik = sum_titik,
        led_meter = sum_led,
        text_neon = COALESCE(NULLIF(combined,''), text_neon),
        profit = COALESCE(payment,0) + COALESCE(split,0) - (sum_hpp + COALESCE(repair_cost,0)),
        updated_at = now()
    WHERE id = _oid;
END $$;


--
-- Name: rotate_attendance_secret(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rotate_attendance_secret() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE s text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN RAISE EXCEPTION 'Forbidden: hanya owner'; END IF;
  UPDATE public.attendance_settings
    SET secret = encode(extensions.gen_random_bytes(32), 'hex'), updated_at = now()
    WHERE id = 1 RETURNING secret INTO s;
  IF s IS NULL THEN
    INSERT INTO public.attendance_settings(id, secret)
      VALUES (1, encode(extensions.gen_random_bytes(32), 'hex'))
      RETURNING secret INTO s;
  END IF;
  RETURN s;
END $$;


--
-- Name: set_attendance_note(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_attendance_note(_attendance_id uuid, _note text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE owns boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.attendances a
    JOIN public.employees e ON e.id = a.employee_id
    WHERE a.id = _attendance_id AND (e.profile_id = auth.uid() OR public.is_admin_or_owner(auth.uid()))
  ) INTO owns;
  IF NOT owns THEN RAISE EXCEPTION 'Tidak diizinkan mengubah catatan absensi ini'; END IF;
  UPDATE public.attendances SET note = _note, updated_at = now() WHERE id = _attendance_id;
END $$;


--
-- Name: set_expense_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_expense_defaults() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.category = 'bahan_pokok' THEN
      NEW.affects_pnl := false;
    END IF;
    IF NEW.created_by IS NULL THEN
      NEW.created_by := auth.uid();
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;


--
-- Name: sync_item_to_project(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_item_to_project() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  ord RECORD; cust_id uuid; cust_name text; proj_id uuid;
  cur_hpp numeric; total_hpp numeric; contract_val numeric;
  header_proj_id uuid; header_has_logs boolean;
BEGIN
  IF NEW.kind <> 'custom' THEN
    IF NEW.project_id IS NOT NULL THEN
      UPDATE public.order_items SET project_id = NULL WHERE id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = NEW.order_id;
  IF ord.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Hapus project "header" (dibuat saat order belum punya item) bila tidak dipakai
  SELECT p.id INTO header_proj_id
    FROM public.projects p
    WHERE p.parent_order_id = ord.id
      AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.project_id = p.id)
    LIMIT 1;
  IF header_proj_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = header_proj_id) INTO header_has_logs;
    IF NOT header_has_logs THEN
      IF ord.project_id = header_proj_id THEN
        UPDATE public.orders SET project_id = NULL WHERE id = ord.id;
      END IF;
      DELETE FROM public.projects WHERE id = header_proj_id;
    END IF;
  END IF;

  cust_name := COALESCE(NULLIF(TRIM(ord.username), ''), 'Customer') ||
               CASE WHEN COALESCE(ord.kota,'') <> '' THEN ' - ' || ord.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;

  SELECT COALESCE(SUM(item_hpp),0) INTO total_hpp
    FROM public.order_items WHERE order_id = ord.id AND kind = 'custom';
  cur_hpp := COALESCE(NEW.item_hpp, 0);
  IF total_hpp > 0 THEN
    contract_val := ROUND(COALESCE(ord.payment,0) * cur_hpp / total_hpp);
  ELSE
    contract_val := 0;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects
      SET title = COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
          customer_id = cust_id,
          total_points = GREATEST(NEW.titik, 0),
          contract_value = contract_val,
          parent_order_id = ord.id,
          deadline = ord.deadline,
          status = CASE WHEN status = 'done' THEN 'active'::project_status ELSE status END
      WHERE id = NEW.project_id;
  ELSE
    INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id, deadline)
    VALUES (public.next_project_code(),
            COALESCE(NULLIF(NEW.text_neon,''), 'Item ' || NEW.position),
            cust_id, GREATEST(NEW.titik,0), contract_val, 'active', ord.id, ord.deadline)
    RETURNING id INTO proj_id;
    UPDATE public.order_items SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: sync_order_to_project(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_order_to_project() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE cust_id uuid; cust_name text; proj_id uuid; has_logs boolean; item_count int;
BEGIN
  SELECT COUNT(*) INTO item_count FROM public.order_items WHERE order_id = NEW.id;
  IF item_count > 0 THEN
    RETURN NEW;
  END IF;

  -- Order yang produknya sudah dipindahkan ke order lain: jangan buat project baru
  IF NEW.consumed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'draft' THEN
    IF NEW.project_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.job_logs WHERE project_id = NEW.project_id) INTO has_logs;
      proj_id := NEW.project_id;
      UPDATE public.orders SET project_id = NULL WHERE id = NEW.id;
      IF NOT has_logs THEN DELETE FROM public.projects WHERE id = proj_id; END IF;
    END IF;
    RETURN NEW;
  END IF;

  cust_name := COALESCE(NULLIF(TRIM(NEW.username), ''), 'Customer') ||
               CASE WHEN COALESCE(NEW.kota,'') <> '' THEN ' - ' || NEW.kota ELSE '' END;
  SELECT id INTO cust_id FROM public.customers WHERE name = cust_name LIMIT 1;
  IF cust_id IS NULL THEN
    INSERT INTO public.customers(name) VALUES (cust_name) RETURNING id INTO cust_id;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
      total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id,
      deadline = NEW.deadline
      WHERE id = NEW.project_id;
  ELSE
    SELECT id INTO proj_id FROM public.projects WHERE parent_order_id = NEW.id LIMIT 1;
    IF proj_id IS NULL THEN
      INSERT INTO public.projects(code, title, customer_id, total_points, contract_value, status, parent_order_id, deadline)
      VALUES (public.next_project_code(), NEW.text_neon, cust_id, GREATEST(NEW.titik,0), NEW.payment, 'active', NEW.id, NEW.deadline)
      RETURNING id INTO proj_id;
    ELSE
      UPDATE public.projects SET title = NEW.text_neon, customer_id = cust_id,
        total_points = GREATEST(NEW.titik,0), contract_value = NEW.payment, parent_order_id = NEW.id,
        deadline = NEW.deadline
        WHERE id = proj_id;
    END IF;
    UPDATE public.orders SET project_id = proj_id WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: trg_refresh_order_from_items(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_refresh_order_from_items() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.refresh_order_from_items(COALESCE(NEW.order_id, OLD.order_id));
  RETURN COALESCE(NEW, OLD);
END $$;


--
-- Name: update_attendance_location(double precision, double precision, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_attendance_location(_lat double precision, _lng double precision, _radius integer, _enforce boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.is_admin_or_owner(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _radius IS NULL OR _radius < 10 THEN RAISE EXCEPTION 'Radius minimal 10 meter'; END IF;
  UPDATE public.attendance_settings
     SET workshop_lat = _lat,
         workshop_lng = _lng,
         radius_meters = _radius,
         enforce_location = COALESCE(_enforce, false),
         updated_at = now()
   WHERE id = 1;
  IF NOT FOUND THEN
    INSERT INTO public.attendance_settings(id, workshop_lat, workshop_lng, radius_meters, enforce_location)
      VALUES (1, _lat, _lng, _radius, COALESCE(_enforce, false));
  END IF;
END $$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


--
-- Name: attendance_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_settings (
    id integer DEFAULT 1 NOT NULL,
    secret text DEFAULT encode(extensions.gen_random_bytes(32), 'hex'::text) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workshop_lat double precision,
    workshop_lng double precision,
    radius_meters integer DEFAULT 100 NOT NULL,
    enforce_location boolean DEFAULT false NOT NULL,
    CONSTRAINT singleton CHECK ((id = 1))
);


--
-- Name: attendances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    check_in timestamp with time zone,
    check_out timestamp with time zone,
    status public.attendance_status DEFAULT 'hadir'::public.attendance_status NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    break_start timestamp with time zone,
    break_end timestamp with time zone
);


--
-- Name: cashbon; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cashbon (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    amount numeric(14,2) NOT NULL,
    note text,
    status public.cashbon_status DEFAULT 'pending'::public.cashbon_status NOT NULL,
    request_date date DEFAULT CURRENT_DATE NOT NULL,
    decided_by uuid,
    decided_at timestamp with time zone,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cashbon_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    address text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employee_consumption; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_consumption (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    consumption_date date DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta'::text))::date NOT NULL,
    amount numeric NOT NULL,
    note text,
    deducted boolean DEFAULT false NOT NULL,
    payroll_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_method text DEFAULT 'cashbon'::text NOT NULL,
    allowance_applied numeric DEFAULT 0 NOT NULL,
    company_covered numeric DEFAULT 0 NOT NULL,
    employee_charge numeric DEFAULT 0 NOT NULL,
    expense_id uuid,
    cashbon_id uuid,
    CONSTRAINT employee_consumption_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT employee_consumption_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'cashbon'::text])))
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid,
    employee_code text NOT NULL,
    full_name text NOT NULL,
    phone text,
    type public.employee_type DEFAULT 'borongan'::public.employee_type NOT NULL,
    daily_wage numeric(12,2) DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    hourly_rate numeric DEFAULT 0 NOT NULL,
    pay_unit text DEFAULT 'day'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employees_pay_unit_check CHECK ((pay_unit = ANY (ARRAY['day'::text, 'hour'::text])))
);


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    expense_date date DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta'::text))::date NOT NULL,
    category public.expense_category DEFAULT 'lainnya'::public.expense_category NOT NULL,
    amount numeric NOT NULL,
    description text NOT NULL,
    vendor text,
    note text,
    affects_pnl boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_status text DEFAULT 'lunas'::text NOT NULL,
    CONSTRAINT expenses_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT expenses_payment_status_check CHECK ((payment_status = ANY (ARRAY['lunas'::text, 'hutang'::text])))
);


--
-- Name: job_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    unit text DEFAULT 'titik'::text NOT NULL,
    rate_per_unit numeric(12,2) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pricing_mode text DEFAULT 'per_unit'::text NOT NULL,
    min_amount numeric DEFAULT 0 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    area_scope text DEFAULT 'project'::text NOT NULL,
    require_photo boolean DEFAULT false NOT NULL,
    CONSTRAINT job_rates_area_scope_check CHECK ((area_scope = ANY (ARRAY['project'::text, 'order'::text]))),
    CONSTRAINT job_rates_pricing_mode_check CHECK ((pricing_mode = ANY (ARRAY['per_unit'::text, 'area'::text])))
);


--
-- Name: material_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_prices (
    key text NOT NULL,
    label text NOT NULL,
    value numeric DEFAULT 0 NOT NULL,
    unit text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    "position" integer DEFAULT 1 NOT NULL,
    kind public.order_item_kind DEFAULT 'custom'::public.order_item_kind NOT NULL,
    text_neon text,
    akrilik_p numeric DEFAULT 0 NOT NULL,
    akrilik_l numeric DEFAULT 0 NOT NULL,
    led_meter numeric DEFAULT 0 NOT NULL,
    titik integer DEFAULT 0 NOT NULL,
    kabel_meter numeric,
    kabel_socket_meter numeric DEFAULT 1 NOT NULL,
    adaptor numeric DEFAULT 0 NOT NULL,
    adaptor_type text,
    modul numeric DEFAULT 0 NOT NULL,
    socket_dc numeric DEFAULT 0 NOT NULL,
    baut_fischer numeric DEFAULT 0 NOT NULL,
    outdoor_cost numeric,
    led_cost numeric DEFAULT 0 NOT NULL,
    akrilik_cost numeric DEFAULT 0 NOT NULL,
    solder_cost numeric DEFAULT 0 NOT NULL,
    tempel_cost numeric DEFAULT 0 NOT NULL,
    kabel_cost numeric DEFAULT 0 NOT NULL,
    kabel_socket_cost numeric DEFAULT 0 NOT NULL,
    biaya_lainnya numeric DEFAULT 0 NOT NULL,
    item_hpp numeric DEFAULT 0 NOT NULL,
    source_ready_stock_order_id uuid,
    manual_name text,
    manual_price numeric DEFAULT 0 NOT NULL,
    manual_hpp numeric DEFAULT 0 NOT NULL,
    project_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_draft_order_id uuid
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source public.order_source DEFAULT 'shopee'::public.order_source NOT NULL,
    order_no text NOT NULL,
    co_date date,
    username text,
    kota text,
    text_neon text NOT NULL,
    paket text,
    akrilik_p numeric DEFAULT 0 NOT NULL,
    akrilik_l numeric DEFAULT 0 NOT NULL,
    led_meter numeric DEFAULT 0 NOT NULL,
    titik integer DEFAULT 0 NOT NULL,
    kabel_meter numeric,
    payment numeric DEFAULT 0 NOT NULL,
    split numeric DEFAULT 0 NOT NULL,
    adaptor numeric DEFAULT 0 NOT NULL,
    modul numeric DEFAULT 0 NOT NULL,
    socket_dc numeric DEFAULT 0 NOT NULL,
    baut_fischer numeric DEFAULT 0 NOT NULL,
    led_cost numeric DEFAULT 0 NOT NULL,
    akrilik_cost numeric DEFAULT 0 NOT NULL,
    solder_cost numeric DEFAULT 0 NOT NULL,
    tempel_cost numeric DEFAULT 0 NOT NULL,
    kabel_cost numeric DEFAULT 0 NOT NULL,
    hpp numeric DEFAULT 0 NOT NULL,
    profit numeric DEFAULT 0 NOT NULL,
    notes text,
    project_id uuid,
    dp numeric DEFAULT 0 NOT NULL,
    outdoor_cost numeric,
    kabel_socket_meter numeric DEFAULT 1 NOT NULL,
    kabel_socket_cost numeric DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    adaptor_type text,
    biaya_lainnya numeric DEFAULT 0 NOT NULL,
    repair_cost numeric DEFAULT 0 NOT NULL,
    no_resi text,
    ekspedisi text,
    ready_pickup_at timestamp with time zone,
    picked_up_at timestamp with time zone,
    picked_up_by uuid,
    deadline date,
    packing_kayu boolean DEFAULT false NOT NULL,
    phone text,
    consumed_at timestamp with time zone,
    shopee_label_pdf text,
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['active'::text, 'return'::text, 'draft'::text, 'ready_stock'::text]))),
    CONSTRAINT orders_status_chk CHECK ((status = ANY (ARRAY['active'::text, 'return'::text, 'draft'::text, 'ready_stock'::text])))
);


--
-- Name: payrolls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payrolls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    base numeric(14,2) DEFAULT 0 NOT NULL,
    bonus numeric(14,2) DEFAULT 0 NOT NULL,
    deductions numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    status public.payroll_status DEFAULT 'draft'::public.payroll_status NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    consumption_deduction numeric DEFAULT 0 NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text DEFAULT ''::text NOT NULL,
    phone text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    customer_id uuid,
    title text NOT NULL,
    description text,
    deadline date,
    status public.project_status DEFAULT 'draft'::public.project_status NOT NULL,
    total_points integer DEFAULT 0 NOT NULL,
    contract_value numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_order_id uuid
);


--
-- Name: shipment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    event text NOT NULL,
    actor_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shipment_events_event_check CHECK ((event = ANY (ARRAY['ready_pickup'::text, 'picked_up'::text])))
);


--
-- Name: shipping_carriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_carriers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shopee_order_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopee_order_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_sn text NOT NULL,
    order_id uuid,
    shopee_status text,
    raw jsonb,
    imported_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shopee_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopee_settings (
    id smallint DEFAULT 1 NOT NULL,
    shop_id text,
    access_token text,
    refresh_token text,
    token_expires_at timestamp with time zone,
    connected_at timestamp with time zone,
    enabled boolean DEFAULT false NOT NULL,
    lookback_days integer DEFAULT 7 NOT NULL,
    last_sync_at timestamp with time zone,
    last_sync_status text,
    last_sync_message text,
    last_sync_inserted integer DEFAULT 0,
    last_sync_updated integer DEFAULT 0,
    last_sync_skipped integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    partner_id text,
    partner_key text,
    redirect_url text,
    CONSTRAINT shopee_settings_singleton CHECK ((id = 1))
);


--
-- Name: shopping_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shopping_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_name text NOT NULL,
    qty text,
    note text,
    urgency text DEFAULT 'normal'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_by uuid,
    purchased_by uuid,
    purchased_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shopping_notes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'purchased'::text]))),
    CONSTRAINT shopping_notes_urgency_check CHECK ((urgency = ANY (ARRAY['normal'::text, 'urgent'::text])))
);


--
-- Name: sync_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_settings (
    id smallint DEFAULT 1 NOT NULL,
    spreadsheet_id text,
    sheet_name text,
    header_row integer DEFAULT 1 NOT NULL,
    mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_sync_at timestamp with time zone,
    last_sync_status text,
    last_sync_message text,
    last_sync_inserted integer DEFAULT 0,
    last_sync_updated integer DEFAULT 0,
    last_sync_skipped integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sync_settings_singleton CHECK ((id = 1))
);


--
-- Name: user_feature_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_feature_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    feature_key text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attendance_settings attendance_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_settings
    ADD CONSTRAINT attendance_settings_pkey PRIMARY KEY (id);


--
-- Name: attendances attendances_employee_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendances
    ADD CONSTRAINT attendances_employee_id_date_key UNIQUE (employee_id, date);


--
-- Name: attendances attendances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendances
    ADD CONSTRAINT attendances_pkey PRIMARY KEY (id);


--
-- Name: cashbon cashbon_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbon
    ADD CONSTRAINT cashbon_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: employee_consumption employee_consumption_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_consumption
    ADD CONSTRAINT employee_consumption_pkey PRIMARY KEY (id);


--
-- Name: employees employees_employee_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_employee_code_key UNIQUE (employee_code);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: job_logs job_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_logs
    ADD CONSTRAINT job_logs_pkey PRIMARY KEY (id);


--
-- Name: job_rates job_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_rates
    ADD CONSTRAINT job_rates_pkey PRIMARY KEY (id);


--
-- Name: material_prices material_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_prices
    ADD CONSTRAINT material_prices_pkey PRIMARY KEY (key);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_order_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_no_key UNIQUE (order_no);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payrolls payrolls_employee_id_period_start_period_end_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payrolls
    ADD CONSTRAINT payrolls_employee_id_period_start_period_end_key UNIQUE (employee_id, period_start, period_end);


--
-- Name: payrolls payrolls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payrolls
    ADD CONSTRAINT payrolls_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: project_assignments project_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignments
    ADD CONSTRAINT project_assignments_pkey PRIMARY KEY (id);


--
-- Name: project_assignments project_assignments_project_id_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignments
    ADD CONSTRAINT project_assignments_project_id_employee_id_key UNIQUE (project_id, employee_id);


--
-- Name: projects projects_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_code_key UNIQUE (code);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: shipment_events shipment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_events
    ADD CONSTRAINT shipment_events_pkey PRIMARY KEY (id);


--
-- Name: shipping_carriers shipping_carriers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_carriers
    ADD CONSTRAINT shipping_carriers_name_key UNIQUE (name);


--
-- Name: shipping_carriers shipping_carriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_carriers
    ADD CONSTRAINT shipping_carriers_pkey PRIMARY KEY (id);


--
-- Name: shopee_order_map shopee_order_map_order_sn_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopee_order_map
    ADD CONSTRAINT shopee_order_map_order_sn_key UNIQUE (order_sn);


--
-- Name: shopee_order_map shopee_order_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopee_order_map
    ADD CONSTRAINT shopee_order_map_pkey PRIMARY KEY (id);


--
-- Name: shopee_settings shopee_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopee_settings
    ADD CONSTRAINT shopee_settings_pkey PRIMARY KEY (id);


--
-- Name: shopping_notes shopping_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_notes
    ADD CONSTRAINT shopping_notes_pkey PRIMARY KEY (id);


--
-- Name: sync_settings sync_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_settings
    ADD CONSTRAINT sync_settings_pkey PRIMARY KEY (id);


--
-- Name: user_feature_permissions user_feature_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feature_permissions
    ADD CONSTRAINT user_feature_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_feature_permissions user_feature_permissions_user_id_feature_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feature_permissions
    ADD CONSTRAINT user_feature_permissions_user_id_feature_key_key UNIQUE (user_id, feature_key);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: expenses_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expenses_category_idx ON public.expenses USING btree (category);


--
-- Name: expenses_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expenses_date_idx ON public.expenses USING btree (expense_date DESC);


--
-- Name: idx_employee_consumption_deducted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_consumption_deducted ON public.employee_consumption USING btree (deducted) WHERE (deducted = false);


--
-- Name: idx_employee_consumption_employee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_consumption_employee_date ON public.employee_consumption USING btree (employee_id, consumption_date);


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_project_id ON public.order_items USING btree (project_id);


--
-- Name: idx_order_items_source_draft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_source_draft ON public.order_items USING btree (source_draft_order_id) WHERE (source_draft_order_id IS NOT NULL);


--
-- Name: idx_order_items_source_rs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_source_rs ON public.order_items USING btree (source_ready_stock_order_id);


--
-- Name: idx_projects_parent_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_parent_order_id ON public.projects USING btree (parent_order_id);


--
-- Name: job_logs_source_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX job_logs_source_order_idx ON public.job_logs USING btree (source_order_id) WHERE (is_repair = true);


--
-- Name: orders_co_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_co_date_idx ON public.orders USING btree (co_date DESC);


--
-- Name: orders_no_resi_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_no_resi_idx ON public.orders USING btree (no_resi);


--
-- Name: orders_ready_pickup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_ready_pickup_idx ON public.orders USING btree (ready_pickup_at) WHERE (picked_up_at IS NULL);


--
-- Name: orders_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_source_idx ON public.orders USING btree (source);


--
-- Name: shopee_order_map_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shopee_order_map_order_id_idx ON public.shopee_order_map USING btree (order_id);


--
-- Name: shopping_notes_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shopping_notes_status_idx ON public.shopping_notes USING btree (status, created_at DESC);


--
-- Name: order_items calc_order_item_costs_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER calc_order_item_costs_trg BEFORE INSERT OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.calc_order_item_costs();


--
-- Name: order_items order_items_aggregate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER order_items_aggregate AFTER INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_order_from_items();


--
-- Name: shopping_notes shopping_notes_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER shopping_notes_set_updated_at BEFORE UPDATE ON public.shopping_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: order_items sync_item_to_project_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_item_to_project_trg AFTER INSERT OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.sync_item_to_project();


--
-- Name: order_items trg_absorb_referenced_draft; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_absorb_referenced_draft AFTER INSERT OR DELETE OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.absorb_referenced_draft();


--
-- Name: orders trg_assign_order_no; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_order_no BEFORE INSERT OR UPDATE OF status, order_no ON public.orders FOR EACH ROW EXECUTE FUNCTION public.assign_order_no();


--
-- Name: attendances trg_att_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_att_updated BEFORE UPDATE ON public.attendances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: orders trg_calc_order_costs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calc_order_costs BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.calc_order_costs();


--
-- Name: cashbon trg_cashbon_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cashbon_updated BEFORE UPDATE ON public.cashbon FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: employee_consumption trg_consumption_split; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_consumption_split BEFORE INSERT OR UPDATE OF amount, payment_method, allowance_applied ON public.employee_consumption FOR EACH ROW EXECUTE FUNCTION public.calc_consumption_split();


--
-- Name: customers trg_customers_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: order_items trg_detach_project_on_item_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_detach_project_on_item_delete AFTER DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.detach_project_from_order();


--
-- Name: order_items trg_detach_project_on_item_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_detach_project_on_item_update AFTER UPDATE OF project_id ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.detach_project_from_order();


--
-- Name: orders trg_detach_projects_on_order_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_detach_projects_on_order_delete BEFORE DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.detach_projects_on_order_delete();


--
-- Name: employees trg_employees_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: job_logs trg_enforce_project_point_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_project_point_limit BEFORE INSERT OR UPDATE ON public.job_logs FOR EACH ROW EXECUTE FUNCTION public.enforce_project_point_limit();


--
-- Name: job_logs trg_enforce_single_area_claim; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_single_area_claim BEFORE INSERT OR UPDATE ON public.job_logs FOR EACH ROW EXECUTE FUNCTION public.enforce_single_area_claim();


--
-- Name: expenses trg_expenses_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_expenses_defaults BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.set_expense_defaults();


--
-- Name: job_logs trg_joblogs_amount; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_joblogs_amount BEFORE INSERT OR UPDATE OF qty, rate_id ON public.job_logs FOR EACH ROW EXECUTE FUNCTION public.calc_job_log_amount();


--
-- Name: job_logs trg_joblogs_repair_cost; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_joblogs_repair_cost AFTER INSERT OR DELETE OR UPDATE OF status, amount, source_order_id, is_repair ON public.job_logs FOR EACH ROW EXECUTE FUNCTION public.recalc_order_repair_cost();


--
-- Name: job_logs trg_joblogs_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_joblogs_updated BEFORE UPDATE ON public.job_logs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: payrolls trg_payroll_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_payroll_updated BEFORE UPDATE ON public.payrolls FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: profiles trg_profiles_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: projects trg_projects_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: job_rates trg_rates_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_rates_updated BEFORE UPDATE ON public.job_rates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: shipping_carriers trg_shipping_carriers_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_shipping_carriers_updated BEFORE UPDATE ON public.shipping_carriers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: orders trg_sync_order_project; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_order_project AFTER INSERT OR UPDATE OF order_no, text_neon, username, kota, titik, payment, status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.sync_order_to_project();


--
-- Name: sync_settings trg_sync_settings_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_settings_updated BEFORE UPDATE ON public.sync_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: employee_consumption update_employee_consumption_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_employee_consumption_updated_at BEFORE UPDATE ON public.employee_consumption FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: shopee_order_map update_shopee_order_map_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_shopee_order_map_updated_at BEFORE UPDATE ON public.shopee_order_map FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: shopee_settings update_shopee_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_shopee_settings_updated_at BEFORE UPDATE ON public.shopee_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_feature_permissions update_user_feature_permissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_feature_permissions_updated_at BEFORE UPDATE ON public.user_feature_permissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: attendances attendances_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendances
    ADD CONSTRAINT attendances_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: cashbon cashbon_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbon
    ADD CONSTRAINT cashbon_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id);


--
-- Name: cashbon cashbon_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cashbon
    ADD CONSTRAINT cashbon_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_consumption employee_consumption_cashbon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_consumption
    ADD CONSTRAINT employee_consumption_cashbon_id_fkey FOREIGN KEY (cashbon_id) REFERENCES public.cashbon(id) ON DELETE SET NULL;


--
-- Name: employee_consumption employee_consumption_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_consumption
    ADD CONSTRAINT employee_consumption_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: employee_consumption employee_consumption_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_consumption
    ADD CONSTRAINT employee_consumption_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: employee_consumption employee_consumption_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_consumption
    ADD CONSTRAINT employee_consumption_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE SET NULL;


--
-- Name: employee_consumption employee_consumption_payroll_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_consumption
    ADD CONSTRAINT employee_consumption_payroll_id_fkey FOREIGN KEY (payroll_id) REFERENCES public.payrolls(id) ON DELETE SET NULL;


--
-- Name: employees employees_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: expenses expenses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: job_logs job_logs_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_logs
    ADD CONSTRAINT job_logs_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id);


--
-- Name: job_logs job_logs_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_logs
    ADD CONSTRAINT job_logs_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: job_logs job_logs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_logs
    ADD CONSTRAINT job_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: job_logs job_logs_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_logs
    ADD CONSTRAINT job_logs_rate_id_fkey FOREIGN KEY (rate_id) REFERENCES public.job_rates(id);


--
-- Name: job_logs job_logs_source_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_logs
    ADD CONSTRAINT job_logs_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_source_draft_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_source_draft_order_id_fkey FOREIGN KEY (source_draft_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_source_ready_stock_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_source_ready_stock_order_id_fkey FOREIGN KEY (source_ready_stock_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: orders orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: orders orders_picked_up_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_picked_up_by_fkey FOREIGN KEY (picked_up_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: orders orders_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: payrolls payrolls_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payrolls
    ADD CONSTRAINT payrolls_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id);


--
-- Name: payrolls payrolls_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payrolls
    ADD CONSTRAINT payrolls_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: project_assignments project_assignments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignments
    ADD CONSTRAINT project_assignments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: project_assignments project_assignments_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_assignments
    ADD CONSTRAINT project_assignments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: projects projects_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: projects projects_parent_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_parent_order_id_fkey FOREIGN KEY (parent_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: shipment_events shipment_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_events
    ADD CONSTRAINT shipment_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: shipment_events shipment_events_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_events
    ADD CONSTRAINT shipment_events_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: shopee_order_map shopee_order_map_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopee_order_map
    ADD CONSTRAINT shopee_order_map_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: shopping_notes shopping_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_notes
    ADD CONSTRAINT shopping_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: shopping_notes shopping_notes_purchased_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shopping_notes
    ADD CONSTRAINT shopping_notes_purchased_by_fkey FOREIGN KEY (purchased_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: user_feature_permissions user_feature_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feature_permissions
    ADD CONSTRAINT user_feature_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: expenses Admin/owner can delete expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin/owner can delete expenses" ON public.expenses FOR DELETE TO authenticated USING (public.is_admin_or_owner(auth.uid()));


--
-- Name: expenses Admin/owner can insert expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin/owner can insert expenses" ON public.expenses FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: expenses Admin/owner can update expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin/owner can update expenses" ON public.expenses FOR UPDATE TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: expenses Admin/owner can view expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin/owner can view expenses" ON public.expenses FOR SELECT TO authenticated USING (public.is_admin_or_owner(auth.uid()));


--
-- Name: shopee_order_map Admin/owner dapat melihat pemetaan pesanan Shopee; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin/owner dapat melihat pemetaan pesanan Shopee" ON public.shopee_order_map FOR SELECT TO authenticated USING (public.is_admin_or_owner(auth.uid()));


--
-- Name: shopee_settings Admin/owner dapat melihat pengaturan Shopee; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin/owner dapat melihat pengaturan Shopee" ON public.shopee_settings FOR SELECT TO authenticated USING (public.is_admin_or_owner(auth.uid()));


--
-- Name: employee_consumption Admin/owner kelola konsumsi; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin/owner kelola konsumsi" ON public.employee_consumption TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: employee_consumption Karyawan lihat konsumsi sendiri; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Karyawan lihat konsumsi sendiri" ON public.employee_consumption FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = employee_consumption.employee_id) AND (e.profile_id = auth.uid())))));


--
-- Name: orders Kurir can view pickup-ready orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Kurir can view pickup-ready orders" ON public.orders FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'kurir'::public.app_role) AND (((ready_pickup_at IS NOT NULL) AND (picked_up_at IS NULL)) OR (picked_up_by = auth.uid()))));


--
-- Name: shopee_settings Owner dapat mengubah pengaturan Shopee; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owner dapat mengubah pengaturan Shopee" ON public.shopee_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'owner'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));


--
-- Name: user_feature_permissions Owners manage feature perms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners manage feature perms" ON public.user_feature_permissions TO authenticated USING (public.has_role(auth.uid(), 'owner'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));


--
-- Name: shipment_events Staff can view all shipment_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view all shipment_events" ON public.shipment_events FOR SELECT TO authenticated USING ((public.is_admin_or_owner(auth.uid()) OR public.has_role(auth.uid(), 'kurir'::public.app_role) OR (actor_id = auth.uid())));


--
-- Name: order_items Staff can view order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can view order items" ON public.order_items FOR SELECT TO authenticated USING (public.is_admin_or_owner(auth.uid()));


--
-- Name: order_items Staff can write order items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff can write order items" ON public.order_items TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: shipment_events Staff or actor can insert shipment_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff or actor can insert shipment_events" ON public.shipment_events FOR INSERT TO authenticated WITH CHECK ((public.is_admin_or_owner(auth.uid()) OR (actor_id = auth.uid())));


--
-- Name: user_feature_permissions Users can view own feature perms; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own feature perms" ON public.user_feature_permissions FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.has_role(auth.uid(), 'owner'::public.app_role)));


--
-- Name: payrolls admin draft payroll; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin draft payroll" ON public.payrolls FOR INSERT TO authenticated WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: project_assignments admin manage assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage assignments" ON public.project_assignments TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: attendances admin manage att; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage att" ON public.attendances TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: customers admin manage customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage customers" ON public.customers TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: employees admin manage employees; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage employees" ON public.employees TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: job_logs admin manage logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage logs" ON public.job_logs TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: projects admin manage projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage projects" ON public.projects TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: job_rates admin manage rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage rates" ON public.job_rates TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: customers admin or owner read customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin or owner read customers" ON public.customers FOR SELECT TO authenticated USING (public.is_admin_or_owner(auth.uid()));


--
-- Name: profiles admin update any profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin update any profile" ON public.profiles FOR UPDATE TO authenticated USING (public.is_admin_or_owner(auth.uid()));


--
-- Name: payrolls admin update payroll; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin update payroll" ON public.payrolls FOR UPDATE TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: sync_settings admin/owner can view sync_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin/owner can view sync_settings" ON public.sync_settings FOR SELECT TO authenticated USING (public.is_admin_or_owner(auth.uid()));


--
-- Name: attendances att read own or staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "att read own or staff" ON public.attendances FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = attendances.employee_id) AND (e.profile_id = auth.uid())))) OR public.is_admin_or_owner(auth.uid())));


--
-- Name: attendance_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: attendances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_carriers auth read carriers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read carriers" ON public.shipping_carriers FOR SELECT TO authenticated USING (true);


--
-- Name: orders auth read orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read orders" ON public.orders FOR SELECT TO authenticated USING (true);


--
-- Name: material_prices auth read prices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read prices" ON public.material_prices FOR SELECT TO authenticated USING (true);


--
-- Name: job_rates auth read rates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read rates" ON public.job_rates FOR SELECT TO authenticated USING (true);


--
-- Name: attendance_settings authenticated read attendance settings meta; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated read attendance settings meta" ON public.attendance_settings FOR SELECT TO authenticated USING (true);


--
-- Name: cashbon; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cashbon ENABLE ROW LEVEL SECURITY;

--
-- Name: cashbon cashbon read own or staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "cashbon read own or staff" ON public.cashbon FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = cashbon.employee_id) AND (e.profile_id = auth.uid())))) OR public.is_admin_or_owner(auth.uid())));


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_consumption; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_consumption ENABLE ROW LEVEL SECURITY;

--
-- Name: employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: job_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: job_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: job_logs karyawan delete own pending; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "karyawan delete own pending" ON public.job_logs FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = job_logs.employee_id) AND (e.profile_id = auth.uid())))) AND (status = 'pending'::public.job_log_status)));


--
-- Name: cashbon karyawan delete own pending cashbon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "karyawan delete own pending cashbon" ON public.cashbon FOR DELETE TO authenticated USING (((status = 'pending'::public.cashbon_status) AND (EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = cashbon.employee_id) AND (e.profile_id = auth.uid()))))));


--
-- Name: job_logs karyawan insert own logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "karyawan insert own logs" ON public.job_logs FOR INSERT TO authenticated WITH CHECK (((EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = job_logs.employee_id) AND (e.profile_id = auth.uid())))) AND (status = 'pending'::public.job_log_status)));


--
-- Name: projects karyawan read active projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "karyawan read active projects" ON public.projects FOR SELECT TO authenticated USING ((status = ANY (ARRAY['draft'::public.project_status, 'active'::public.project_status])));


--
-- Name: projects karyawan read assigned projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "karyawan read assigned projects" ON public.projects FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.project_assignments pa
     JOIN public.employees e ON ((e.id = pa.employee_id)))
  WHERE ((pa.project_id = projects.id) AND (e.profile_id = auth.uid())))));


--
-- Name: job_logs karyawan read own logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "karyawan read own logs" ON public.job_logs FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = job_logs.employee_id) AND (e.profile_id = auth.uid())))) OR public.is_admin_or_owner(auth.uid())));


--
-- Name: cashbon karyawan request own cashbon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "karyawan request own cashbon" ON public.cashbon FOR INSERT TO authenticated WITH CHECK (((status = 'pending'::public.cashbon_status) AND (EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = cashbon.employee_id) AND (e.profile_id = auth.uid()))))));


--
-- Name: job_logs karyawan update own pending; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "karyawan update own pending" ON public.job_logs FOR UPDATE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = job_logs.employee_id) AND (e.profile_id = auth.uid())))) AND (status = 'pending'::public.job_log_status))) WITH CHECK ((status = 'pending'::public.job_log_status));


--
-- Name: material_prices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: orders owner admin write orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner admin write orders" ON public.orders TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: sync_settings owner can insert sync_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner can insert sync_settings" ON public.sync_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));


--
-- Name: sync_settings owner can update sync_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner can update sync_settings" ON public.sync_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'owner'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));


--
-- Name: payrolls owner delete payroll; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner delete payroll" ON public.payrolls FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'owner'::public.app_role));


--
-- Name: user_roles owner manage all roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner manage all roles" ON public.user_roles TO authenticated USING (public.has_role(auth.uid(), 'owner'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));


--
-- Name: material_prices owner write prices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "owner write prices" ON public.material_prices TO authenticated USING (public.has_role(auth.uid(), 'owner'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));


--
-- Name: payrolls payroll read own or staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "payroll read own or staff" ON public.payrolls FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = payrolls.employee_id) AND (e.profile_id = auth.uid())))) OR public.is_admin_or_owner(auth.uid())));


--
-- Name: payrolls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payrolls ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: project_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: employees read own employee or staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read own employee or staff" ON public.employees FOR SELECT TO authenticated USING (((profile_id = auth.uid()) OR public.is_admin_or_owner(auth.uid())));


--
-- Name: profiles read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read own profile" ON public.profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.is_admin_or_owner(auth.uid())));


--
-- Name: user_roles read own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin_or_owner(auth.uid())));


--
-- Name: shipment_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipment_events ENABLE ROW LEVEL SECURITY;

--
-- Name: shipping_carriers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipping_carriers ENABLE ROW LEVEL SECURITY;

--
-- Name: shopee_order_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shopee_order_map ENABLE ROW LEVEL SECURITY;

--
-- Name: shopee_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shopee_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: shopping_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shopping_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: shopping_notes shopping_notes_delete_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shopping_notes_delete_own_or_admin ON public.shopping_notes FOR DELETE TO authenticated USING (((auth.uid() = created_by) OR public.is_admin_or_owner(auth.uid())));


--
-- Name: shopping_notes shopping_notes_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shopping_notes_insert_authenticated ON public.shopping_notes FOR INSERT TO authenticated WITH CHECK ((auth.uid() = created_by));


--
-- Name: shopping_notes shopping_notes_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shopping_notes_select_authenticated ON public.shopping_notes FOR SELECT TO authenticated USING (true);


--
-- Name: shopping_notes shopping_notes_update_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shopping_notes_update_own_or_admin ON public.shopping_notes FOR UPDATE TO authenticated USING (((auth.uid() = created_by) OR public.is_admin_or_owner(auth.uid()) OR (status = 'pending'::text))) WITH CHECK (true);


--
-- Name: shipping_carriers staff manage carriers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff manage carriers" ON public.shipping_carriers TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: cashbon staff manage cashbon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff manage cashbon" ON public.cashbon TO authenticated USING (public.is_admin_or_owner(auth.uid())) WITH CHECK (public.is_admin_or_owner(auth.uid()));


--
-- Name: projects staff read all projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff read all projects" ON public.projects FOR SELECT TO authenticated USING (public.is_admin_or_owner(auth.uid()));


--
-- Name: project_assignments staff read assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "staff read assignments" ON public.project_assignments FOR SELECT TO authenticated USING ((public.is_admin_or_owner(auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = project_assignments.employee_id) AND (e.profile_id = auth.uid()))))));


--
-- Name: sync_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- Name: user_feature_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_feature_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION absorb_referenced_draft(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.absorb_referenced_draft() TO anon;
GRANT ALL ON FUNCTION public.absorb_referenced_draft() TO authenticated;
GRANT ALL ON FUNCTION public.absorb_referenced_draft() TO service_role;


--
-- Name: TABLE job_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.job_logs TO anon;
GRANT ALL ON TABLE public.job_logs TO authenticated;
GRANT ALL ON TABLE public.job_logs TO service_role;


--
-- Name: FUNCTION approve_job_log(_id uuid, _status text, _qty numeric, _amount numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.approve_job_log(_id uuid, _status text, _qty numeric, _amount numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_job_log(_id uuid, _status text, _qty numeric, _amount numeric) TO authenticated;
GRANT ALL ON FUNCTION public.approve_job_log(_id uuid, _status text, _qty numeric, _amount numeric) TO service_role;


--
-- Name: FUNCTION assign_order_no(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.assign_order_no() TO anon;
GRANT ALL ON FUNCTION public.assign_order_no() TO authenticated;
GRANT ALL ON FUNCTION public.assign_order_no() TO service_role;


--
-- Name: FUNCTION attendance_check_in(_token text, _lat double precision, _lng double precision); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.attendance_check_in(_token text, _lat double precision, _lng double precision) TO anon;
GRANT ALL ON FUNCTION public.attendance_check_in(_token text, _lat double precision, _lng double precision) TO authenticated;
GRANT ALL ON FUNCTION public.attendance_check_in(_token text, _lat double precision, _lng double precision) TO service_role;


--
-- Name: FUNCTION calc_consumption_split(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calc_consumption_split() TO anon;
GRANT ALL ON FUNCTION public.calc_consumption_split() TO authenticated;
GRANT ALL ON FUNCTION public.calc_consumption_split() TO service_role;


--
-- Name: FUNCTION calc_job_log_amount(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calc_job_log_amount() FROM PUBLIC;
GRANT ALL ON FUNCTION public.calc_job_log_amount() TO service_role;


--
-- Name: FUNCTION calc_order_costs(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.calc_order_costs() FROM PUBLIC;
GRANT ALL ON FUNCTION public.calc_order_costs() TO service_role;


--
-- Name: FUNCTION calc_order_item_costs(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calc_order_item_costs() TO anon;
GRANT ALL ON FUNCTION public.calc_order_item_costs() TO authenticated;
GRANT ALL ON FUNCTION public.calc_order_item_costs() TO service_role;


--
-- Name: FUNCTION close_projects_after_pickup_delay(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.close_projects_after_pickup_delay() TO anon;
GRANT ALL ON FUNCTION public.close_projects_after_pickup_delay() TO authenticated;
GRANT ALL ON FUNCTION public.close_projects_after_pickup_delay() TO service_role;


--
-- Name: FUNCTION close_projects_for_order(_order_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.close_projects_for_order(_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.close_projects_for_order(_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.close_projects_for_order(_order_id uuid) TO service_role;


--
-- Name: FUNCTION consume_stock_source(_source_order_id uuid, _item_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.consume_stock_source(_source_order_id uuid, _item_id uuid) TO anon;
GRANT ALL ON FUNCTION public.consume_stock_source(_source_order_id uuid, _item_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.consume_stock_source(_source_order_id uuid, _item_id uuid) TO service_role;


--
-- Name: FUNCTION courier_pickup(_no_resi text, _note text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.courier_pickup(_no_resi text, _note text) TO anon;
GRANT ALL ON FUNCTION public.courier_pickup(_no_resi text, _note text) TO authenticated;
GRANT ALL ON FUNCTION public.courier_pickup(_no_resi text, _note text) TO service_role;


--
-- Name: FUNCTION detach_project_from_order(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.detach_project_from_order() TO anon;
GRANT ALL ON FUNCTION public.detach_project_from_order() TO authenticated;
GRANT ALL ON FUNCTION public.detach_project_from_order() TO service_role;


--
-- Name: FUNCTION detach_projects_on_order_delete(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.detach_projects_on_order_delete() TO anon;
GRANT ALL ON FUNCTION public.detach_projects_on_order_delete() TO authenticated;
GRANT ALL ON FUNCTION public.detach_projects_on_order_delete() TO service_role;


--
-- Name: FUNCTION enforce_project_point_limit(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_project_point_limit() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_project_point_limit() TO service_role;


--
-- Name: FUNCTION enforce_single_area_claim(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_single_area_claim() TO anon;
GRANT ALL ON FUNCTION public.enforce_single_area_claim() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_single_area_claim() TO service_role;


--
-- Name: FUNCTION get_active_pipeline(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_active_pipeline() TO anon;
GRANT ALL ON FUNCTION public.get_active_pipeline() TO authenticated;
GRANT ALL ON FUNCTION public.get_active_pipeline() TO service_role;


--
-- Name: FUNCTION get_attendance_secret(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_attendance_secret() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_attendance_secret() TO authenticated;
GRANT ALL ON FUNCTION public.get_attendance_secret() TO service_role;


--
-- Name: FUNCTION get_available_projects(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_available_projects() TO anon;
GRANT ALL ON FUNCTION public.get_available_projects() TO authenticated;
GRANT ALL ON FUNCTION public.get_available_projects() TO service_role;


--
-- Name: FUNCTION get_daily_attendance_token(_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_daily_attendance_token(_date date) TO anon;
GRANT ALL ON FUNCTION public.get_daily_attendance_token(_date date) TO authenticated;
GRANT ALL ON FUNCTION public.get_daily_attendance_token(_date date) TO service_role;


--
-- Name: FUNCTION get_order_history(_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_order_history(_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_order_history(_limit integer) TO service_role;


--
-- Name: FUNCTION get_permanent_attendance_token(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_permanent_attendance_token() TO anon;
GRANT ALL ON FUNCTION public.get_permanent_attendance_token() TO authenticated;
GRANT ALL ON FUNCTION public.get_permanent_attendance_token() TO service_role;


--
-- Name: FUNCTION get_project_detail_for_worker(_project_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_project_detail_for_worker(_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_project_detail_for_worker(_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_project_detail_for_worker(_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_project_detail_for_worker(_project_id uuid) TO service_role;


--
-- Name: FUNCTION get_project_rate_availability(_project_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_project_rate_availability(_project_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_project_rate_availability(_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_project_rate_availability(_project_id uuid) TO service_role;


--
-- Name: FUNCTION get_repairable_orders(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_repairable_orders() TO anon;
GRANT ALL ON FUNCTION public.get_repairable_orders() TO authenticated;
GRANT ALL ON FUNCTION public.get_repairable_orders() TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION has_role(_user_id uuid, _role public.app_role); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO authenticated;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO service_role;


--
-- Name: FUNCTION is_admin_or_owner(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_admin_or_owner(_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin_or_owner(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_admin_or_owner(_user_id uuid) TO service_role;


--
-- Name: FUNCTION link_project_to_order(_project_id uuid, _order_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.link_project_to_order(_project_id uuid, _order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.link_project_to_order(_project_id uuid, _order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.link_project_to_order(_project_id uuid, _order_id uuid) TO service_role;


--
-- Name: FUNCTION lookup_order_by_resi(_query text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.lookup_order_by_resi(_query text) TO anon;
GRANT ALL ON FUNCTION public.lookup_order_by_resi(_query text) TO authenticated;
GRANT ALL ON FUNCTION public.lookup_order_by_resi(_query text) TO service_role;


--
-- Name: FUNCTION mark_ready_pickup(_order_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mark_ready_pickup(_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.mark_ready_pickup(_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.mark_ready_pickup(_order_id uuid) TO service_role;


--
-- Name: FUNCTION mark_ready_pickup_by_resi(_no_resi text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mark_ready_pickup_by_resi(_no_resi text) TO anon;
GRANT ALL ON FUNCTION public.mark_ready_pickup_by_resi(_no_resi text) TO authenticated;
GRANT ALL ON FUNCTION public.mark_ready_pickup_by_resi(_no_resi text) TO service_role;


--
-- Name: FUNCTION next_project_code(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.next_project_code() TO anon;
GRANT ALL ON FUNCTION public.next_project_code() TO authenticated;
GRANT ALL ON FUNCTION public.next_project_code() TO service_role;


--
-- Name: FUNCTION recalc_order_repair_cost(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.recalc_order_repair_cost() TO anon;
GRANT ALL ON FUNCTION public.recalc_order_repair_cost() TO authenticated;
GRANT ALL ON FUNCTION public.recalc_order_repair_cost() TO service_role;


--
-- Name: FUNCTION refresh_order_from_items(_oid uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.refresh_order_from_items(_oid uuid) TO anon;
GRANT ALL ON FUNCTION public.refresh_order_from_items(_oid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.refresh_order_from_items(_oid uuid) TO service_role;


--
-- Name: FUNCTION rotate_attendance_secret(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rotate_attendance_secret() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rotate_attendance_secret() TO authenticated;
GRANT ALL ON FUNCTION public.rotate_attendance_secret() TO service_role;


--
-- Name: FUNCTION set_attendance_note(_attendance_id uuid, _note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_attendance_note(_attendance_id uuid, _note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_attendance_note(_attendance_id uuid, _note text) TO authenticated;
GRANT ALL ON FUNCTION public.set_attendance_note(_attendance_id uuid, _note text) TO service_role;


--
-- Name: FUNCTION set_expense_defaults(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_expense_defaults() TO anon;
GRANT ALL ON FUNCTION public.set_expense_defaults() TO authenticated;
GRANT ALL ON FUNCTION public.set_expense_defaults() TO service_role;


--
-- Name: FUNCTION sync_item_to_project(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_item_to_project() TO anon;
GRANT ALL ON FUNCTION public.sync_item_to_project() TO authenticated;
GRANT ALL ON FUNCTION public.sync_item_to_project() TO service_role;


--
-- Name: FUNCTION sync_order_to_project(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_order_to_project() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_order_to_project() TO service_role;


--
-- Name: FUNCTION trg_refresh_order_from_items(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_refresh_order_from_items() TO anon;
GRANT ALL ON FUNCTION public.trg_refresh_order_from_items() TO authenticated;
GRANT ALL ON FUNCTION public.trg_refresh_order_from_items() TO service_role;


--
-- Name: FUNCTION update_attendance_location(_lat double precision, _lng double precision, _radius integer, _enforce boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_attendance_location(_lat double precision, _lng double precision, _radius integer, _enforce boolean) TO anon;
GRANT ALL ON FUNCTION public.update_attendance_location(_lat double precision, _lng double precision, _radius integer, _enforce boolean) TO authenticated;
GRANT ALL ON FUNCTION public.update_attendance_location(_lat double precision, _lng double precision, _radius integer, _enforce boolean) TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: TABLE attendance_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.attendance_settings TO anon;
GRANT ALL ON TABLE public.attendance_settings TO authenticated;
GRANT ALL ON TABLE public.attendance_settings TO service_role;


--
-- Name: TABLE attendances; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.attendances TO anon;
GRANT ALL ON TABLE public.attendances TO authenticated;
GRANT ALL ON TABLE public.attendances TO service_role;


--
-- Name: TABLE cashbon; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cashbon TO anon;
GRANT ALL ON TABLE public.cashbon TO authenticated;
GRANT ALL ON TABLE public.cashbon TO service_role;


--
-- Name: TABLE customers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customers TO anon;
GRANT ALL ON TABLE public.customers TO authenticated;
GRANT ALL ON TABLE public.customers TO service_role;


--
-- Name: TABLE employee_consumption; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.employee_consumption TO anon;
GRANT ALL ON TABLE public.employee_consumption TO authenticated;
GRANT ALL ON TABLE public.employee_consumption TO service_role;


--
-- Name: TABLE employees; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.employees TO anon;
GRANT ALL ON TABLE public.employees TO authenticated;
GRANT ALL ON TABLE public.employees TO service_role;


--
-- Name: TABLE expenses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.expenses TO anon;
GRANT ALL ON TABLE public.expenses TO authenticated;
GRANT ALL ON TABLE public.expenses TO service_role;


--
-- Name: TABLE job_rates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.job_rates TO anon;
GRANT ALL ON TABLE public.job_rates TO authenticated;
GRANT ALL ON TABLE public.job_rates TO service_role;


--
-- Name: TABLE material_prices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.material_prices TO anon;
GRANT ALL ON TABLE public.material_prices TO authenticated;
GRANT ALL ON TABLE public.material_prices TO service_role;


--
-- Name: TABLE order_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_items TO anon;
GRANT ALL ON TABLE public.order_items TO authenticated;
GRANT ALL ON TABLE public.order_items TO service_role;


--
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orders TO anon;
GRANT ALL ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;


--
-- Name: TABLE payrolls; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payrolls TO anon;
GRANT ALL ON TABLE public.payrolls TO authenticated;
GRANT ALL ON TABLE public.payrolls TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE project_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_assignments TO anon;
GRANT ALL ON TABLE public.project_assignments TO authenticated;
GRANT ALL ON TABLE public.project_assignments TO service_role;


--
-- Name: TABLE projects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.projects TO anon;
GRANT ALL ON TABLE public.projects TO authenticated;
GRANT ALL ON TABLE public.projects TO service_role;


--
-- Name: TABLE shipment_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shipment_events TO anon;
GRANT ALL ON TABLE public.shipment_events TO authenticated;
GRANT ALL ON TABLE public.shipment_events TO service_role;


--
-- Name: TABLE shipping_carriers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shipping_carriers TO anon;
GRANT ALL ON TABLE public.shipping_carriers TO authenticated;
GRANT ALL ON TABLE public.shipping_carriers TO service_role;


--
-- Name: TABLE shopee_order_map; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shopee_order_map TO anon;
GRANT ALL ON TABLE public.shopee_order_map TO authenticated;
GRANT ALL ON TABLE public.shopee_order_map TO service_role;


--
-- Name: TABLE shopee_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shopee_settings TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.shopee_settings TO authenticated;
GRANT ALL ON TABLE public.shopee_settings TO service_role;


--
-- Name: COLUMN shopee_settings.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.shop_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(shop_id) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.token_expires_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(token_expires_at) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.connected_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(connected_at) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.enabled; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(enabled) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.lookback_days; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(lookback_days) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.last_sync_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last_sync_at) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.last_sync_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last_sync_status) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.last_sync_message; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last_sync_message) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.last_sync_inserted; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last_sync_inserted) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.last_sync_updated; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last_sync_updated) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.last_sync_skipped; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(last_sync_skipped) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.partner_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(partner_id) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: COLUMN shopee_settings.redirect_url; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(redirect_url) ON TABLE public.shopee_settings TO authenticated;


--
-- Name: TABLE shopping_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shopping_notes TO anon;
GRANT ALL ON TABLE public.shopping_notes TO authenticated;
GRANT ALL ON TABLE public.shopping_notes TO service_role;


--
-- Name: TABLE sync_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sync_settings TO anon;
GRANT ALL ON TABLE public.sync_settings TO authenticated;
GRANT ALL ON TABLE public.sync_settings TO service_role;


--
-- Name: TABLE user_feature_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_feature_permissions TO anon;
GRANT ALL ON TABLE public.user_feature_permissions TO authenticated;
GRANT ALL ON TABLE public.user_feature_permissions TO service_role;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--



--
-- Trigger pendaftaran user baru (schema auth)
--

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();



-- =====================================================================
-- DATA AWAL (master harga, ekspedisi, tarif borongan, setelan absensi)
-- =====================================================================

INSERT INTO public.attendance_settings (id, secret, updated_at, workshop_lat, workshop_lng, radius_meters, enforce_location) VALUES
	(1, 'd3072f362ce01ef69108720729ef6b6a93f08f34fbedfb88f8a326584c6e3202', '2026-07-06 00:25:10.45202+00', -7.359888, 108.188332, 20, true);

INSERT INTO public.job_rates (id, name, unit, rate_per_unit, active, note, created_at, updated_at, pricing_mode, min_amount, sort_order, area_scope, require_photo) VALUES
	('1c8ec25c-4b35-4ee4-9171-70f0f3b088da', 'POTONG', 'TIK', 100.00, true, NULL, '2026-06-23 08:04:35.275897+00', '2026-07-15 13:40:12.373605+00', 'per_unit', 0, 1, 'project', false),
	('bc923800-56b2-4f8b-a7bd-21d6f9386925', 'SOLDER', 'TIK', 1200.00, true, NULL, '2026-06-23 08:04:46.472036+00', '2026-07-15 13:40:41.036846+00', 'per_unit', 0, 2, 'project', false),
	('c2503f50-ce7c-4f7d-8599-b7ce60097c69', 'TEMPEL', 'TIK', 1000.00, true, NULL, '2026-06-23 08:05:12.736921+00', '2026-07-15 13:41:12.165021+00', 'per_unit', 0, 3, 'project', false),
	('bf13f41c-388b-4431-8cbb-7be21338e204', 'KABEL', 'TIK', 1000.00, true, NULL, '2026-06-23 08:05:20.290284+00', '2026-08-19 12:19:35.333896+00', 'per_unit', 0, 4, 'project', true),
	('4f93f4f3-8acd-4559-9731-738ff264a95b', 'CUT AKRILIK', 'cm²', 1.00, false, NULL, '2026-07-14 08:59:03.119426+00', '2026-08-26 11:36:57.468025+00', 'area', 3000, 5, 'project', false),
	('2622f8a6-b6b8-48eb-b564-b27e30a6ae87', 'PACKING', 'cm²', 2.00, false, NULL, '2026-07-14 09:16:57.690037+00', '2026-08-26 11:37:03.334022+00', 'area', 3000, 6, 'order', false);

INSERT INTO public.material_prices (key, label, value, unit, updated_at) VALUES
	('solder_per_titik', 'Solder', 1300, 'per titik', '2026-06-22 08:34:25.374162+00'),
	('tempel_per_titik', 'Tempel', 2000, 'per titik', '2026-06-22 08:34:25.374162+00'),
	('kabel_per_meter', 'Kabel', 1300, 'per meter', '2026-06-22 08:34:25.374162+00'),
	('socket_dc_default', 'Socket DC (default)', 700, 'per pcs', '2026-06-22 08:34:25.374162+00'),
	('baut_fischer_default', 'Baut Fischer (default)', 3000, 'per set', '2026-06-22 08:34:25.374162+00'),
	('modul_default', 'Modul (default)', 4000, 'per pcs', '2026-06-22 08:34:25.374162+00'),
	('adaptor_default', 'Adaptor (default)', 8000, 'per pcs', '2026-06-22 08:34:25.374162+00'),
	('kabel_socket_per_meter', 'Kabel Socket', 2500, 'meter', '2026-06-22 08:34:25.374162+00'),
	('adaptor_2a', 'Adaptor 2A (≤3m LED)', 8000, 'per pcs', '2026-06-23 08:35:08.821727+00'),
	('adaptor_3a', 'Adaptor 3A (≤5m LED)', 15000, 'per pcs', '2026-06-23 08:35:08.821727+00'),
	('adaptor_3a_murni', 'Adaptor 3A Murni (≤8m LED)', 30000, 'per pcs', '2026-06-23 08:35:08.821727+00'),
	('adaptor_5a_murni', 'Adaptor 5A Murni (≤11m LED)', 40000, 'per pcs', '2026-06-23 08:35:08.821727+00'),
	('marketplace_markup_pct', 'Markup Harga Marketplace', 25, 'persen', '2026-08-21 05:57:13.936+00'),
	('meal_allowance_per_person', 'Uang Makan Karyawan (per konsumsi)', 5000, 'per konsumsi', '2026-07-06 06:49:24.166858+00'),
	('akrilik_per_cm2', 'Akrilik', 15, 'per cm²', '2026-09-05 02:56:07.816+00'),
	('led_per_meter', 'LED Strip', 8500, 'per meter', '2026-09-05 02:56:30.713+00');

INSERT INTO public.shipping_carriers (id, name, active, sort_order, created_at, updated_at) VALUES
	('85a8d7dc-a90f-4f95-a1fd-5f354fe6d5b5', 'SPX', true, 10, '2026-07-08 02:50:24.493223+00', '2026-07-08 02:56:05.377322+00'),
	('037346a4-1754-4d8b-ba18-56b0d7f66221', 'J&T Reguler', true, 20, '2026-07-08 02:50:24.493223+00', '2026-07-08 02:56:06.188163+00'),
	('3ca1e96f-3c04-4876-a452-d88792074c8b', 'J&T Cargo', true, 30, '2026-07-08 02:50:24.493223+00', '2026-07-08 02:56:06.209904+00'),
	('9e17fa64-e981-4b34-9dcd-21a81e492c7a', 'Lainnya', false, 999, '2026-07-08 02:50:24.493223+00', '2026-07-08 02:56:09.734098+00'),
	('82e7affe-0e34-4b8b-8426-4779fe1f3799', 'Grab Express', false, 100, '2026-07-08 02:50:24.493223+00', '2026-07-08 02:56:10.098649+00'),
	('be81f4ad-c62b-4bb7-97b7-c47a5523a141', 'Lion Parcel', false, 80, '2026-07-08 02:50:24.493223+00', '2026-07-08 02:56:10.810013+00'),
	('60325c20-2a57-4fc7-9761-ec037a4e4714', 'GoSend', false, 90, '2026-07-08 02:50:24.493223+00', '2026-07-08 02:56:11.025882+00'),
	('d3a41d18-afa9-4374-95fe-30b2b4e737e7', 'ID Express', false, 70, '2026-07-08 02:50:24.493223+00', '2026-07-08 02:56:11.228154+00'),
	('2b41b0a4-20e6-4e4c-a1f5-f7a16c0c715c', 'Pos Indonesia', false, 60, '2026-07-08 02:50:24.493223+00', '2026-07-08 02:56:11.557193+00'),
	('17206914-b003-4a5f-87a4-19bb121052b7', 'Ninja', false, 50, '2026-07-08 02:50:24.493223+00', '2026-07-08 02:56:12.157009+00'),
	('fd728e00-13f2-481f-ac28-c763a0e6a8a1', 'JNE', true, 40, '2026-07-08 02:50:24.493223+00', '2026-07-08 02:56:12.483764+00'),
	('a89bfff4-ff7f-442c-a8cb-df4a0b06e8b4', 'SPX Standard', true, 1000, '2026-09-02 07:33:19.393781+00', '2026-09-02 07:33:19.393781+00'),
	('fb3f4cda-9b95-47b1-8161-9f35e2f1aec4', 'SPX Hemat', true, 1001, '2026-09-03 02:49:54.934449+00', '2026-09-03 02:49:54.934449+00'),
	('831b08e8-aac5-4693-8481-66068734b176', 'Hemat Kargo', true, 1002, '2026-09-03 03:01:40.436712+00', '2026-09-03 03:01:40.436712+00');


-- =====================================================================
-- CATATAN: penjadwal otomatis (pg_cron) sengaja TIDAK disertakan karena
-- alamat lama menunjuk ke Lovable. Gunakan Vercel Cron sesuai DEPLOY.md:
--   POST /api/public/hooks/sync-shopee    (tiap jam)
--   POST /api/public/hooks/sync-projects  (tiap jam)
-- =====================================================================
