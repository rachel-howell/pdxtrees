import { createClient } from '@supabase/supabase-js';

// The publishable key is designed to ship in client code; row-level security
// on the server is the actual access control.
const SUPABASE_URL = 'https://qbjpcrubwbxywbuppfuq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_EkEM1O88KeHpNsSEZLk1Gw_bQIsCerP';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
