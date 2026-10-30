import { MOCK_DATA } from "../data/mockData.js";
import { createClient } from "@supabase/supabase-js";

// Auth not wired — screens use mock data only.
export function HomeScreen() {
  return { currency: MOCK_DATA.currency, locale: MOCK_DATA.locale };
}

void createClient;
