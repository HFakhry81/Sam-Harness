import React from "react";
import { Pressable, Text, View } from "react-native";
import { MOCK_DATA } from "../data/mockData.js";

// Real feature UI for transactions with mock-backed list.
export function TransactionsScreen() {
  return (
    <View>
      {MOCK_DATA.transactions.map((t) => (
        <Text key={t.id}>
          {t.note}: {t.amount}
        </Text>
      ))}
      <Pressable onPress={() => {}}>
        <Text>Add transaction</Text>
      </Pressable>
    </View>
  );
}
