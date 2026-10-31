import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";

const Tab = createBottomTabNavigator();

// Nav-only registration for voice / OCR — no feature APIs or handlers.
export function AppTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Wallet" component={Stub} />
      <Tab.Screen name="Transactions" component={Stub} />
      <Tab.Screen name="VoiceInput" component={Stub} />
      <Tab.Screen name="OcrScan" component={Stub} />
    </Tab.Navigator>
  );
}

function Stub() {
  return null;
}
