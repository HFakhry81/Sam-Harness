import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";

const Tab = createBottomTabNavigator();

export function BottomTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="OCRScan" component={Stub} />
      <Tab.Screen name="VoiceInput" component={Stub} />
    </Tab.Navigator>
  );
}

function Stub() {
  return null;
}
