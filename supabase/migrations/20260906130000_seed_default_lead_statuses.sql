-- Standard default lead statuses for every account. Additive only: existing
-- custom statuses are left untouched; we insert any of the five canonical
-- statuses not already present (case-insensitive by name). New leads default to
-- "New" (enforced in the lead form). New accounts are seeded in the
-- provision-account route.
WITH defaults(name, color, position) AS (
  VALUES
    ('New', '#3b82f6', 0),
    ('Qualified', '#8b5cf6', 1),
    ('Hot', '#ef4444', 2),
    ('Follow-up', '#eab308', 3),
    ('Disqualified', '#6b7280', 4)
)
INSERT INTO public.lead_statuses (account_id, name, color, position)
SELECT a.id, d.name, d.color, d.position
FROM public.accounts a
CROSS JOIN defaults d
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_statuses ls
  WHERE ls.account_id = a.id AND lower(ls.name) = lower(d.name)
);
