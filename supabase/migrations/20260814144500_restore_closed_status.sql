-- Restore Closed status to allowed transitions
CREATE OR REPLACE FUNCTION public.order_status_transition_allowed(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_from, p_to) IN (
    ('Pending','Approved'), ('Pending','Rejected'), ('Pending','Cancelled'),
    ('Approved','Dispatched'), ('Approved','Rejected'), ('Approved','Cancelled'),
    ('Approved','Part Dispatch'), ('Approved', 'Closed'),
    ('Part Dispatch','Dispatched'), ('Part Dispatch','Approved'),
    ('Part Dispatch','Cancelled'), ('Part Dispatch','Rejected'), ('Part Dispatch', 'Closed'),
    ('Dispatched','Part Dispatch'), ('Dispatched','Approved'), ('Dispatched', 'Closed')
  );
$$;
