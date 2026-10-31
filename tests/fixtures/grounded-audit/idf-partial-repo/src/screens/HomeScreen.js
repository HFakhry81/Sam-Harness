import React from "react";
import { Text, View } from "react-native";

// Generic home screen — mentions expense/wallet/amount/date/category/user
// but has none of the feature-specific integrations under test.
export function HomeScreen() {
  const expense = { amount: 10, date: "2026-01-01", category: "food", user: "u1" };
  return (
    <View>
      <Text>Home wallet expense amount {expense.amount}</Text>
      <Text>date {expense.date} category {expense.category} user {expense.user}</Text>
    </View>
  );
}
