ALTER TABLE employee_devices ADD COLUMN IF NOT EXISTS application_version TEXT, ADD COLUMN IF NOT EXISTS database_version TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plain_password TEXT;
