# ⌫ thai-backspace

Backspace in Claude Code's prompt box deletes **one Thai or Lao vowel or tone mark at a time** (`กี่` → `กี` → `ก`) instead of the whole consonant cluster. Ctrl+H does the same; word deletion (Ctrl+Backspace, Ctrl+W) is unchanged.

```text
/plugin install thai-backspace --marketplace Kritsanai-Krish/claude-code-mods
```

![thai-backspace](../docs/screenshots/thai-backspace.png)

Details, examples and the list of marks: see the [main README](../README.md#-thai-backspace).

MIT © Krish
