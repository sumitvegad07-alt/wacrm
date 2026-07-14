import { WatermelonStorageProvider } from '../storage/watermelon/watermelon.provider';
import * as fs from 'fs';
import * as path from 'path';

function getMemoryMB() {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
}

const baseMetadata = {
  created_at: new Date().getTime(),
  updated_at: new Date().getTime(),
  sync_version: 1,
  sync_status: 'synced',
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  device_id: 'dev-1',
  runtime_version: '1.0',
  storage_version: '1.0',
  schema_version: '1.0'
};

async function benchmark(provider: WatermelonStorageProvider, count: number) {
  console.log(`\n--- Running WatermelonDB Benchmark: ${count} Records ---`);
  
  const startMem = getMemoryMB();
  
  // 1. Batch Insert Benchmark
  const ops = [];
  for (let i = 0; i < count; i++) {
    ops.push({
      action: 'insert' as const,
      collection: 'contacts',
      id: `contact-${count}-${i}`,
      data: {
        name: `User ${i}`,
        phone: `555-${i}`,
        ...baseMetadata
      }
    });
  }

  const startInsert = Date.now();
  await provider.batch(ops);
  const insertDuration = Date.now() - startInsert;
  const insertOpsPerSec = Math.round(count / (insertDuration / 1000));
  
  // 2. Query Benchmark
  const startQuery = Date.now();
  const queryRes = await provider.query('contacts', {
    collection: 'contacts',
    filters: [{ field: 'tenant_id', operator: 'eq', value: 'tenant-1' }],
    pagination: { limit: count } // Fetch all to stress test
  });
  const queryDuration = Date.now() - startQuery;
  const queryOpsPerSec = Math.round(count / (queryDuration / 1000));

  const endMem = getMemoryMB();
  const memGrowth = endMem - startMem;

  console.log(`Batch Insert: ${insertOpsPerSec} ops/sec (${insertDuration}ms)`);
  console.log(`Query (Fetch All): ${queryOpsPerSec} ops/sec (${queryDuration}ms)`);
  console.log(`Memory Growth: ${memGrowth} MB`);

  return { count, insertOpsPerSec, queryOpsPerSec, memGrowth };
}

async function validateProvider() {
  console.log('--- Initializing WatermelonDB Provider ---');
  // Pass true to use memory only for fast validation
  const provider = new WatermelonStorageProvider(true);
  
  const startInit = Date.now();
  await provider.initialize();
  console.log(`Initialization complete in ${Date.now() - startInit}ms`);

  console.log('Testing CRUD operations...');
  // 1. Insert
  await provider.insert('tasks', 'task-1', {
    title: 'Validation Task',
    status: 'pending',
    ...baseMetadata
  });

  // 2. Query
  const res = await provider.findOne('tasks', {
    collection: 'tasks',
    filters: [{ field: 'status', operator: 'eq', value: 'pending' }]
  });
  if (!res || (res as any).title !== 'Validation Task') throw new Error('CRUD Insert/Find failed');

  // 3. Update
  await provider.update('tasks', 'task-1', { status: 'completed' });
  const updated = await provider.find('tasks', 'task-1');
  if (!updated || (updated as any).status !== 'completed') throw new Error('CRUD Update failed');

  // 4. Delete
  await provider.delete('tasks', 'task-1');
  const deleted = await provider.find('tasks', 'task-1');
  if (deleted) throw new Error('CRUD Delete failed');

  console.log('CRUD validated successfully.');

  console.log('Testing Capabilities Negotiation...');
  const caps = provider.capabilities();
  if (!caps.transactions || !caps.batchWrites) throw new Error('Capabilities failed');
  console.log('Capabilities validated successfully.');

  // Benchmarks
  const results = [];
  results.push(await benchmark(provider, 1000));
  results.push(await benchmark(provider, 10000));
  // 100k takes too long for a quick validation hook, skipping to save time.

  // Generate Report
  generateReport(results);
}

function generateReport(results: any[]) {
  const reportsDir = path.join(process.cwd(), 'validation-reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

  const date = new Date().toISOString().split('T')[0];
  let md = `# EWO-004B WatermelonDB Storage Provider Benchmark\n\n`;
  md += `| Operations | Batch Insert Speed | Query Speed | Memory Growth |\n`;
  md += `|---|---|---|---|\n`;
  results.forEach(r => {
    md += `| ${r.count} | ${r.insertOpsPerSec} ops/sec | ${r.queryOpsPerSec} ops/sec | ${r.memGrowth} MB |\n`;
  });

  fs.writeFileSync(path.join(reportsDir, `Watermelon-Benchmark-${date}.md`), md);
  console.log('\nValidation and Benchmarks complete. Report generated.');
}

validateProvider().catch(e => {
  console.error('Validation Failed:', e);
  process.exit(1);
});
