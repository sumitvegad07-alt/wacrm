export type ProductType = 'Product' | 'Service' | 'Bundle';
export type ProductStatus = 'Draft' | 'Active' | 'Retired';

export interface Product {
  id: string;
  sku: string;
  name: string;
  type: ProductType;
  status: ProductStatus;
  
  // Future-proofing for CRM-XXX (Inventory)
  inventoryReferenceId?: string;
  
  // Notice: NO price fields.
  
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}
