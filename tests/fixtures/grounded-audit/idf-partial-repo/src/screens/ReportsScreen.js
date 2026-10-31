import React from "react";
import { Pressable, Text, View } from "react-native";

// Has PDF/Excel export — should satisfy Tax-Ready Reports PDF/Excel as partial
export function ReportsScreen() {
  return (
    <View>
      <Text>Tax-ready reports</Text>
      <Pressable onPress={() => {}}>
        <Text>Export PDF</Text>
      </Pressable>
      <Pressable onPress={() => {}}>
        <Text>Export Excel</Text>
      </Pressable>
    </View>
  );
}
