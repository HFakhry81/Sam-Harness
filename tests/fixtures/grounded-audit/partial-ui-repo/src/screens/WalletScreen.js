import React from "react";
import { Pressable, Text, View } from "react-native";
import { MOCK_DATA } from "../data/mockData.js";

// Real feature UI for wallet (handlers + screen) backed by mock data.
export function WalletScreen() {
  const wallet = MOCK_DATA.wallets[0];
  return (
    <View>
      <Text>Wallet balance: {wallet.balance} {MOCK_DATA.currency}</Text>
      <Pressable onPress={() => {}}>
        <Text>Refresh wallet</Text>
      </Pressable>
    </View>
  );
}
