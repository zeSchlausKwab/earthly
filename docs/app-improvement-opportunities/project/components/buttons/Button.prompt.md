Dense cornered action button — use for any click action; amber `primary` for the single commit action, `secondary` for the rest.

```jsx
<Button variant="primary" size="md">Publish</Button>
<Button>Cancel</Button>
<Button variant="ghost" size="sm">Skip</Button>
<Button variant="danger" iconLeft={<TrashIcon/>}>Delete</Button>
```

Variants: `primary` (amber fill, one per context), `secondary` (raised + hairline border), `ghost` (text only), `danger` (red outline). Sizes `sm|md|lg` = 22/26/30px. Radius is 2px — never rounded.
