import React from "react";
import { Text, View } from "react-native";

// Screen name only — NO speech/microphone/record APIs. Must score as missing for voice REQs.
export function VoiceScreen() {
  return (
    <View>
      <Text>Voice placeholder screen</Text>
    </View>
  );
}
