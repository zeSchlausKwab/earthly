Floating popover list — dropdowns, context menus, the panel switcher, the ⌘K palette.

```jsx
<Menu width={216}>
  <MenuGroup>Workspace</MenuGroup>
  <MenuItem icon={<DatasetIcon/>} keycap="⌘1">Datasets</MenuItem>
  <MenuItem icon={<EyeIcon/>} active checked>Sightings</MenuItem>
  <MenuSeparator/>
  <MenuItem danger keycap="⌫">Delete</MenuItem>
</Menu>
```

Uses `--shadow-pop`. `checked` marks the current value in a switcher; `keycap` shows a shortcut; `danger` for destructive.
