import React from "react";
import { Pressable, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MOCK_DATA } from "../data/mockData.js";
import { createClient } from "@supabase/supabase-js";

// Auth not wired — screens use mock data only. No OTP / Google / Apple providers.
// async-storage + supabase imported but missing from package.json → DEP P0s.
export function HomeScreen() {
  return (
    <View>
      <Text>{MOCK_DATA.currency}</Text>
      <Text>{MOCK_DATA.locale}</Text>
      {/* Logout control missing onPress — grounded-audit checklist P0 */}
      <Pressable>
        <Text>Logout</Text>
      </Pressable>
    </View>
  );
}

void createClient;
void AsyncStorage;
