import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";

const Stack = createNativeStackNavigator();

// Name-only screen registration — must NEVER count as OCR/voice implementation.
export function AuthStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="OCR" component={Placeholder} />
      <Stack.Screen name="Voice" component={Placeholder} />
      <Stack.Screen name="ReceiptScan" component={Placeholder} />
    </Stack.Navigator>
  );
}

function Placeholder() {
  return null;
}
