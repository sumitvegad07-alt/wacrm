-- Rename legacy add_* permissions to create_* in employee_roles

UPDATE employee_roles
SET permissions = (
  SELECT jsonb_object_agg(
    CASE 
      WHEN key = 'add_leads' THEN 'create_leads'
      WHEN key = 'add_contacts' THEN 'create_contacts'
      WHEN key = 'add_orders' THEN 'create_orders'
      WHEN key = 'add_payments' THEN 'create_payments'
      ELSE key
    END,
    value
  )
  FROM jsonb_each(permissions)
)
WHERE permissions IS NOT NULL;
