import { describe, it } from "node:test";
import assert from "node:assert";
import { reverseString, reverse } from "../../src/shared/string.ts";

describe("reverseString", () => {
  describe("basic cases", () => {
    it("should reverse a simple ASCII string", () => {
      assert.strictEqual(reverseString("hello"), "olleh");
    });

    it("should handle empty strings", () => {
      assert.strictEqual(reverseString(""), "");
    });

    it("should handle single character strings", () => {
      assert.strictEqual(reverseString("a"), "a");
    });

    it("should handle two character strings", () => {
      assert.strictEqual(reverseString("ab"), "ba");
    });

    it("should reverse strings with spaces", () => {
      assert.strictEqual(reverseString("hello world"), "dlrow olleh");
    });

    it("should reverse strings with punctuation", () => {
      assert.strictEqual(reverseString("hello!"), "!olleh");
    });

    it("should reverse strings with numbers", () => {
      assert.strictEqual(reverseString("abc123"), "321cba");
    });
  });

  describe("unicode characters", () => {
    it("should handle unicode characters correctly", () => {
      assert.strictEqual(reverseString("café"), "éfac");
    });

    it("should handle emoji characters", () => {
      assert.strictEqual(reverseString("👋🌍"), "🌍👋");
    });

    it("should handle mixed emoji and text", () => {
      assert.strictEqual(reverseString("hi👋bye"), "eyb👋ih");
    });

    it("should handle complex emoji sequences", () => {
      assert.strictEqual(reverseString("😀😁😂"), "😂😁😀");
    });

    it("should handle combining diacritical marks", () => {
      // Character with combining mark: e + combining acute accent
      const withCombining = "e\u0301"; // é as e + combining acute
      const reversed = reverseString(withCombining);
      assert.strictEqual(reversed.length, 2);
      assert.strictEqual(reversed, "\u0301e");
    });

    it("should handle various unicode scripts", () => {
      // Greek letters
      assert.strictEqual(reverseString("αβγ"), "γβα");

      // Arabic letters
      assert.strictEqual(reverseString("أبج"), "جبأ");

      // Chinese characters
      assert.strictEqual(reverseString("你好世界"), "界世好你");
    });

    it("should handle emoji with skin tone modifiers", () => {
      // 👋 (wave) with light skin tone modifier
      // When reversed: "hi👋🏻" becomes "🏻👋ih" (modifier stays with emoji)
      assert.strictEqual(
        reverseString("👋🏻hi"),
        "ih🏻👋"
      );
    });
  });

  describe("special cases", () => {
    it("should handle strings with only whitespace", () => {
      assert.strictEqual(reverseString("   "), "   ");
    });

    it("should handle strings with tabs and newlines", () => {
      assert.strictEqual(reverseString("a\tb\nc"), "c\nb\ta");
    });

    it("should handle very long strings", () => {
      const longString = "a".repeat(10000);
      const reversed = reverseString(longString);
      assert.strictEqual(reversed, longString);
    });

    it("should be idempotent when reversed twice", () => {
      const original = "Hello, World! 🌍";
      const onceReversed = reverseString(original);
      const twiceReversed = reverseString(onceReversed);
      assert.strictEqual(twiceReversed, original);
    });
  });

  describe("edge cases", () => {
    it("should handle strings with special regex characters", () => {
      assert.strictEqual(reverseString(".*+?^$()[]{}|\\"), "\\|}{][)($^?+*.");
    });

    it("should handle strings with null bytes", () => {
      const withNull = "a\x00b";
      assert.strictEqual(reverseString(withNull), "b\x00a");
    });

    it("should maintain character integrity with mixed content", () => {
      const mixed = "abc123!@#αβγ👋";
      const reversed = reverseString(mixed);
      // Verify it reverses correctly
      assert.strictEqual(reverseString(reversed), mixed);
    });
  });
});

describe("reverse", () => {
  it("should be an alias for reverseString", () => {
    const testString = "Hello 🌍";
    assert.strictEqual(reverse(testString), reverseString(testString));
  });

  it("should work with all reverseString test cases", () => {
    assert.strictEqual(reverse("hello"), "olleh");
    assert.strictEqual(reverse(""), "");
    assert.strictEqual(reverse("👋🌍"), "🌍👋");
  });
});
