-- ============================================================
-- 058_expense_management.sql
-- Introduces Expense Types and Expenses tables for the new
-- Expense & Allowance Management Module.
-- ============================================================

-- 1. Create Enums if they don't exist
DO $$ BEGIN
    CREATE TYPE expense_allowance_type AS ENUM ('REGULAR', 'TRAVELLING');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE expense_is_per_km AS ENUM ('NO', 'SYSTEM', 'USER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE expense_status_type AS ENUM ('Pending', 'Approved', 'Rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create expense_types table
CREATE TABLE IF NOT EXISTS expense_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    allowance_type expense_allowance_type NOT NULL,
    expense_name TEXT NOT NULL,
    default_amount NUMERIC(12, 2) DEFAULT 0,
    is_per_km expense_is_per_km DEFAULT 'NO',
    rate_per_km NUMERIC(10, 2) DEFAULT 0,
    amount_changeable BOOLEAN DEFAULT true,
    proof_required BOOLEAN DEFAULT false,
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_types_account ON expense_types(account_id);
ALTER TABLE expense_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_types_select" ON expense_types;
CREATE POLICY "expense_types_select" ON expense_types 
    FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS "expense_types_all" ON expense_types;
CREATE POLICY "expense_types_all" ON expense_types 
    FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));

-- Trigger for updated_at
CREATE OR REPLACE TRIGGER set_expense_types_updated_at
BEFORE UPDATE ON expense_types
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 3. Create expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    expense_type_id UUID NOT NULL REFERENCES expense_types(id) ON DELETE RESTRICT,
    expense_date DATE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    travel_km NUMERIC(10, 2),
    rate_per_km NUMERIC(10, 2),
    proof_file TEXT,
    remarks TEXT,
    status expense_status_type NOT NULL DEFAULT 'Pending',
    approved_amount NUMERIC(12, 2),
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_account ON expenses(account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_employee ON expenses(employee_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Employees can view their own, Admins can view all
DROP POLICY IF EXISTS "expenses_select" ON expenses;
CREATE POLICY "expenses_select" ON expenses 
    FOR SELECT USING (
        is_account_member(account_id, 'admin') 
        OR 
        (is_account_member(account_id) AND employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()))
    );

-- Employees can insert their own expenses
DROP POLICY IF EXISTS "expenses_insert" ON expenses;
CREATE POLICY "expenses_insert" ON expenses 
    FOR INSERT WITH CHECK (
        is_account_member(account_id) 
        AND employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    );

-- Employees can update their own pending expenses. Admins can update all (for approval).
DROP POLICY IF EXISTS "expenses_update" ON expenses;
CREATE POLICY "expenses_update" ON expenses 
    FOR UPDATE USING (
        is_account_member(account_id, 'admin')
        OR
        (is_account_member(account_id) AND employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) AND status = 'Pending')
    );

-- Only employees can delete their own pending expenses. Admins can delete any.
DROP POLICY IF EXISTS "expenses_delete" ON expenses;
CREATE POLICY "expenses_delete" ON expenses 
    FOR DELETE USING (
        is_account_member(account_id, 'admin')
        OR
        (is_account_member(account_id) AND employee_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) AND status = 'Pending')
    );

-- Trigger for updated_at
CREATE OR REPLACE TRIGGER set_expenses_updated_at
BEFORE UPDATE ON expenses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- 4. Alter tasks to add expense_id
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tasks_expense_id ON tasks(expense_id);
