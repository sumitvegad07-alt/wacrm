-- Table for storing custom field values for expenses
CREATE TABLE IF NOT EXISTS expense_custom_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
    custom_field_id UUID REFERENCES custom_fields(id) ON DELETE CASCADE,
    value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
    UNIQUE(expense_id, custom_field_id)
);

-- RLS
ALTER TABLE expense_custom_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view expense custom values in their account" 
    ON expense_custom_values FOR SELECT 
    USING (
        expense_id IN (
            SELECT id FROM expenses 
            WHERE account_id = (SELECT auth.jwt() ->> 'account_id')::UUID
        )
    );

CREATE POLICY "Users can insert expense custom values in their account" 
    ON expense_custom_values FOR INSERT 
    WITH CHECK (
        expense_id IN (
            SELECT id FROM expenses 
            WHERE account_id = (SELECT auth.jwt() ->> 'account_id')::UUID
        )
    );

CREATE POLICY "Users can update their expense custom values" 
    ON expense_custom_values FOR UPDATE 
    USING (
        expense_id IN (
            SELECT id FROM expenses 
            WHERE account_id = (SELECT auth.jwt() ->> 'account_id')::UUID
        )
    );

CREATE POLICY "Users can delete their expense custom values" 
    ON expense_custom_values FOR DELETE 
    USING (
        expense_id IN (
            SELECT id FROM expenses 
            WHERE account_id = (SELECT auth.jwt() ->> 'account_id')::UUID
        )
    );


