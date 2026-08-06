-- Migration para criar a RPC get_prioridades_dashboard

CREATE OR REPLACE FUNCTION public.get_prioridades_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  
  v_count_pending int;
  v_items_pending jsonb;
  
  v_count_no_phone int;
  v_items_no_phone jsonb;
  
  v_count_stale_leads int;
  v_items_stale_leads jsonb;
  
  v_count_new_contacts int;
  v_items_new_contacts jsonb;
BEGIN
  -- 1. Pendentes de qualificação
  SELECT count(*) INTO v_count_pending
  FROM public.contacts
  WHERE operational_status = 'active'
    AND archived_at IS NULL
    AND classification = 'person';

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_items_pending
  FROM (
    SELECT jsonb_build_object(
      'id', id,
      'display_name', display_name,
      'classification', classification,
      'created_at', created_at,
      'updated_at', updated_at
    ) AS item
    FROM public.contacts
    WHERE operational_status = 'active'
      AND archived_at IS NULL
      AND classification = 'person'
    ORDER BY updated_at DESC
    LIMIT 10
  ) sub;

  -- 2. Sem telefone
  SELECT count(*) INTO v_count_no_phone
  FROM public.contacts c
  WHERE c.operational_status = 'active'
    AND c.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1 
      FROM public.contact_points cp 
      WHERE cp.contact_id = c.id 
        AND cp.point_type = 'phone' 
        AND cp.operational_status = 'active'
    );

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_items_no_phone
  FROM (
    SELECT jsonb_build_object(
      'id', c.id,
      'display_name', c.display_name,
      'classification', c.classification,
      'created_at', c.created_at,
      'updated_at', c.updated_at
    ) AS item
    FROM public.contacts c
    WHERE c.operational_status = 'active'
      AND c.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 
        FROM public.contact_points cp 
        WHERE cp.contact_id = c.id 
          AND cp.point_type = 'phone' 
          AND cp.operational_status = 'active'
      )
    ORDER BY c.updated_at DESC
    LIMIT 10
  ) sub;

  -- 3. Leads sem revisão recente
  SELECT count(*) INTO v_count_stale_leads
  FROM public.contacts
  WHERE operational_status = 'active'
    AND archived_at IS NULL
    AND classification = 'lead'
    AND updated_at < (now() - interval '15 days');

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_items_stale_leads
  FROM (
    SELECT jsonb_build_object(
      'id', id,
      'display_name', display_name,
      'classification', classification,
      'created_at', created_at,
      'updated_at', updated_at
    ) AS item
    FROM public.contacts
    WHERE operational_status = 'active'
      AND archived_at IS NULL
      AND classification = 'lead'
      AND updated_at < (now() - interval '15 days')
    ORDER BY updated_at ASC
    LIMIT 10
  ) sub;

  -- 4. Novos nos últimos 7 dias
  SELECT count(*) INTO v_count_new_contacts
  FROM public.contacts
  WHERE operational_status = 'active'
    AND archived_at IS NULL
    AND created_at >= (now() - interval '7 days');

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_items_new_contacts
  FROM (
    SELECT jsonb_build_object(
      'id', id,
      'display_name', display_name,
      'classification', classification,
      'created_at', created_at,
      'updated_at', updated_at
    ) AS item
    FROM public.contacts
    WHERE operational_status = 'active'
      AND archived_at IS NULL
      AND created_at >= (now() - interval '7 days')
    ORDER BY created_at DESC
    LIMIT 10
  ) sub;

  -- Build final JSON
  v_result := jsonb_build_object(
    'pending_qualification', jsonb_build_object('count', v_count_pending, 'items', v_items_pending),
    'without_phone', jsonb_build_object('count', v_count_no_phone, 'items', v_items_no_phone),
    'stale_leads', jsonb_build_object('count', v_count_stale_leads, 'items', v_items_stale_leads),
    'new_contacts', jsonb_build_object('count', v_count_new_contacts, 'items', v_items_new_contacts)
  );

  RETURN v_result;
END;
$$;
