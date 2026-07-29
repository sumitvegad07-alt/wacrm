-- ============================================================
-- Migration 098: Custom Fields Table & Validation Flags
-- ============================================================
-- Adds admin-configurable flags to custom_fields:
-- is_required: compulsory field validation in module forms
-- show_in_table: whether the field column appears in data tables
-- is_sortable: whether table column is sortable
-- is_searchable: whether field value is searched in global table search
-- is_filterable: whether table column has filter controls

ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_in_table BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_sortable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_searchable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_filterable BOOLEAN NOT NULL DEFAULT true;
