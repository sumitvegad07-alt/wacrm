export interface ProductBundle {
  id: string;
  parentProductId: string; // Product where type = 'Bundle'
  name: string;
  isActive: boolean;
}

export interface BundleComponent {
  id: string;
  bundleId: string;
  childProductId: string;
  
  // Future-proofing for configurators
  required: boolean;
  minimumQuantity: number;
  maximumQuantity: number;
  defaultQuantity: number;
}
