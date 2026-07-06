The dense workhorse row. Dot/icon + title + meta + trailing actions; `selected` = amber left-border + tint.

```jsx
<ListRow dot="var(--accent-ok)" title="Wall segments 1961" meta="43"
         selected trailing={<EyeIcon/>} />
<ListRow icon={<PinIcon/>} title="Checkpoint Charlie" onClick={fly} />
<ListRow dot="#6c6c74" title="Death strip" muted trailing={<EyeOffIcon/>} />
```

Every dataset / sighting / layer / geometry list is a stack of these. Keep height 24 (compact) to 32 (comfortable).
