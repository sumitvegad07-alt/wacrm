-- Module A — Buying Status
\set ON_ERROR_STOP off
DELETE FROM qa_results WHERE scenario LIKE 'A%';

SELECT set_config('test.uid', '11110000-0000-0000-0000-000000000001', false);  -- Admin A

-- A3/A5: the first live order makes a buyer and stamps first_order_at.
INSERT INTO orders(account_id, user_id, order_number, contact_id, status, date)
VALUES ('aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','ORD-A1',
        'c0000000-0000-0000-0000-000000000001','Pending','2026-03-01');
SELECT qa('A5 first live order makes a buyer',
  (SELECT buying_status = 'buyer' AND first_order_at IS NOT NULL FROM contacts WHERE id='c0000000-0000-0000-0000-000000000001'),
  (SELECT 'status='||buying_status||' first_order_at='||coalesce(first_order_at::text,'null') FROM contacts WHERE id='c0000000-0000-0000-0000-000000000001'));

-- A4: cancelled / rejected orders do not count.
INSERT INTO orders(account_id, user_id, order_number, contact_id, status, date)
VALUES ('aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','ORD-A2',
        'c0000000-0000-0000-0000-000000000002','Cancelled','2026-03-02');
INSERT INTO orders(account_id, user_id, order_number, contact_id, status, date)
VALUES ('aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','ORD-A3',
        'c0000000-0000-0000-0000-000000000002','Rejected','2026-03-03');
SELECT qa('A4 cancelled/rejected orders do not make a buyer',
  (SELECT buying_status = 'yet_to_buy' FROM contacts WHERE id='c0000000-0000-0000-0000-000000000002'),
  (SELECT 'status='||buying_status FROM contacts WHERE id='c0000000-0000-0000-0000-000000000002'));

-- A6: cancelling the only live order reverts the customer.
UPDATE orders SET status='Cancelled' WHERE order_number='ORD-A1';
SELECT qa('A6 cancelling the only live order reverts to yet_to_buy',
  (SELECT buying_status = 'yet_to_buy' FROM contacts WHERE id='c0000000-0000-0000-0000-000000000001'),
  (SELECT 'status='||buying_status FROM contacts WHERE id='c0000000-0000-0000-0000-000000000001'));
UPDATE orders SET status='Pending' WHERE order_number='ORD-A1';   -- put it back

-- A7: a human override locks the row and records who/when.
SELECT set_buying_status('c0000000-0000-0000-0000-000000000003','buyer',NULL);
SELECT qa('A7 manual override locks the row and records who',
  (SELECT buying_status='buyer' AND buying_status_locked AND buying_status_set_by IS NOT NULL AND buying_status_set_at IS NOT NULL
     FROM contacts WHERE id='c0000000-0000-0000-0000-000000000003'),
  (SELECT 'locked='||buying_status_locked||' by='||coalesce(buying_status_set_by::text,'null') FROM contacts WHERE id='c0000000-0000-0000-0000-000000000003'));

-- A8: a locked row ignores order history.
SELECT set_buying_status('c0000000-0000-0000-0000-000000000003','yet_to_buy',NULL);
INSERT INTO orders(account_id, user_id, order_number, contact_id, status, date)
VALUES ('aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','ORD-A4',
        'c0000000-0000-0000-0000-000000000003','Pending','2026-03-04');
SELECT qa('A8 a locked row ignores a new order',
  (SELECT buying_status = 'yet_to_buy' FROM contacts WHERE id='c0000000-0000-0000-0000-000000000003'),
  (SELECT 'status='||buying_status||' (a real order exists)' FROM contacts WHERE id='c0000000-0000-0000-0000-000000000003'));

-- A9 / A10 / A13: the database refuses what the form refuses.
SELECT qa_refused('A9 blacklist with no reason is refused (RPC)',
  $$SELECT set_buying_status('c0000000-0000-0000-0000-000000000001','blacklist',NULL)$$);
