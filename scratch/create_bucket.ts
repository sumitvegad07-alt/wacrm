import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data, error } = await supabase.storage.createBucket('profile_avatars', {
    public: true,
    fileSizeLimit: 5242880,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  });
  console.log('Bucket created:', data, error);
}
main();
