export type SortDirection = 'asc' | 'desc';
export type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in' | 'notIn';

export interface StorageFilter {
  field: string;
  operator: FilterOperator;
  value: any;
}

export interface StorageSort {
  field: string;
  direction: SortDirection;
}

export interface StoragePagination {
  limit: number;
  offset?: number;
  cursor?: string; // For cursor-based pagination
}

export interface StorageQuery {
  collection: string;
  filters?: StorageFilter[];
  sort?: StorageSort[];
  pagination?: StoragePagination;
  projection?: string[]; // Fields to return, undefined for all
}

export interface StorageAggregation {
  type: 'count' | 'sum' | 'avg' | 'min' | 'max';
  field: string;
}

export interface StorageQueryResult<T> {
  data: T[];
  totalCount?: number;
  nextCursor?: string;
}
