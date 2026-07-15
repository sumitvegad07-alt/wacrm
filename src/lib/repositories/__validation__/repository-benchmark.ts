import { WatermelonStorageProvider } from '../../runtime/storage/watermelon/watermelon.provider';
import { ContactRepository } from '../implementations/contact.repository';
import { GPSRepository } from '../implementations/gps.repository';
import { RuntimeEventBus } from '../../runtime/services/runtime-event-bus.service';
import * as fs from 'fs';
import * as path from 'path';

function getMemoryMB() {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
}

async function validateOfflineCRUD() {
  console.log('--- Initializing Repository Framework ---');
  
  const storage = new WatermelonStorageProvider(true);
  await storage.initialize();
  
  const context = { tenantId: 'tenant-1', userId: 'user-1', deviceId: 'dev-1' };
  const contactRepo = new ContactRepository(storage, 'contacts', context);
  const gpsRepo = new GPSRepository(storage, 'gps_points', context);

  let eventFired = false;
  RuntimeEventBus.subscribe('REPOSITORY_EVENT', (event) => {
    if (event.payload.action === 'CREATED' && event.payload.entityType === 'contacts') {
      eventFired = true;
    }
  });

  console.log('1. Testing Offline Contact Creation (with auto-metadata)...');
  const createRes = await contactRepo.create({ name: 'Jane Doe', phone: '123-456' });
  if (!createRes.success || !createRes.data) throw new Error('Create failed');
  if (createRes.data.tenant_id !== 'tenant-1') throw new Error('Metadata injection failed');
  if (createRes.data.sync_status !== 'pending') throw new Error('Sync status not pending');
  if (!eventFired) throw new Error('EntityCreated event not fired to RuntimeEventBus');

  const contactId = createRes.data.id;

  console.log('2. Testing Offline Search...');
  const searchRes = await contactRepo.search('Jane');
  if (!searchRes.success || searchRes.data!.length === 0) throw new Error('Search failed');

  console.log('3. Testing Soft Delete...');
  await contactRepo.delete(contactId, true);
  const findRes = await contactRepo.findAll();
  // findAll filters out deleted_at by default in BaseRepository
  if (findRes.data!.some(c => c.id === contactId)) throw new Error('Soft delete filter failed');

  // Benchmarks
  const results = [];
  const limits = [1000, 10000];

  for (const count of limits) {
    console.log(`\n--- Benchmarking Repository Abstraction: ${count} Records ---`);
    const startMem = getMemoryMB();
    
    const contacts = Array.from({ length: count }).map((_, i) => ({
      name: `Bulk User ${i}`, phone: `555-${i}`
    }));

    const startInsert = Date.now();
    await contactRepo.bulkInsert(contacts);
    const insertDuration = Date.now() - startInsert;
    const insertOpsPerSec = Math.round(count / (insertDuration / 1000));
    
    const startSearch = Date.now();
    await contactRepo.search('Bulk User');
    const searchDuration = Date.now() - startSearch;
    const searchOpsPerSec = Math.round(count / (searchDuration / 1000));
    
    results.push({
      count,
      insertOpsPerSec,
      searchOpsPerSec,
      memGrowth: getMemoryMB() - startMem
    });
  }

  // Generate Report
  const reportsDir = path.join(process.cwd(), 'validation-reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

  let md = `# EWO-004C Offline CRUD & Repository Benchmark\n\n`;
  md += `| Operations | Repo Bulk Insert Speed | Repo Search Speed | Memory Growth |\n`;
  md += `|---|---|---|---|\n`;
  results.forEach(r => {
    md += `| ${r.count} | ${r.insertOpsPerSec} ops/sec | ${r.searchOpsPerSec} ops/sec | ${r.memGrowth} MB |\n`;
  });

  fs.writeFileSync(path.join(reportsDir, `Repository-Benchmark-${new Date().toISOString().split('T')[0]}.md`), md);
  console.log('\nValidation and Benchmarks complete. Report generated.');
}

validateOfflineCRUD().catch(e => {
  console.error('Validation Failed:', e);
  process.exit(1);
});
