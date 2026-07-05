Square icon control; `active` = amber fill for the selected tool. Group them for the segmented tool rail.

```jsx
<IconButton title="Locate" onClick={...}><CrosshairIcon/></IconButton>

<IconButtonGroup>
  <IconButton grouped active><SelectIcon/></IconButton>
  <IconButton grouped><PointIcon/></IconButton>
  <IconButton grouped><PolygonIcon/></IconButton>
</IconButtonGroup>
```

Use `grouped` on children inside `IconButtonGroup` so they share one border with 1px dividers. Sizes 22/26/30. This is the exact pattern behind the map toolbar and the mobile Build tool strip.
