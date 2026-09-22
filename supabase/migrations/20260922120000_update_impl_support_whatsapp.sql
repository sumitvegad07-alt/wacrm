-- Point the "Getting Started" WhatsApp support button at OZZO's real support
-- number (+91 92271 26301). The original seed shipped a placeholder
-- (919000000000); the seed's ON CONFLICT now keeps this in sync, but the row was
-- already inserted, so bump the live value here too. Idempotent.
UPDATE impl_templates
SET support_whatsapp_url = replace(support_whatsapp_url, '919000000000', '919227126301')
WHERE support_whatsapp_url LIKE '%919000000000%';
