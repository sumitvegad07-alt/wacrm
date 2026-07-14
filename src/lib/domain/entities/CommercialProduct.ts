export interface CommercialProduct {
  id: string;
  productId: string; // References core Product identity
  
  commercialName: string; // How it's sold to the customer
  commercialDescription: string;
  brandId?: string; // E.g., sold under 'Acme Corp' vs 'Globex'
  
  isActive: boolean;
  
  sync_status: 'pending' | 'synced' | 'error' | 'conflict';
  sync_version: number;
}
