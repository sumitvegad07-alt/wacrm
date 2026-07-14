export interface AttributeDefinition {
  id: string;
  code: string; // e.g. 'COLOR', 'SIZE'
  label: string; // e.g. 'Color', 'Size'
  dataType: 'String' | 'Number' | 'Boolean' | 'OptionSet';
  options?: string[]; // If OptionSet
}

export interface AttributeValue {
  id: string;
  productId: string;
  attributeDefinitionId: string;
  value: string; // Serialized value
}