SELECT qa_refused('A10 blacklist with a whitespace reason is refused (RPC)',
  $$SELECT set_buying_status('c0000000-0000-0000-0000-000000000001','blacklist','   ')$$);
SELECT qa_refused('A9b blacklist with no reason is refused (direct UPDATE)',
  $$UPDATE contacts SET buying_status='blacklist', buying_status_reason=NULL WHERE id='c0000000-0000-0000-0000-000000000001'$$);
SELECT qa_refused('A13 an invalid status value is refused',
  $$UPDATE contacts SET buying_status='banana' WHERE id='c0000000-0000-0000-0000-000000000001'$$);
SELECT qa_refused('A13b an invalid status via the RPC is refused',
  $$SELECT set_buying_status('c0000000-0000-0000-0000-000000000001','banana',NULL)$$);

-- A11 / A12: blacklist, then try to release the lock; then move off it.
SELECT set_buying_status('c0000000-0000-0000-0000-000000000002','blacklist','Cheque bounced twice');
SELECT qa('A9c blacklist with a real reason is accepted',
  (SELECT buying_status='blacklist' AND buying_status_reason='Cheque bounced twice' FROM contacts WHERE id='c0000000-0000-0000-0000-000000000002'),
  (SELECT 'status='||buying_status||' reason='||coalesce(buying_status_reason,'null') FROM contacts WHERE id='c0000000-0000-0000-0000-000000000002'));
SELECT qa_refused('A11 releasing the lock while blacklisted is refused',
  $$SELECT clear_buying_status_lock('c0000000-0000-0000-0000-000000000002')$$);
SELECT set_buying_status('c0000000-0000-0000-0000-000000000002','yet_to_buy',NULL);
SELECT qa('A12 moving off blacklist clears the reason',
  (SELECT buying_status='yet_to_buy' AND buying_status_reason IS NULL FROM contacts WHERE id='c0000000-0000-0000-0000-000000000002'),
  (SELECT 'status='||buying_status||' reason='||coalesce(buying_status_reason,'null') FROM contacts WHERE id='c0000000-0000-0000-0000-000000000002'));

-- A14: a non-admin with no explicit right may not set it.
SELECT set_config('test.uid', '11110000-0000-0000-0000-000000000002', false);  -- Agent A
SELECT qa_refused('A14 a non-admin without manage_buying_status is refused',
  $$SELECT set_buying_status('c0000000-0000-0000-0000-000000000001','buyer',NULL)$$);

-- A14b: someone from another tenant may not touch tenant A's customer.
SELECT set_config('test.uid', '22220000-0000-0000-0000-000000000001', false);  -- Admin B
SELECT qa_refused('A14b an admin of another tenant is refused',
  $$SELECT set_buying_status('c0000000-0000-0000-0000-000000000001','buyer',NULL)$$);

-- A15: the status write must not trip migration 076's hierarchy trigger.
SELECT set_config('test.uid', '11110000-0000-0000-0000-000000000001', false);
UPDATE accounts SET settings = jsonb_set(settings,'{order_settings,hierarchy_enabled}','true')
 WHERE id='aaaa0000-0000-0000-0000-000000000001';
SELECT qa_allowed('A15 an order saves for a level-less customer when Customer Level is ON',
  $$INSERT INTO orders(account_id, user_id, order_number, contact_id, status, date)
    VALUES ('aaaa0000-0000-0000-0000-000000000001','11110000-0000-0000-0000-000000000001','ORD-A5',
            'c0000000-0000-0000-0000-000000000001','Pending','2026-03-05')$$);
UPDATE accounts SET settings = jsonb_set(settings,'{order_settings,hierarchy_enabled}','false')
 WHERE id='aaaa0000-0000-0000-0000-000000000001';

SELECT scenario, CASE WHEN pass THEN 'PASS' ELSE '**FAIL**' END AS result, detail FROM qa_results WHERE scenario LIKE 'A%' ORDER BY id;
