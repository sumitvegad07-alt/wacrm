import { Model } from '@nozbe/watermelondb';
import { field, date, text, readonly } from '@nozbe/watermelondb/decorators';

/**
 * Base Model that forces all EWO-004A standard metadata fields onto every record.
 */
export class BaseModel extends Model {
  // @nozbe/watermelondb handles `id` automatically as a string.

  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
  @date('deleted_at') deletedAt?: Date;

  @field('sync_version') syncVersion!: number;
  @text('sync_status') recordSyncStatus!: string;

  @text('tenant_id') tenantId!: string;
  @text('user_id') userId!: string;
  @text('device_id') deviceId!: string;

  @text('runtime_version') runtimeVersion!: string;
  @text('storage_version') storageVersion!: string;
  @text('schema_version') schemaVersion!: string;

  @text('trace_id') traceId?: string;
  @text('correlation_id') correlationId?: string;
  @text('operation_id') operationId?: string;
}

export class SysMetadataModel extends BaseModel {
  static table = '_sys_metadata';
  @text('key') key!: string;
  @text('value') value!: string;
}

export class ContactModel extends BaseModel {
  static table = 'contacts';
  @text('name') name!: string;
  @text('phone') phone!: string;
  @text('email') email?: string;
}

export class TaskModel extends BaseModel {
  static table = 'tasks';
  @text('title') title!: string;
  @text('status') status!: string;
  @text('contact_id') contactId?: string;
}

export class ExpenseModel extends BaseModel {
  static table = 'expenses';
  @field('amount') amount!: number;
  @text('description') description!: string;
}

export const modelClasses = [
  SysMetadataModel,
  ContactModel,
  TaskModel,
  ExpenseModel
];
