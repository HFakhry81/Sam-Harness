import React from "react";
import { Text, View } from "react-native";

// Screen name only — NO camera/ocr/receipt APIs. Must score as missing for OCR REQs.
export function OcrScreen() {
  return (
    <View>
      <Text>OCR placeholder screen</Text>
    </View>
  );
}
